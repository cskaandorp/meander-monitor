#!/usr/bin/env bash
# fwdvec database migrations.
#
# Applies the pending files in migrations/ to a Postgres database, in filename
# order, exactly once each — recorded in a Rails-style ledger table
# (supabase_migrations.schema_migrations, the same table the Supabase CLI uses,
# so this stays compatible if you ever adopt it).
#
# Each migration runs atomically: the migration body AND its ledger row are
# committed in a SINGLE transaction, so a migration either fully applies and is
# recorded, or does neither (no partial state, no half-recorded versions).
#
# A migration that CANNOT run inside a transaction (e.g. CREATE INDEX
# CONCURRENTLY, ALTER TYPE ... ADD VALUE) must opt out with a marker line:
#
#   -- migrate:no-transaction
#
# Such a file runs unwrapped and its ledger row is inserted afterwards; it is
# inherently non-atomic, which is the trade-off for stepping outside a txn.
#
# Connection: by default runs `psql` using the standard libpq env vars (PGHOST,
# PGUSER, PGPASSWORD, PGDATABASE, ...). To run WITHOUT installing psql, override
# the whole invocation via $PSQL to go through a container, e.g.:
#
#   PSQL='docker exec -i -e PGPASSWORD=postgres fwdvec-db psql -U postgres -d postgres' \
#     ./migrate.sh
#
# Usage: ./migrate.sh [migrations-dir]     (default: <script dir>/migrations)
set -euo pipefail

MIGRATIONS="${1:-$(dirname "$0")/migrations}"
PSQL="${PSQL:-psql}"

run() { $PSQL -v ON_ERROR_STOP=1 "$@"; }   # $PSQL is word-split on purpose

# The ledger: which migrations this database has already had applied.
run -qc "create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version     text primary key,
  name        text,
  inserted_at timestamptz not null default now()
);" >/dev/null

# The ledger insert, appended to each migration so both commit together.
ledger_insert() {
  printf "insert into supabase_migrations.schema_migrations (version, name) values ('%s', '%s');\n" "$1" "$2"
}

applied=0
for f in "$MIGRATIONS"/*.sql; do
  [ -e "$f" ] || { echo "no migrations found in $MIGRATIONS" >&2; exit 1; }
  base="$(basename "$f")"
  version="${base%%_*}"                 # leading timestamp, e.g. 20260216100000
  name="${base#*_}"; name="${name%.sql}"
  seen="$(run -tAqc "select 1 from supabase_migrations.schema_migrations where version='$version'" || true)"
  [ "$seen" = 1 ] && continue
  echo "  ▶ $base"

  if grep -qiE '^[[:space:]]*--[[:space:]]*migrate:no-transaction\b' "$f"; then
    # Opt-out: run unwrapped, then record separately (non-atomic by nature).
    ok=yes
    run -q < "$f" || ok=no
    [ "$ok" = yes ] && { run -q <<<"$(ledger_insert "$version" "$name")" || ok=no; }
  else
    # Default: migration body + ledger row in one transaction. On any error,
    # ON_ERROR_STOP aborts before COMMIT and the backend rolls the txn back.
    ok=yes
    { echo "begin;"; cat "$f"; echo; ledger_insert "$version" "$name"; echo "commit;"; } | run -q || ok=no
  fi

  if [ "$ok" = yes ]; then
    applied=$((applied + 1))
  else
    echo "  ✗ migration failed: $base (error above)" >&2
    exit 1
  fi
done
echo "✓ fwdvec migrations up to date ($applied applied)"

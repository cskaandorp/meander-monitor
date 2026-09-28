# Local Supabase

A full Supabase stack on your machine, so `npm run dev` does not talk to the
production database on Patrick. Everything the app uses is here: Postgres,
auth (including anonymous volunteers), PostgREST, Realtime, Storage and image
transformation.

Adapted from CoastSnap's stack (`../coastsnap/supabase`), which strips
upstream's eleven services down to six. See the header of `docker-compose.yml`
for what was dropped and why — and for the one service CoastSnap drops that we
must keep (imgproxy: every banner, gallery image and landing slide on this site
goes through `/render/image/`).

This is **local only**. Production Supabase runs on Patrick and is configured
there; nothing in this folder deploys.

## Setup

Once, from the repo root:

```bash
cp supabase/.env.example supabase/.env
node scripts/mint-keys.mjs >> supabase/.env     # appends the secret block
```

Later definitions win in an `--env-file`, so the minted block overrides the
blank placeholders above it. Never reuse production secrets here.

```bash
cd supabase
docker compose --env-file .env up -d
```

First run pulls ~1.5 GB and takes a few minutes. Then apply the schema:

```bash
PW=$(grep '^POSTGRES_PASSWORD=' .env | tail -1 | cut -d= -f2)
PSQL="docker exec -i -e PGPASSWORD=$PW mm-db psql -U postgres -d postgres" ./migrate.sh
```

`< /dev/null` is not needed interactively, but **is** if you ever wrap this in a
script — `docker exec -i` otherwise swallows the rest of the script as stdin.
That bug ate a production deploy once; see `.github/workflows/deploy.yml`.

## Point the app at it

`.env.local` in the repo root currently holds the **production** values. To work
locally, swap them for:

```
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8002
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from supabase/.env>
```

Keep the production values somewhere — you need them to build against
production. Changing this file locally does **not** affect deploys: Patrick has
its own `.env.local`, and the deploy's `git checkout -- .` leaves it alone.

These are baked in at **build** time, so restart `npm run dev` after changing
them.

## Create an admin

Self-signup gives you a volunteer, not an admin — `/admin` is gated on
`profiles.is_admin` (see `proxy.ts`). Create one by hand:

```bash
SRK=$(grep '^SERVICE_ROLE_KEY=' .env | tail -1 | cut -d= -f2)
curl -s -X POST http://localhost:8002/auth/v1/admin/users \
  -H "apikey: $SRK" -H "authorization: Bearer $SRK" \
  -H "content-type: application/json" \
  -d '{"email":"you@example.com","password":"localdev123","email_confirm":true}'

docker exec -i -e PGPASSWORD=$PW mm-db psql -U postgres -d postgres \
  -c "update profiles set is_admin = true where email = 'you@example.com';"
```

The `handle_new_user` trigger creates the profile row automatically; the second
command only flips the flag. `email_confirm: true` matters — without it GoTrue
wants a confirmation mail, and no SMTP is configured here.

## Everyday commands

```bash
docker compose --env-file .env ps          # what is running
docker compose --env-file .env logs -f db  # one service's logs
docker compose --env-file .env down        # stop, keep data
docker compose --env-file .env down -v     # stop and DESTROY data
```

`down -v` is the reset button. It is also the **only** way to re-run the init
scripts in `volumes/db/` — those execute once, on an empty data directory, so
editing them has no effect until the volume is gone.

## Checking it works

```bash
ANON=$(grep '^ANON_KEY=' .env | tail -1 | cut -d= -f2)
B=http://localhost:8002

curl -s -o /dev/null -w '%{http_code}\n' "$B/rest/v1/locations?select=*" \
  -H "apikey: $ANON" -H "authorization: Bearer $ANON"          # 200

curl -s -X POST "$B/auth/v1/signup" -H "apikey: $ANON" \
  -H "content-type: application/json" -d '{}'                  # anonymous volunteer

curl -s -o /dev/null -w '%{http_code}\n' \
  "$B/realtime/v1/api/tenants/realtime-dev/health" \
  -H "authorization: Bearer $ANON"                             # 200
```

That last one is worth keeping: Realtime fails in a confusing way (503 on the
WebSocket handshake, no error text) if the tenant does not resolve, and this
probe tells you whether it did.

## Things that bite

- **Ports.** The gateway publishes on `127.0.0.1:8002`, mirroring Kong's port on
  Patrick. CoastSnap's stack uses 8010, so both can run at once.
- **`REALTIME_DB_ENC_KEY` must be exactly 16 characters.** Realtime uses
  `aes_128_ecb` and passes it straight through as key material; anything else
  crash-loops the container with `:badarg ... Bad key size` from inside Erlang.
  `mint-keys.mjs` already gets this right.
- **Anonymous auth needs BOTH `DISABLE_SIGNUP=false` and
  `ENABLE_ANONYMOUS_USERS=true`.** An anonymous sign-in *is* a signup. Setting
  only the second is the common mistake, and `/submit` then fails with "Could
  not start a session".
- **`PGRST_DB_MAX_ROWS=1000`** matches production deliberately. Raising it
  locally would hide a truncation bug until deploy.
- **The `supabase_realtime` publication ships with the Postgres image**, so
  `submissions_table`'s `alter publication` works against a fresh stack. It does
  *not* exist on plain Postgres, which is why `ci-bootstrap.sql` creates it for
  CI.

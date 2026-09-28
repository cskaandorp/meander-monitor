# Munisense water-level API

WUR's water monitoring portal, which we read water levels from for the public
site. Munisense is the vendor; `wur.water-munisense.net` is WUR's tenant.

There is no vendor-written integration guide for this tenant — the Swagger page
sits behind the portal login, and the spec declares no security schemes. What
follows was established by probing the live API on 2026-09-28. The saved spec is
authoritative for *shapes*; this file is authoritative for *how to reach it*.

Last updated: 2026-09-28.

---

## Access

| | |
|---|---|
| Base URL | `https://wur.water-munisense.net/webservices/v2` |
| Auth | **HTTP Basic** |
| Spec | `docs/munisense-openapi.json` — OpenAPI 3.1.0, "Munisense Portal Webservice" 2.0.0, 346 paths |
| Portal UI | `https://wur.water-munisense.net` (SSO via `login.water-munisense.net`) |

**HTTP Basic is the whole story, and it is not documented anywhere.** The spec's
`securitySchemes` is empty and the browser uses a session cookie, so the obvious
reading is that you must hold a logged-in session. You do not:

```bash
curl -u "$MUNISENSE_USER:$MUNISENSE_PASS" \
  https://wur.water-munisense.net/webservices/v2/opendata/metadata
```

returns 200. The same call without credentials returns 401 with
`{"message":"Please use HTTP Authentication for this site.", "login_url":"…"}`.
That is what makes a server-side integration simple — no login flow, no CSRF
token, no session to keep alive. Do not build the cookie-juggling version.

A `Bearer` token is *not* accepted (401). Basic only.

### Credentials

Currently a **personal** account. Before this goes live, ask WUR for a service
account — a personal password rotation would otherwise silently kill the
website's data feed, and the failure would look like the sensors going quiet.

Credentials belong in **`worker/.env`, on the worker box — and nowhere else**.
Not in the app's `.env.local`: that file sits beside `NEXT_PUBLIC_*` values that
are baked into the browser bundle at build time, and the app has no reason to
hold a Munisense secret anyway (it reads our own tables). See "How it is wired
here" below.

---

## Refreshing the saved spec

`docs/munisense-openapi.json` is a snapshot. The live spec lives at
`/ajax.php?action=get_swagger_json` — and *that* endpoint is session-only, not
Basic-auth, so refreshing it means a real login. Form POST, multipart, with a
CSRF token bound to the session:

```bash
JAR=/tmp/muni-cookies.txt; rm -f $JAR
T='https://wur.water-munisense.net/static-content/swagger/index.html'
CSRF=$(curl -s -c $JAR "https://login.water-munisense.net/login?url=$T&theme=munisense" \
  | grep -oE 'name="_csrf_token" value="[^"]+"' | sed 's/.*value="//; s/"$//')
curl -s -b $JAR -c $JAR -L -o /dev/null \
  --form-string action=login --form-string "_csrf_token=$CSRF" \
  --form-string type=sso --form-string "url=$T" \
  --form-string "username=$MUNISENSE_USER" --form-string "password=$MUNISENSE_PASS" \
  https://login.water-munisense.net/login
curl -s -b $JAR 'https://wur.water-munisense.net/ajax.php?action=get_swagger_json' \
  | python3 -m json.tool > docs/munisense-openapi.json
```

Two traps, both cost an hour the first time:

- Use `--form-string`, not `-F`. `curl -F` treats a leading `@` or `<` in a value
  as a *file reference*, which mangles passwords that happen to start with one.
- A failed login returns **HTTP 200** and re-renders the form with no error
  message, echoing the submitted username back in the `value` attribute. Success
  is a 302. Check the status code, not the body — and note that a wrong
  *username* looks identical to a wrong password.

---

## What WUR has on this portal

### Groups — how to tell the real sensor from the test rigs

Objects are organised into **groups**, and the group is the only thing that
distinguishes them: four of the five wells share two descriptions between them
("Tube 1" twice, "Tube 2" twice). Never resolve a sensor by description alone.

There is no `/groups/query`. The list comes from:

```
GET /webservices/v2/users/me/all_groups
→ {"1":  {"group_id":1,  "name":"Meander Monitor"},
   "5":  {"group_id":5,  "name":"New Meander Monitor"},
   "36": {"group_id":36, "name":"River Site 1"}}
```

`me` works as the user id; `/users/current` and `/users/me` do not (404).

Filter objects with `?groupIds=<id>`:

| group | wells |
|---|---|
| 1 — Meander Monitor | 924, 935, 939, 941, 957 (everything) |
| 5 — New Meander Monitor | *(empty)* |
| **36 — River Site 1** | **957 only** |

**Well 957 ("Tube 1", group 36 "River Site 1") is the production sensor** — per
WUR, the one test sensor actively collecting and transmitting. Group 1 is a
catch-all containing the lab and campus test wells too. Build against 957 via
its group, not against the full list.

### All five wells

| id | description | location | coordinates |
|---|---|---|---|
| 924 | Tube 2 | Wageningen | 51.969187, 5.665395 |
| 935 | Well Lab 1 | Droevendaalsesteeg 1A | 51.987378, 5.664156 |
| 939 | Tube 1 | Droevendaalsesteeg 1A | 51.987339, 5.664221 |
| 941 | Tube 2 | Droevendaalsesteeg 3 | 51.987603, 5.664935 |
| **957** | **Tube 1** ← River Site 1 | Droevendaalsesteeg 1A | 51.987391, 5.664199 |

**These are groundwater heads, not river surface levels.** Values sit around
11.7 m NAP. That is deliberate, not a mix-up: groundwater level stands in for
how much water the regional system is holding, which is what drives flow through
the rivers and brooks the volunteers film. It is regional context for the
submissions, not a measurement of any one meander.

Two wells sit ~2 km from the other three (924 vs. the Droevendaalsesteeg
cluster), so "the region" here is really the Wageningen campus area — say so on
the page rather than implying wider coverage.

As of 2026-09-28, wells **924 and 935 had not reported since 2026-09-16**; 939,
941 and 957 were current within the hour. Assume at any moment that some wells
are stale.

The other object types the spec exposes (`wells`, `meteos`,
`waterqualitymeasurementpoints`, `nodes`) return nothing usable for this tenant.
Only `groundwaterwells` carries data.

### The three variables we display

WUR asked for Water Level, Water Pressure and Barometric Pressure, with water
level through time as the primary. They map onto Munisense properties like this
— the names are not guessable, so take them from here:

| WUR's name | Munisense property | unit | example (957, 2026-09-28) |
|---|---|---|---|
| **Water Level** (primary) | `water_level` | **m NAP** | 11.731 |
| Water Pressure | `water_absolute_pressure` | **Pa** | 104250 |
| Barometric Pressure | `well_covering_barometric_pressure` | **hPa** | 1020.46 |

**The two pressures are in different units — Pa and hPa, a factor of 100.**
Plotting them on a shared axis without converting makes the barometric line look
like a flat zero. Convert to a common unit for display, and take the unit from
each response's `meta.unit` rather than hardcoding it.

The physics is also the reason all three are wanted together: water level is
derived from the difference between the two pressures. At the example above,
104250 Pa − 102046 Pa ≈ 2200 Pa ≈ 0.22 m of water column above the sensor.

Full property list from `GET /groundwaterwells/{id}/sources`:
`water_level` · `water_temperature` · `electrical_conductivity` ·
`water_absolute_pressure` · `water_absolute_pressure_last_result_age` ·
`well_covering_barometric_pressure` · `import_logger_water_level` · `node`

m NAP is Normaal Amsterdams Peil, the Dutch ordnance datum — always label it, a
bare "11.7" is meaningless.

### Cadence: 15-minute samples, 6-hourly delivery

Two different clocks, and confusing them leads to a page that looks broken:

- The sensor **measures** water pressure every **15 minutes**.
- The 2G modem **uploads** on a **6-hour** cycle.

So timestamps are fine-grained, but the newest reading can be up to six hours
old at any moment. A "current situation" panel must show *when* the reading is
from; without it, a perfectly healthy sensor looks stalled.

This also settles the preset choice: use **`last_week`** (10-minute buckets),
which matches 15-minute sampling. `last_month` is hourly and smears it.

---

## Endpoints

### Preset time series — use this for the website

Pre-aggregated server-side, so we fetch a few hundred points instead of
thousands of raw samples.

```
GET /webservices/v2/groundwaterwells/{id}/{property}/query/presets/{preset}
```

| preset | span | sampling |
|---|---|---|
| `last_day` | 24 h | 1 minute |
| `last_week` | 7 d | 10 minutes |
| `last_month` | 30 d | 1 hour |
| `last_year` | 1 y | 8 hours |
| `last_three_years` | 3 y | 24 hours |
| `all` | everything | 24 hours |

```jsonc
// GET /groundwaterwells/941/water_level/query/presets/last_month
{
  "results": [
    { "timestamp": "2026-09-28T10:00:00.000+00:00",
      "avg": 11.741, "min": 11.741, "max": 11.741, "count": 1 }
  ],
  "meta": { "unit": "m NAP" }
}
```

### Arbitrary range

```
GET /webservices/v2/groundwaterwells/{id}/{property}/query/{start_timestamp}
```

`start_timestamp` is RFC3339 in the path. Useful query params: `end_timestamp`,
`sample_rate` (milliseconds, averages over the span), `functions`
(`avg`/`min`/`max`/…), `rowcount`, `order_field`, `order_dir`,
`readable_timestamps`, `compact_payload` (positional arrays instead of objects).

### Metadata

```
GET /webservices/v2/groundwaterwells/query        list objects (+ recent results)
GET /webservices/v2/groundwaterwells/{id}          properties of one object
GET /webservices/v2/groundwaterwells/{id}/location {longitude, latitude, gis_description}
GET /webservices/v2/groundwaterwells/{id}/sources  which properties exist, and when
```

### Two different result shapes — do not write one parser

This is the easiest mistake to make. The preset endpoints return an **object**
with aggregates:

```jsonc
{ "results": [{ "timestamp": …, "avg": …, "min": …, "max": …, "count": … }],
  "meta": { "unit": "m NAP" } }
```

The listing endpoint returns an **array of objects**, each with plain values and
no `meta`, so no unit:

```jsonc
[{ "object_id": 924, "description": "Tube 2",
   "results": [{ "timestamp": …, "value": 11.646 }] }]
```

---

## Gotchas

- **An empty `results` array is a valid response, not an error.** Well 924's
  `last_week` returns `{"results":[],"meta":{"unit":"m NAP"}}` because the sensor
  stopped reporting. Render a "last updated" timestamp so a dead sensor is
  visible rather than an innocently flat line.
- **Open data publishing is switched off.** `GET /webservices/v2/opendata/metadata`
  returns `{"groups":[],"objects":[]}` — nothing on this tenant is marked for
  public publishing. So the unauthenticated `opendata.munisense.net/api/v2/…`
  route (which Delft-FEWS uses against other tenants, same URL grammar) is
  **not** available to us, and every request must be proxied server-side. If a
  public feed would be useful, this is a switch WUR/Munisense can flip — worth
  asking, it would remove our credential handling entirely.
- **Don't poll hard.** Samples are 15-minutely and arrive in 6-hourly batches, so
  five of every six hourly polls see nothing new. Hourly is a reasonable
  compromise — it bounds staleness without needing to know when a batch lands —
  but anything faster is pure waste.
- **Fetch an overlapping window and upsert**, rather than "everything since last
  time". Pulling `last_week` on each run and upserting on
  `(well_id, property, measured_at)` makes the job idempotent: a missed run, a
  double run, a restart or a day of downtime all self-heal on the next tick,
  with no cursor to keep correct.
- `/{objecttype}/query` without a `property` param can fail with
  `Unknown property: water_level` on object types that don't carry it — pass
  `property` explicitly rather than relying on the default.
- Timestamps come back as `+00:00` (UTC). Display in Europe/Amsterdam.

---

## How it is wired here

Nothing a browser touches calls Munisense. The chain is:

```
Munisense ──hourly, HTTP Basic──▶ /api/cron/water ──upsert──▶ Supabase
               ▲                                                  │
     systemd timer on Patrick              anon key + RLS ────────┘
     (deploy/meander-water.timer)                                 ▼
                                                      /water  (public page)
```

| Piece | File |
|---|---|
| Schema (`water_wells`, `water_measurements`, `water_latest`) | `supabase/migrations/20260928100000_water_levels.sql` |
| Harvester | `app/api/cron/water/route.ts` |
| Schedule | `deploy/meander-water.timer` + `.service` |
| Public page | `app/(public)/water/page.tsx` |
| Chart | `components/timeseries-chart.tsx` |
| Series colours (validated) | `lib/chart-colors.ts` |

**Not the video worker.** That process exists to turn volunteer footage into
flow measurements; an unrelated hourly HTTP fetch has no business sharing its
lifecycle, its container, or its manual deploy. Putting the harvest in the app
also means it ships with `git push` like everything else, instead of needing a
second deploy path.

### Configuration

All on Patrick, in `/var/www/meander-monitor/.env.local`. **None of these may
ever carry a `NEXT_PUBLIC_` prefix** — that would bake them into the browser
bundle. They are read server-side only, by the route handler.

| var | what |
|---|---|
| `MUNISENSE_USER` / `MUNISENSE_PASS` | portal credentials (ask WUR for a *service* account) |
| `MUNISENSE_GROUP_IDS` | default `36` (River Site 1); comma-separated |
| `MUNISENSE_PRESET` | default `last_week` |
| `SUPABASE_WRITE_KEY` | a key that may INSERT — prefer a scoped `worker_external` JWT over `service_role` |
| `CRON_SECRET` | shared secret the timer presents; the app is public, so this is the only gate on the endpoint |

Unset `MUNISENSE_USER` and the endpoint returns 503 without touching anything.

### Running it by hand

Safe at any time — the overlapping window plus the upsert make an extra run a
no-op rather than duplicate rows. Useful for backfilling after downtime:

```bash
curl -X POST http://127.0.0.1:3050/api/cron/water \
  -H "Authorization: Bearer $CRON_SECRET"
# → {"ok":true,"wells":1,"readings":2299}
```

Check the schedule with `systemctl list-timers meander-water`, and a failed run
with `journalctl -u meander-water`.

### Displaying it

- Water level gets its own chart; the two pressures share a second one **with
  water pressure converted Pa → hPa**. Never plot them on one axis raw: they
  differ by a factor of 100 and the air line collapses onto the floor.
- Every panel shows *when* the newest reading is from, and says so out loud past
  13 hours (two upload cycles). With a 6-hour delivery cycle, a page that hides
  the timestamp looks broken precisely when it is healthy.

---

## Key references

- `docs/munisense-openapi.json` — the saved spec
- Munisense external wiki: <https://munisense.atlassian.net/wiki/spaces/EX/>
  (public; "Integrating with the Munisense ecosystem" describes the portal
  webservice, AMQP streaming, and the opendata API)
- Delft-FEWS's Munisense importer documents the same URL grammar against the
  public opendata host:
  <https://publicwiki.deltares.nl/spaces/FEWSDOC/pages/139395084/Munisense+import>
- Munisense support: support@munisense.com

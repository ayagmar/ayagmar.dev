# 0029. Rabat weather in the window

Status: accepted, 2026-10-26

## Context

The room's window follows Rabat's sun and moon (ADR 0027). The owner asked for the real weather there too, over that sky: clouds, fog, rain, snow or a storm, drawn like the rest of the room, and said in the window's label. It must degrade to the room as it is without it: no JavaScript, a failed, slow or stale answer, or an unknown condition shows the clock's sky and moon with no weather, never a wrong one.

## Decision

### Source: Open-Meteo's free forecast API

Open-Meteo needs no key and covers Rabat. Its terms (https://open-meteo.com/en/terms, retrieved 2026-10-26) say "You may only use the free API services for non-commercial purposes", and list as non-commercial "Private or non-profit websites or apps that do not have subscriptions or advertising", and as commercial "Websites or apps that have subscriptions or display advertisements" and "Commercial products or promotional activities". This is a private website with no subscriptions and no advertising, so the free API applies. A personal site can be read as self-promotion; that reading was weighed and not taken. If the owner or Open-Meteo sees it otherwise, the weather comes out or moves to a paid plan; no key or plan is added here.

The same terms set the free limits: "Less than 10'000 API calls per day, 5'000 per hour and 600 per minute"; the pricing table on that page adds 300,000 a month and no uptime guarantee for the free service. "Rate limits are applied by IP addresses and application", and "we apply limits per Cloudflare user" for Workers. signals makes one request every 15 minutes, about 96 a day; the runner's 30-second early allowance (ADR 0010) can shorten an interval to 14.5 minutes, so at most about 100 a day and 3,000 a month. Nothing here relies on Cloudflare's egress addresses or the User-Agent to keep this site's quota apart: any other Worker on the same Cloudflare account that calls Open-Meteo counts against it too. A refused request (403 or 429) is `upstream_rate_limited`, the last snapshot stays, and the next try is the next regular one. No immediate retry, no other addresses, no Preview pulls (Cron Triggers never run for Previews), and no request on a read-route miss.

What the data is: Open-Meteo's current conditions, which its docs describe as "based on 15-minutely weather model data", for the model grid cell it picks for the tower's coordinates. On 2026-10-26 that was the cell at 34.0044 N, 6.8209 W, 28 m up. It is modelled weather for that cell, not a measurement at Hassan Tower, and the site says no more than that.

**Licence.** Open-Meteo's data is CC BY 4.0 (https://open-meteo.com/en/licence, retrieved 2026-10-26), which asks for credit, a link to the licence, a note of changes, and "a link next to any location Open-Meteo data are displayed". Under the room, on every build: "Weather data by Open-Meteo (CC BY 4.0); simplified visualization.", linking https://open-meteo.com/ and https://creativecommons.org/licenses/by/4.0/. The changes: signals keeps six values, checks their units, renames them and turns Unix time into RFC 3339; the site reduces the weather code to one of six pictures, lowercases Open-Meteo's words for it and rounds the temperature. The fixtures redistribute one real answer (`open-meteo/raw/ok.json`, Rabat at 13:30 UTC on 2026-10-26) and invented samples, as `packages/contracts/fixtures/README.md` says. ADR 0022 records that this data is not under the repository's MIT licence.

### signals: the `weather` source

`apps/signals/src/adapters/pull/weather.ts`, following ADR 0009:
- One GET of `https://api.open-meteo.com/v1/forecast` with `latitude=34.0240`, `longitude=-6.8228`, `current=weather_code,cloud_cover,precipitation,wind_speed_10m,is_day,temperature_2m`, `temperature_unit=celsius`, `wind_speed_unit=kmh`, `precipitation_unit=mm`, `timezone=GMT` and `timeformat=unixtime`. No hourly or daily arrays. Through `getJson`: the 5-second timeout, the `min7-signals (+https://ayagmar.dev)` User-Agent, and a 16 KiB body cap checked against `Content-Length` and while streaming (the answer is about 0.5 KiB).
- The wire schema (`openMeteoCurrentSchema`) checks each unit string, so a changed unit fails the pull instead of serving Fahrenheit as Celsius. Values are range-checked and finite. A value the model has none for is null and stays null; it is never read as 0. A null weather code means no current conditions: the pull fails with `upstream_error` and the last snapshot stays until it is too old. A code that is a whole number from 0 to 99 is served even if Open-Meteo does not document it; anything else is `upstream_malformed`.
- The snapshot (`weatherSnapshotSchema`): `observedAt` (the start of Open-Meteo's current 15-minute step, RFC 3339 UTC), `weatherCode`, `cloudCoverPercent`, `precipitationMm` (over the 15 minutes before `observedAt`), `windSpeedKmh`, `isDay` and `temperatureC`, each nullable but the first two. `fetchedAt` keeps its ADR 0010 meaning, when signals fetched it. `observedAt` exists because a 200 answer can carry old model data; `fetchedAt` alone would call it fresh.
- `intervalSeconds` 900; `staleAfterSeconds.weather` 2,700 (45 minutes, three missed pulls).
- `GET /v1/weather` is `snapshotRoute('weather')`, unchanged: the envelope, `stale`, at most 60 seconds of edge and browser cache, the query-free cache key, HEAD, OPTIONS and CORS as for every source.

**Scheduling.** Weather is appended to the pull registry; the runner is unchanged: one adapter per invocation, the most overdue by last attempt, never-tried first. Four sources cannot all keep their nominal intervals on one trigger a minute: listening asks for every minute, so it now skips about two minutes in each quarter hour instead of one. `apps/signals/test/cron.test.ts` runs two days of minute triggers with the real registry's intervals, moving both the trigger time and the clock that stamps attempts, with fetches taking 0.7 to 8 seconds and weather failing for six hours, every third failure hanging to the runner's 20-second timeout. Measured: listening at most 4 minutes apart (at startup), shipping 15, weather 16, projects 24 hours 1 minute, one adapter in every invocation. Each fits its stale threshold (15 minutes, 6 hours, 45 minutes, 2 days). No new trigger and no shared invocations. Weather adds one subrequest and one small parse; its CPU in workerd is not measured yet and should be checked in Workers Observability after the first deploy, as ADR 0009 asks for every adapter.

### Contracts

`weather` joins `sourceIds`, the fixtures (`open-meteo/raw/*`, `weather/snapshot/*`), the MSW handlers and the contract corpus. Its whole envelope is exported as `schema/weather.{input,output}.json` and frozen as `test/frozen/v1/weather.output.json`. ADR 0008 has the compatibility note: the generic envelope's frozen consumer lists only the first five sources.

### The site: a browser-only enhancement

The build never reads weather: it is not in the reader's sources and no page renders it, so a page built hours ago cannot claim the weather now. In `api` mode `index.astro` puts `data-weather-src="${SIGNALS_API_BASE}/v1/weather"` on `.scene`; in `fixtures` mode (local, CI, Previews) there is no attribute, no request and no weather, and sample weather is never shown as current. ADR 0015 records the exception. With another `SIGNALS_API_BASE`, `connect-src` blocks the request (ADR 0019) and the room shows no weather.

`src/scripts/room.ts`, the room clock:
- Asks on load if the page is visible, then on a minute tick or on becoming visible only when 15 minutes have passed since the last request. One request at a time, with `AbortSignal.timeout(5000)`, which covers the headers and the body. No cache-busting: the browser may answer from its 60-second cache.
- `readWeather` (`src/lib/weather.ts`) decides whether an answer is usable: `source` is `weather`, `version` 1, `stale` false, `fetchedAt` and `data.observedAt` are strings that parse, neither is more than 2 minutes ahead of the visitor's clock, neither is more than 45 minutes old (equal is fresh, as in `isStale`), the code is one Open-Meteo documents, and the temperature is a number or null. Anything else, a failure, or the deadline clears the weather. A usable state is kept until a request ends or until it is 45 minutes old, whichever comes first.
- The minute tick drops weather past its age limit without asking anything, and so does a tab coming back to visible, before it asks again. A later usable answer brings the weather back.
- `tick()` owns the whole window: `data-sky`, `data-weather` (`clear`, `cloudy`, `fog`, `rain`, `snow`, `storm` or `none`) and the label, so the label never keeps an old temperature. Day: "Through the window: daylight over Rabat, slight rain, 14 °C." Night: "Through the window: night over Rabat, a full moon, overcast, 9 °C." With no usable weather, the label is ADR 0027's. The temperature is only in the label.

**Codes.** `weatherCodes` in `src/lib/weather.ts` is the one table: every code in Open-Meteo's "WMO Weather interpretation codes (WW)" (https://open-meteo.com/en/docs, retrieved 2026-10-26), with Open-Meteo's own words and one picture: 0 and 1 clear; 2 and 3 cloudy; 45 and 48 fog; 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81 and 82 rain; 71, 73, 75, 77, 85 and 86 snow; 95, 96, 97 and 99 storm. The words keep the intensity, freezing and hail distinctions the picture drops. Any other code shows nothing. These are WMO's present-weather codes as Open-Meteo applies them to model output, not code table 4677 as stations report it: in 4677, codes 00 to 03 describe how clouds developed over the past hour, where Open-Meteo means clear to overcast, and where 4677 says "moderate or heavy" (57, 67, 81, 86) Open-Meteo names one intensity. `test/weather.test.ts` checks the table against Open-Meteo's published JSON, code by code, and spot-checks five codes against 4677 (45, 61, 71, 82, 95) as the Japan Oceanographic Data Center publishes it (https://www.jodc.go.jp/data_format/weather-code.html, retrieved 2026-10-26); for those five the phenomenon, and so the picture, is the same.

### The art

`scripts/scene.py` (`just scene`) draws ten layers, `weather-{cloudy,fog,rain,snow,storm}-{day,night}.png`, inside the same `draw()` as the room: the room's 41 colours, its Bayer dither, and the window's view mask, so the frame, the mullions and the lamp stay in front. Each is the full 480x160 scene, transparent but for the weather, like the window layers. A layer's soft edges are ordered-dither transparency: how much of a pixel the weather covers decides, against the Bayer matrix shifted half a tile, whether it is opaque. A partial cover lets the sky, the stars and the moon show through. The script fails if a weather layer uses a colour outside the 41; it quantizes them onto the palette itself, since the octree quantizer the room uses averaged two near-blacks into a colour off it.
- Cloudy: six dithered puffs, light-topped by day, dark and city-lit from below at night. Fog: a veil over the whole view, thicker low down. Rain and storm: a low deck, lower and darker for storms. Snow: a deck, flakes (by day each with a darker pixel under it, or white on a pale sky would not show) and snow on the top edge of every roof, dome and the minaret.
- Falling rain is `weather-drops-{day,night}.png`, a 16x16 tile of streaks, on `.room-weather::before` (and a second sheet, half a tile over, on `::after` for storms). The pseudo-elements start one tile above the scene; without `prefers-reduced-motion` they move down one tile in 16 steps of one scene pixel and loop, in CSS only. With reduced motion, from the start or changed while the page is open, the animation is not applied (and `base.css`'s global rule would stop it anyway), and the streaks hang still: every layer means something as a still image. No lightning: a flash is a hazard and adds nothing a still storm does not.
- The streaks are cut to the view with `mask-image`, using the window layer on screen (`window-{day,dusk,night}.png`), which is already downloaded.
- The picture follows `data-sky`, the room's own clock: the day layer by day, the night layer at night and at dusk. Never the page theme, and never Open-Meteo's `is_day`.
- `.room-weather` sits after the moon and before the note and the hotspots: over the sky and the moon, under every link, with `pointer-events: none` and `aria-hidden`, so it adds nothing to the accessibility tree.

Sizes: 0.7 to 1.0 KiB per layer, 138 B per drops tile, 8.7 KiB for all twelve. A visit downloads at most one layer and one tile, and only once a usable answer arrives.

### Cost

| What                              | Before   | After                          | Limit                                  |
| --------------------------------- | -------- | ------------------------------ | -------------------------------------- |
| Room script, gzip 9               | 1,541 B  | 2,294 B                        | 2,300 B (was 1,700 B; ADR 0017)        |
| Home islands JS                   | 20,465 B | 20,465 B                       | 20,480 B                               |
| Home weight, fonts excluded       | 71,109 B | 81,395 B                       | 153,600 B (every weather file counted) |
| Upstream requests (Open-Meteo)    | 0        | ~96 a day                      | under 10,000 a day                     |
| Browser requests to `/v1/weather` | 0        | 4 an hour per visible home tab | Workers Free 100,000 a day (ADR 0010)  |

The room script holds the code table and its words (about 290 B gzip), the request, the checks and the expiry. To fit, it lets `AbortSignal.timeout` bound the request and has one function render the whole window; no check was dropped. It has 6 B of headroom.

Lighthouse on the built site (`just lighthouse`, median of three runs, 2026-10-26) scores the home page 100 for performance and accessibility on mobile and desktop, with LCP at 1,660 ms on mobile and 409 ms on desktop. That build is in `fixtures` mode, which asks for no weather, so it measures the room script's size and not a weather layer; the layer is a small decorative image that loads after the answer, behind the room picture that is the LCP element.

## What it falls back to

| Case                                                       | The window shows                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| No JavaScript                                              | The theme's static window, no moon, no weather (ADR 0027)                            |
| `fixtures` mode, or no endpoint                            | The clock's sky, moon and lamp; no request, no weather                               |
| Before the first answer                                    | The clock's sky and moon, no weather                                                 |
| Failed request, non-JSON, invalid envelope, timeout at 5 s | No weather                                                                           |
| `stale: true`, or either time older than 45 min            | No weather                                                                           |
| Either time over 2 min in the future, or unreadable        | No weather                                                                           |
| Code Open-Meteo does not document, null or not an integer  | No weather and no temperature                                                        |
| Upstream down or refusing                                  | signals keeps the last snapshot; the room shows it until it is 45 min old, then none |
| Clear sky                                                  | The clock's sky as it is, and "clear sky" or "mainly clear" in the label             |
| Reduced motion                                             | The same weather, with the rain still                                                |
| Tab hidden past the limit                                  | No weather the moment it is visible again, then a new request if one is due          |

## Consequences

- The room needs signals' weather to be fresh: an Open-Meteo outage over 45 minutes empties the window, by design.
- Listening skips a minute more per quarter hour; its now-playing state still ends within its 15-minute threshold.
- The room script has 6 B left under its 2,300 B allowance, the ceiling the owner set. The next addition to it needs a decision first.
- The first deployed pull, and the cron's CPU with weather in it, should be checked in `/v1/health` and Workers Logs after the deploy.
- If Open-Meteo changes its codes or terms, this ADR and `weatherCodes` change with them.

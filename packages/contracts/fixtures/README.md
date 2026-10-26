# Fixtures

One shared fixture set for every test and for the site's offline `fixtures` data mode.

```
fixtures/<upstream>/raw/<case>.json    what a pull adapter's `fetch` returns for that upstream
fixtures/<source>/snapshot/<case>.json normalized snapshot the adapter must produce
```

Raw fixtures are per upstream (`lastfm`, `repo-pulse`, `github`, `npm`); snapshots are per source id from `src/sources.ts` (`listening`, `shipping`, `projects`). The `projects` source is built from `github` and `npm` together: case `<case>` of the snapshot comes from case `<case>` of both.

A raw fixture records each upstream answer as `{ "status": <HTTP status>, "body": <JSON body or null> }`; `null` in place of an answer is a request that failed (network error, timeout, body over the size limit). Last.fm and GitHub need several requests per snapshot, so their raw fixtures are an object of such answers, keyed by request (`recentTracks`, `topArtists`, `thisWeek`, `lastWeek`) or by repository and package.

| Case           | Meaning                                                                             |
| -------------- | ----------------------------------------------------------------------------------- |
| `ok`           | A full, typical response.                                                           |
| `empty`        | Valid but with no items (new account, quiet week, every repository gone).           |
| `partial`      | Optional fields missing or null, and some requests failing on their own.            |
| `malformed`    | Wrong types or broken shape; the adapter throws a `PullError`, never anything else. |
| `missing`      | The upstream returned nothing usable (404, refused); only `raw/` exists.            |
| `single-item`  | Last.fm only: a list of one returned as a bare object.                              |
| `error-in-200` | Last.fm only: an error body sent with HTTP 200.                                     |

Every file must be imported in `src/fixtures.ts`; a test fails otherwise. `src/testing.ts` builds MSW handlers from the raw fixtures for tests (`@min7/contracts/testing`, never imported by production code).

The Last.fm and GitHub `ok` cases are real public data from 2026-10-26. The repo-pulse cases are **sample data**: repo-pulse does not serve its feed yet (ADR 0012).

Fixtures hold public data or invented values only, never tokens or private fields.

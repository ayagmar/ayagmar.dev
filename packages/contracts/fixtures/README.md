# Fixtures

One shared fixture set for every test and for the site's offline `fixtures` data mode.

```
fixtures/<source>/raw/<case>.json       upstream response as the adapter receives it
fixtures/<source>/snapshot/<case>.json  normalized snapshot the adapter must produce
```

`<source>` is a source id from `src/sources.ts` (`listening`, `shipping`, `projects`, `llm-usage`, `shelf`). Cases:

| Case        | Meaning                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------- |
| `ok`        | A full, typical response.                                                                   |
| `empty`     | Valid but with no items (new account, quiet week).                                          |
| `partial`   | Optional fields missing or null.                                                            |
| `malformed` | Wrong types or broken shape; the adapter must reject it without throwing past its boundary. |
| `missing`   | The upstream returned nothing usable (404, empty body); only `raw/` exists.                 |

Fixtures hold public data or invented values only, never tokens or private fields.

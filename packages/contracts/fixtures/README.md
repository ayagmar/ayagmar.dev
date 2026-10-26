# Fixtures

One shared fixture set for every test and for the site's offline `fixtures` data mode.

```
fixtures/<source>/raw/<case>.json                    upstream response as the adapter receives it
fixtures/<source>/snapshot/<case>.json               normalized snapshot the adapter must produce
fixtures/<producer>/push/{accept,reject}/<case>.json push bodies (llm-usage, trellis)
```

Push bodies are the payload corpus of `push-<producer>` (checked by zod and the exported JSON Schema in `test/json-schema.test.ts`) and the inputs of the Worker's intake tests. `fixtures/llm-usage/snapshot/` and `fixtures/shelf/snapshot/` hold what signals publishes for the accepted push cases of the same name.

| Push case          | Meaning                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `ok`               | A full, typical push.                                                                                  |
| `minimal`          | Empty lists and null costs.                                                                            |
| `sensitive-fields` | Valid, with unknown and sensitive extra fields and unlisted ids; none of them may be stored or served. |
| `reject/*`         | Wrong types, ranges or shape; every validator must reject them.                                        |

The oversized case is built by the intake test (a valid body padded to 64 KiB and one byte more) rather than kept as a 64 KiB file.

`<source>` is a source id from `src/sources.ts` (`listening`, `shipping`, `projects`, `llm-usage`, `shelf`). Cases:

| Case        | Meaning                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------- |
| `ok`        | A full, typical response.                                                                   |
| `empty`     | Valid but with no items (new account, quiet week).                                          |
| `partial`   | Optional fields missing or null.                                                            |
| `malformed` | Wrong types or broken shape; the adapter must reject it without throwing past its boundary. |
| `missing`   | The upstream returned nothing usable (404, empty body); only `raw/` exists.                 |

Fixtures hold public data or invented values only, never tokens or private fields.

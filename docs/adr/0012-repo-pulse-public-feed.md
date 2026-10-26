# 0012. repo-pulse public feed contract

Status: accepted, 2026-10-26. repo-pulse serves it since ayagmar/repo-pulse#28, and the `503` rule below since ayagmar/repo-pulse#29 (deployed 2026-10-26).

## Context

repo-pulse (a separate Worker, `ayagmar/repo-pulse`) records every GitHub webhook event of the owner's repositories in D1: stars with the running count, pushes to the default branch, pull requests, issues, forks and releases, with the sender and whether the repository is private. The site's shipping section needs recent public activity and star history from it, through signals, without repo-pulse exposing anything else. repo-pulse has no public read route today.

## Decision

repo-pulse adds one unauthenticated, read-only route. signals is its only planned consumer (`apps/signals/src/adapters/pull/shipping.ts`, ADR 0009); the site never calls it.

```
GET https://repo-pulse.ayagmar.workers.dev/public/feed?limit=50
```

Query:

| Parameter | Rule                                                    |
| --------- | ------------------------------------------------------- |
| `limit`   | Integer 1 to 100, default 50. Maximum number of events. |
| other     | Ignored, and not part of the cache key.                 |

An invalid `limit` answers `400 {"error":"invalid_query"}`. Only `GET` and `HEAD`; anything else is `405`.

Response `200`, `Content-Type: application/json`. The schema is `packages/contracts/schema/repo-pulse-feed.input.json` (generated from `repoPulseFeedSchema` in `packages/contracts/src/snapshots/shipping.ts`); repo-pulse should validate its output against it in its tests.
- `version`: always `1`. A breaking change ships `/public/feed/v2` next to this one.
- `generatedAt`: RFC 3339, when the response was built.
- `events`: newest first, at most `limit`. Each has `type`, `repo` (`owner/name`), `at` (RFC 3339, when repo-pulse received the event) and the fields of its type:

| `type`                | Extra fields                                                      | From repo-pulse's event          |
| --------------------- | ----------------------------------------------------------------- | -------------------------------- |
| `release.published`   | `url` (release page), `release.tag`                               | `release.tagName`, `release.url` |
| `star.created`        | `star.count` (stars right after this one)                         | `star.count`                     |
| `push.default_branch` | `url` (compare page), `push.commits` (number of distinct commits) | `push.compareUrl`, commit count  |
| `pull_request.merged` | `url`, `pullRequest.number`, `pullRequest.title`                  | `pullRequest.*`                  |
- `starHistory`: per public repository with star events, the star count at the end of each UTC day that had one, oldest day first, the last 90 days at most.

Every URL starts with `https://github.com/`.

Example:

```json
{
  "version": 1,
  "generatedAt": "2026-10-26T08:45:00Z",
  "events": [
    {
      "type": "push.default_branch",
      "repo": "ayagmar/runnerd",
      "at": "2026-10-25T21:14:00Z",
      "url": "https://github.com/ayagmar/runnerd/compare/3f2a1c0...9be47d2",
      "push": {
        "commits": 12
      }
    },
    {
      "type": "pull_request.merged",
      "repo": "ayagmar/ccdesk",
      "at": "2026-10-25T16:40:00Z",
      "url": "https://github.com/ayagmar/ccdesk/pull/41",
      "pullRequest": {
        "number": 41,
        "title": "Edit hooks from the dashboard"
      }
    },
    {
      "type": "star.created",
      "repo": "ayagmar/pi-mobile",
      "at": "2026-10-24T22:05:00Z",
      "star": {
        "count": 115
      }
    },
    {
      "type": "star.created",
      "repo": "ayagmar/pi-mobile",
      "at": "2026-10-24T19:31:00Z",
      "star": {
        "count": 114
      }
    },
    {
      "type": "star.created",
      "repo": "ayagmar/pi-mobile",
      "at": "2026-10-24T08:12:00Z",
      "star": {
        "count": 113
      }
    },
    {
      "type": "release.published",
      "repo": "ayagmar/llm-usage-metrics",
      "at": "2026-10-23T13:51:53Z",
      "url": "https://github.com/ayagmar/llm-usage-metrics/releases/tag/v0.14.1",
      "release": {
        "tag": "v0.14.1"
      }
    }
  ],
  "starHistory": [
    {
      "repo": "ayagmar/pi-mobile",
      "points": [
        {
          "date": "2026-10-22",
          "stars": 112
        },
        {
          "date": "2026-10-23",
          "stars": 112
        },
        {
          "date": "2026-10-24",
          "stars": 115
        }
      ]
    },
    {
      "repo": "ayagmar/llm-usage-metrics",
      "points": [
        {
          "date": "2026-10-22",
          "stars": 34
        },
        {
          "date": "2026-10-23",
          "stars": 35
        }
      ]
    }
  ]
}
```

Privacy rules. The feed is public, so it carries only what GitHub already shows publicly, and less:
- Public only, fail closed. Before it emits any event or `starHistory` entry of a repository, repo-pulse checks that repository's current visibility with `GET https://api.github.com/repos/{owner}/{repo}`. Only a `200` whose body says `"private": false` admits the repository. A `404`, `private: true`, any other status, a network error, a timeout, a rate limit or a body it cannot read omits it. The lookup sends either no token or `GITHUB_PUBLIC_TOKEN`, a fine-grained token limited to public repositories with no permissions, which only raises GitHub's limit from 60 to 5,000 lookups an hour; with it, private repositories still answer `404`. repo-pulse's `GITHUB_TOKEN`, which can read private repositories, is never sent. The `"private": false` check admits only public repositories whichever token is used. Each result, admitted or omitted, is cached for at most 60 seconds per repository, then looked up again.
- Webhooks never make a repository public. Visibility recorded from webhooks, `repository` lifecycle events (`privatized`, `deleted`) included, can hide a repository sooner than the gate would, but no recorded event, ordinary activity or `publicized`, admits one; only the gate does. So a delayed or replayed activity delivery recorded as public, or a missed `privatized` delivery, cannot put a private repository back in the feed.
- Within a public repository, only events that were themselves recorded as public. repo-pulse marks events recorded before it stored visibility as private (migration 0004); those never appear.
- Only the four types above. Issues, forks, star removals, other pull request actions and anything added later stay out until this contract lists them.
- Never the sender or any login, avatar, or follower count; never issue or pull request bodies, labels, commit messages, branch names other than through the compare URL, delivery ids, notable stargazers, referrers or traffic, digests, or delivery and provider state.
- Built from an explicit field list, not by removing fields from the stored event JSON, so a field repo-pulse starts storing later is not published by accident.

Caching: the gate runs on every response, cache hits included. repo-pulse may cache the gate-independent material, the D1 read of candidate events and star history before the gate, through the Cache API for up to 300 seconds under an internal key that the route never serves as is. Each response is built from that material, gated with the visibility cache above, then serialized. The gated response itself is sent with `Cache-Control: no-store` and never stored in the Cache API: a downstream copy could outlive the visibility cache, while the material cache already holds D1 reads to one per 300 seconds. The material cache key is the normalized `limit`. There is deliberately no `since` or other free-form parameter: each distinct value would miss the cache and cost a D1 read, letting anyone bypass it on a public route. signals pulls every 15 minutes. No CORS headers: browsers are not expected to call it. Without `GITHUB_PUBLIC_TOKEN`, GitHub allows 60 requests an hour per IP, shared with other Workers on Cloudflare's egress IPs; with it, 5,000 an hour. Either way a rate-limited gate omits repositories rather than publishing them: the feed shrinks, it does not leak.

Acceptance cases repo-pulse must test:
- Delayed or replayed public activity after privatization: a repository is privatized, then an activity webhook recorded as public arrives (late or replayed). The feed still omits the repository.
- Missed lifecycle delivery: a repository is made private on GitHub and no `repository` event is ever received. Once the cached visibility result is older than 60 seconds, the gate's lookup returns 404 and the feed omits the repository.
- Warmed cache after privatization: the material cache and the visibility cache are warm with the repository public, then it is made private. Within 60 seconds every response omits it, including responses built from the cached material.
- Gate failure: the visibility lookup times out, is rate limited or answers 5xx. The repository is omitted, not shown from an earlier answer older than 60 seconds.
- Gate outage: every candidate repository's lookup fails as above. The feed answers `503`, not an empty `200`.
- Denial plus failure: one candidate answers `404` (or `private: true`) and another candidate's lookup times out. Nothing is admitted and one candidate is unresolved, so the feed answers `503`, not an empty `200`.

Errors never include stack traces or D1 messages, and every one is sent with `Cache-Control: no-store`: `400`/`405` as above, `429 {"error":"rate_limited"}` past 10 requests a minute per client IP, `500 {"error":"internal_error"}`, and `503 {"error":"visibility_unavailable"}` when no repository was admitted and at least one candidate is unresolved. A candidate is unresolved when its lookup failed (a timeout, a network error, `403`, `429`, a 5xx, a redirect or a body it cannot read), when its cached answer is such a failure, or when the lookup budget left it unattempted. The feed is an empty `200` only when there are no candidates or every candidate got a definitive denial (a `404`, or a `200` with `"private": true`): an empty `200` means nothing is public, never that the gate failed. When at least one repository was admitted, the feed is a `200` with the admitted repositories even if other candidates are unresolved; the feed shrinks and signals stores it. signals treats `429` and `503` like any other failed pull and keeps its last snapshot.

## Consequences

- A repository made private leaves the feed within 60 seconds, signals' snapshot within 15 minutes after that, and the site at its next production build. Making a repository private is therefore not instant on ayagmar.dev; rebuild the site to speed it up.
- The producer schema is closed. A new event type or field is added to this contract first (a pull request here), then repo-pulse serves it; repo-pulse's tests validate against `repo-pulse-feed.input.json` and would reject it otherwise. Separately, signals reads leniently: it checks each event and each `starHistory` entry on its own and skips one it cannot read, so one bad item, or a type the deployed signals does not know yet, does not blank the shipping section.
- The `ok` fixture under `packages/contracts/fixtures/repo-pulse/` is a real response from 2026-10-26; the other cases are sample data in this shape.

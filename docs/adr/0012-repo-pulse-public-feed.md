# 0012. repo-pulse public feed contract

Status: proposed, 2026-10-26. repo-pulse does not serve this yet; tracked in an issue on `ayagmar/repo-pulse`.

## Context

repo-pulse (a separate Worker, `ayagmar/repo-pulse`) records every GitHub webhook event of the owner's repositories in D1: stars with the running count, pushes to the default branch, pull requests, issues, forks and releases, with the sender and whether the repository is private. The site's shipping section needs recent public activity and star history from it, through signals, without repo-pulse exposing anything else. repo-pulse has no public read route today.

## Decision

repo-pulse adds one unauthenticated, read-only route. signals is its only planned consumer (`apps/signals/src/adapters/pull/shipping.ts`, ADR 0009); the site never calls it.

```
GET https://repo-pulse.ayagmar.workers.dev/public/feed?limit=50&since=2026-10-01T00:00:00Z
```

Query:

| Parameter | Rule                                                        |
| --------- | ----------------------------------------------------------- |
| `limit`   | Integer 1 to 100, default 50. Maximum number of events.     |
| `since`   | Optional RFC 3339 timestamp. Only events strictly after it. |
| other     | Ignored.                                                    |

An invalid `limit` or `since` answers `400 {"error":"invalid_query"}`. Only `GET` and `HEAD`; anything else is `405`.

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
- Only repositories whose latest recorded visibility is public. repo-pulse today stores `repository.private` once per event and never re-checks it, so it must also subscribe to GitHub's `repository` webhook events and record `privatized`, `publicized`, `deleted` and `renamed`. A repository's visibility is the one in its newest recorded event of any type. When that is private or deleted, every earlier event of the repository and its `starHistory` drop out of the feed, even events recorded while it was public; a later `publicized` brings them back.
- Within a public repository, only events that were themselves recorded as public. repo-pulse marks events recorded before it stored visibility as private (migration 0004); those never appear.
- Only the four types above. Issues, forks, star removals, other pull request actions and anything added later stay out until this contract lists them.
- Never the sender or any login, avatar, or follower count; never issue or pull request bodies, labels, commit messages, branch names other than through the compare URL, delivery ids, notable stargazers, referrers or traffic, digests, or delivery and provider state.
- Built from an explicit field list, not by removing fields from the stored event JSON, so a field repo-pulse starts storing later is not published by accident.

Caching: `Cache-Control: public, max-age=300`, served through the Cache API keyed by the normalized query, so the D1 read runs at most once per five minutes per query and colo. signals pulls every 15 minutes. No CORS headers: browsers are not expected to call it.

Errors never include stack traces or D1 messages: `400`/`405` as above, `500 {"error":"internal_error"}`.

## Consequences

- A repository made private leaves the feed at once, signals' snapshot within 15 minutes, and the site at its next production build. Making a repository private is therefore not instant on ayagmar.dev; rebuild the site to speed it up.
- Until the route exists, signals gets a 404 every 15 minutes, records `upstream_not_found`, and the site renders the shipping empty state.
- Additions within v1 are new optional fields or new event types. signals checks events one by one and skips types it does not know, so repo-pulse can ship a new type before signals reads it.
- The shared fixtures under `packages/contracts/fixtures/repo-pulse/` are sample data in this shape; replace the `ok` case with a real response once the route is live.

# Search engines and analytics

What ayagmar.dev tells search engines, where each piece is set, and the dashboard steps that live outside the repo.

## What is set where

| What                                 | Where                                                  | Notes                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<title>`, meta description          | `Base.astro`, each page's `title` and `description`    | Home's title is `site.title` (`src/lib/site.ts`); every other page is `<title> \| min7`. Posts use their `summary`, notes their first paragraph, projects their GitHub description.                                                          |
| Canonical link                       | `Base.astro`                                           | Always production's URL, also on Previews.                                                                                                                                                                                                   |
| Structured data (JSON-LD)            | `src/lib/structured-data.ts`, rendered by `Base.astro` | Home: `WebSite` and `Person` (from `content/about.json`). /about: those and a `ProfilePage`. Posts and notes: `BlogPosting` (dates, author, link-preview image, tags as keywords) and a `BreadcrumbList`. Project pages: a `BreadcrumbList`. |
| `noindex`                            | the page's `noindex` prop                              | Tag pages (a filtered copy of /writing with no text of their own), drafts (built only for Previews) and the 404 page.                                                                                                                        |
| Sitemap                              | `@astrojs/sitemap`, then `src/lib/sitemap.ts`          | The second step reads the built pages: it drops every `noindex` page and gives posts and notes a `<lastmod>`, the `dateModified` of their JSON-LD (`updated`, else `date`).                                                                  |
| robots.txt                           | `src/pages/robots.txt.ts`                              | Lets every crawler in and names the sitemap. See below for what Cloudflare adds.                                                                                                                                                             |
| IndexNow key                         | `indexNowKey` in `src/lib/search.ts`                   | Served at `/<key>.txt`. Public by design.                                                                                                                                                                                                    |
| Search Console and Bing verification | `siteVerification` in `src/lib/search.ts`              | Empty renders nothing; a token renders `google-site-verification` or `msvalidate.01` on every page.                                                                                                                                          |
| Cloudflare Web Analytics             | `cloudflareAnalytics` in `src/lib/search.ts`           | The beacon is on every page of production builds only (ADR 0019); the CSP and the budgets allow exactly its script and report origins (ADR 0017).                                                                                            |

Every site build ends with `apps/site/scripts/seo-check.ts`, which fails the build when a page lacks exactly one canonical link, a title or a description, shares a title or description with another page, or has JSON-LD that does not parse or a node without `@type`; when a post or note has no `BlogPosting`; or when the sitemap lists a page that is missing, `noindex`, a draft, or under another canonical URL, or dates it differently from its JSON-LD. Two project pages with the same description only print a warning: that text comes from GitHub at build time, and a repo's description must not stop production deploying.

## robots.txt and Cloudflare

Cloudflare's [managed robots.txt](https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/) is on for the zone. Cloudflare puts its block above the site's own file and serves both as one response. On 2026-11-01 that block was the Content Signals Policy text, which defines `search`, `ai-input` and `ai-train` and sets no preference, with no rules. The site's part comes after it:

```
User-agent: *
Allow: /

Sitemap: https://ayagmar.dev/sitemap-index.xml
```

`Allow: /` for every crawler is what having no rules meant, so this changes no crawler's access, AI crawlers included. AI crawler policy stays in the Cloudflare dashboard (AI Crawl Control and the managed robots.txt). Check the result with `curl https://ayagmar.dev/robots.txt`.

## Google Search Console

1. Add a property. A **Domain** property (`ayagmar.dev`) covers every subdomain and is verified with a DNS TXT record in the Cloudflare zone. A **URL prefix** property (`https://ayagmar.dev/`) can use the HTML tag: put the `content` value in `siteVerification.google`, merge, wait for the deploy, then press Verify.
2. **Sitemaps:** submit `https://ayagmar.dev/sitemap-index.xml`.
3. **URL Inspection** on a page shows the canonical Google chose and the structured data it found. The [Rich Results Test](https://search.google.com/test/rich-results) shows the same for any URL.

## Bing Webmaster Tools

1. Add the site. Importing it from Search Console verifies it with no token. Otherwise use the meta tag: put the `content` value in `siteVerification.bing`, merge, deploy, verify.
2. **Sitemaps:** submit `https://ayagmar.dev/sitemap-index.xml`.
3. **IndexNow** in the dashboard lists the URLs the site has pinged.

## IndexNow

One ping to `api.indexnow.org` reaches every participating engine: Bing, Yandex, Seznam, Naver, Yep and Amazon ([indexnow.org](https://www.indexnow.org/faq), checked 2026-11-01). Google does not take part. Neither do Brave or DuckDuckGo, as far as indexnow.org lists. DuckDuckGo's results draw largely on Bing's index, so a ping reaches it through Bing. Brave runs its own index, so it finds pages by crawling, helped by the sitemap in robots.txt.

`just site-deploy` (Workers Builds' deploy command) does it on every production deploy, with no secret: before `wrangler deploy` it saves the live sitemap, and after it pings the pages that are new, gone, or have a new `<lastmod>`. Pages without a `<lastmod>` (home, /stats and the others with live data) are pinged only when new. Neither step can fail or hold up the deploy: each request gives up after 5 seconds, and a failure only logs a line.

By hand:

```sh
just indexnow                                  # every URL in the live sitemap (once, after the key file is live)
just indexnow https://ayagmar.dev/writing/a    # just these
```

If Cloudflare's **Crawler Hints** is on for the zone, Cloudflare also sends IndexNow pings when cached content changes; the two do not conflict.

## Cloudflare Web Analytics

Set to **Enable with JS Snippet installation** in the dashboard: automatic injection never reached the HTML the Worker serves. The page renders the snippet itself, on production builds only, with the token from `src/lib/search.ts`. Numbers appear under **Analytics & Logs → Web Analytics**. To turn it off, empty the token: the beacon, its CSP origins and the colophon's sentence about it all go with it.

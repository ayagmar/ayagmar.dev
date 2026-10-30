# 0036. Comments on posts and notes with giscus

Status: accepted, 2026-10-30

## Context

The owner wants readers to be able to comment publicly on every post and TIL note. Anyone may read the comments; writing one needs a GitHub account. The site has no server of its own for user input, ships no tracking, and its colophon says it loads no third-party scripts. "Reply by email" (ADR 0035) stays.

## Decision

- **giscus, in GitHub Discussions.** Comments are Discussions in `ayagmar/ayagmar.dev`, category "Comments" (announcement format, so only the page's own thread can be started by the app), shown by giscus. The giscus GitHub App is installed on that one repository. The repository and category ids are in `comments` in `src/lib/site.ts`, once; `https://giscus.app/api/discussions/categories?repo=ayagmar/ayagmar.dev` lists them.
- **Nothing loads until asked.** Under the reply link every post and note has a "Comments" window (`Comments.astro`, the panel chrome of ADR 0034). Its "Show comments" button is hidden until `src/scripts/comments.ts` runs. Pressing it adds one `<iframe>` to the window. Before that, the page makes no request to giscus.app.
- **No third-party script.** giscus's `client.js` only builds an iframe URL and relays a few messages, so the page does the same: `widgetUrl` in `src/lib/comments.ts` builds the URL from the parameters `client.js` sends (compared with the file on 2026-10-30), and the script handles the widget's `message` events. The only code from giscus.app that runs is in its own frame. Consequence: if giscus renames a widget parameter, the frame breaks until `widgetUrl` follows it; `client.js` would have followed by itself.
- **Frame, not script, in the policy.** The Content-Security-Policy gains `frame-src https://giscus.app` and nothing else; `default-src 'none'` still covers the rest. The widget's own `frame-ancestors` accepts the page's `origin` parameter, so Previews and local runs frame it too.
- **One thread per page, kept by name.** Mapping is "specific": the term is the collection and slug, `writing/<slug>` or `til/<slug>`, with `strict=1`. Renaming a title or moving a path does not orphan the thread; renaming a slug does, which is a deliberate act. giscus creates the Discussion when the first comment or reaction is posted.
- **Theme.** `noborder_light` and `noborder_dark`, giscus's own themes, so the window's frame is the site's. A custom stylesheet would have to be served from the site and tracked per Preview origin. The page chooses by the site's switch (`data-theme` on `<html>`) or, on auto, the system preference, and follows both live by `setConfig` messages. A switch before the frame has answered is sent once it does, so a frame never keeps the theme it was created with.
- **Messages.** `readMessage` accepts a message only from `https://giscus.app`, from the frame's own window, shaped like giscus's (`{ giscus: { resizeHeight | signOut | error } }`). Heights outside 1 to 20,000 px are dropped. The reader's sign-in is kept in `localStorage` under giscus's own key, `giscus-session`, as `client.js` does; the widget returns to the page with `?giscus=<token>`, which the script stores and removes from the address, then opens the window again.
- **Failure.** If the widget sends nothing within 10 seconds (blocked, offline, down), the window says "Comments could not load" and keeps the link. The window reserves two lines for that status, so loading, failed and ready do not move what follows. An answer after the 10 seconds still shows the thread.
- **No script, or no frame.** Without JavaScript the window shows a link to the page's discussion on GitHub, a search for the term in the Comments category. It is also shown beside the button, and after a failure.
- **Not in feeds, search or the sitemap.** The window is outside `data-pagefind-body`'s indexed text (`data-pagefind-ignore`) and is not part of any feed item. The built feeds and sitemap are byte-identical to `main`.
- **Colophon** says comments are GitHub Discussions loaded from giscus.app only when asked.

## Not done

- The frame is not sandboxed. giscus's sign-in needs same-origin storage and a top-level redirect; a `sandbox` list that is right for that could not be tested without signing in as a reader.
- No custom giscus theme, no `lazy` loading attribute (the frame is only created on a press), no `allow="clipboard-write"` (nothing in the widget needs it).

## Consequences

- A reader who presses the button sends their IP address and the page address to giscus.app (Vercel) and GitHub, which the colophon says.
- A post or note page carries 1.4 KB more gzipped JavaScript (18.2 to 19.6 KB), inside the existing 20 KB allowance for pages with an island but with little room left (`just budgets`).

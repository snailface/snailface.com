---
name: site-check
description: Run the snailface.com smoke-test checklist. Use whenever the user says "check the site", "smoke test", "verify the site works", "run site checks", or wants confidence the site is healthy after changes.
---

# Site check

Full verification pass for snailface.com. No build step, no test suite —
this checklist IS the test suite. Run every section; report at the end.

## 1. Static syntax

- Extract every inline `<script>` from index.html, map.html, post.html,
  404.html, thank-you.html into the scratchpad and run `node --check` on
  each.
- Confirm brace balance ({ vs }) in style.css, alt.css, and every inline
  `<style>` block in those pages.

## 2. Couplings

- Every `<link rel="preload">` href must be byte-identical to its consumer:
  - `eye.svg?v=N` in index.html vs the fetch URL in eye-interact.js
  - font preload vs the `@font-face` src in all four copies (style.css,
    alt.css, map.html, post.html)
- Grep every `*.svg`, `*.css`, `*.js` reference across the HTML/CSS/JS:
  each must carry a `?v=` query. List any that don't.

## 3. Data integrity

- `map-photos/posts.json` parses as JSON, has no duplicate entries.
- Every listed `.md` exists in `_posts/`; every `_posts/*.md` is in the
  manifest (missing ones silently never render).
- Every front matter has title, place, type, and coords; coords parse and
  fall within ±90 lat / ±180 lon.
- Every photo AND its `-480` / `-1400` derivatives exist on disk.
- Post slugs (filename minus date prefix and `.md`) are unique — they are
  the `/trail/<slug>` URL keys.
- sitemap.xml parses as XML and contains exactly one `/trail/<slug>` entry
  per manifest post.

## 4. Runtime

Start `python3 -m http.server 8765` from the repo root (background), then
with browser tools:

- **index.html** — eye SVG injects; zero console errors.
- **map.html** — pin count equals posts.json length; `#lost-snails` is
  empty; open a popup and confirm its photo loads. NOTE: photos are
  `loading="lazy"` and defer in background browser tabs — always verify in
  the ACTIVE tab before concluding anything is broken. Search must find a
  post by its accented spelling AND the unaccented form.
- **post.html?p=/_posts/\<any post\>.md** — article renders, photo shows,
  clicking it opens the lightbox. (`/trail/<slug>` 404s under http.server —
  expected; the Functions runtime only exists on Pages/wrangler.)
- **functions/trail/[slug].js** — test its logic with a Node harness: copy
  it to a `.mjs` name in the scratchpad (repo `.js` is CJS to Node 16), shim
  `Response` and stub `env.ASSETS.fetch` against the local server, then
  assert: a valid slug returns 200 with rewritten `<title>`, canonical,
  og:image, `data-prerendered` main, and the article h1; an unknown or
  hostile slug (`../x`, uppercase, dots) returns 404 with the 404 page. Its
  rendering must match post.html's `render()` — spot-check one post both
  ways.
- **404.html and thank-you.html** — footer year renders, font loads, zero
  third-party network requests.

Kill the server when done.

## 5. Report

Pass/fail per item, most severe failures first.

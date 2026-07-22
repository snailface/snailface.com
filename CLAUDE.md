# snailface.com

Static site on Cloudflare Pages. No build step, no framework, no test suite —
plain HTML/CSS/JS served straight from the repo root. Verification is
`node --check` on extracted inline scripts plus a local
`python3 -m http.server` + browser pass.

## Adding a post / pin to the trail map

Use the `add-post` skill — it covers photo ingestion (including pulling a
chat-pasted image off the macOS clipboard), geocoding, derivatives, the
manifest, and verification. Key fact: the map renders only what
`map-photos/posts.json` lists.

## Post URLs: /trail/&lt;slug&gt;

Canonical post URLs are `https://snailface.com/trail/<slug>` (slug = post
filename minus the `YYYY-MM-DD-` prefix and `.md`), served by
`functions/trail/[slug].js` — a Pages Function that pre-renders the article
server-side with per-post title/description/canonical/OG tags. Key contracts:

- The function uses **post.html as its template** and rewrites `<title>`, the
  description meta, and `<main>` (marking it `data-prerendered="1"`, which
  makes post.html's inline script skip its client fetch). Its `articleHtml()`
  and `parsePost()` MUST stay in sync with `render()`/`parsePost()` in
  post.html — a drift means /trail/ pages and ?p= pages render differently.
- **Slugs must stay unique across `_posts/`** regardless of date.
- `post.html?p=...` remains as the permanent fallback: it's the local-dev
  path (no Functions runtime under `python3 -m http.server`) and the old-link
  path (production JS-redirects it to /trail/). map.html's popup links are
  localhost-aware for the same reason.
- Full local testing of /trail/ needs `npx wrangler pages dev .`; without it,
  test the function logic via a Node harness stubbing `env.ASSETS.fetch`
  (Node 16 here: copy the function to a `.mjs` name first, and shim
  `Response`/`fetch`).
- sitemap.xml lists the /trail/ URLs with `<lastmod>` — regenerate it when
  posts change (the add-post skill covers this).

## Rules that aren't obvious from the code

- **Immutable caching + version queries.** `_headers` serves
  svg/css/js/png/jpg/woff2 as `immutable, max-age=31536000`. Every reference
  carries a `?v=N` query; if you edit one of these assets you MUST bump the
  version in every referencing file, or returning visitors keep the old copy
  for a year. HTML is always revalidated; `/_posts/*` gets 5 minutes.
- **Cloudflare Pages serves the repo root verbatim.** Anything not
  dot-prefixed is publicly fetchable. Tooling lives in `.tools/`.
- **`pace-race.html` is deliberately read-only (mode 0400).** Leave it
  alone; don't chmod it.
- **map.html and post.html are self-contained** — they do NOT link
  style.css. The Montserrat `@font-face` is duplicated in four places
  (style.css, alt.css, map.html, post.html) and must stay in sync.
- **Hand-rolled front-matter parser** in map.html/post.html: scalar
  `key: value` lines (`^\w+:`) and one-level `- item` lists only.
- **Fonts are self-hosted** (`fonts/montserrat-latin.woff2`, variable
  100–900, latin subset only — covers every accented char the site uses).
  Don't reintroduce Google Fonts links.
- Leaflet map: the "one world" constraint is enforced by the computed
  minZoom, not by `noWrap` — east/west wrap is intentional. `maxBounds`
  longitudes must stay finite (±Infinity poisons Leaflet's clamp with NaN).

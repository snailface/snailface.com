---
name: add-post
description: Ingest a photo and create a trail-map post (pin) for snailface.com. Use whenever the user wants to add a photo, post, pin, visit, restaurant, or sight to the map — including when they just paste an image and name a place.
---

# Add a trail-map post

Each pin on /map.html is one markdown post plus one photo with generated
derivatives. The map renders ONLY what `map-photos/posts.json` lists — a post
file that isn't in the manifest silently never appears.

## Required inputs (ask for any the user hasn't given)

- **title** — the venue/place name, in full ("Restaurant Pearl Morissette",
  never shortened)
- **place** — comma-separated, MUST end in the country: the last segment
  becomes the country filter chip ("Jordan Station, Ontario, Canada")
- **type** — `food`, `sights`, or `sounds` (controls the snail pin tint)
- **date** — drives the filename; only "Month YYYY" ever displays, so if the
  user gives only month+year, pick day 15 and tell them it's arbitrary
- **the photo** — see acquisition below
- **coords** — see below; never guess them

## 1. Acquire the photo

In priority order:

1. A file path the user gives → use it.
2. **The clipboard.** An image pasted into chat arrives as pixels you cannot
   save — but it is almost always still on the macOS clipboard. Check and
   extract:

   ```bash
   osascript -e 'clipboard info'   # look for "JPEG picture"
   osascript -e 'set d to the clipboard as JPEG picture' \
     -e 'set f to open for access POSIX file "SCRATCHPAD/clip.jpg" with write permission' \
     -e 'set eof f to 0' -e 'write d to f' -e 'close access f'
   ```

3. Neither → ask the user to copy the photo (⌘C) or give a path. Do not
   proceed with a photo-less post unless they say so (the site degrades
   gracefully — popup goes text-only — but that's a stopgap, not a goal).

**Always Read the extracted image and look at it** before installing:
confirm it's the right photo AND scan the edges for baked-in UI (messaging
"From ..." pills, screenshot chrome, status bars). If found, crop losslessly:

```bash
jpegtran -crop WxH+X+Y -copy none -outfile out.jpg in.jpg
```

(`sips` crop offsets are silently ignored — do not use sips for cropping.
jpegtran rounds to 8/16px block boundaries; re-check the result visually.)

## 2. Coordinates — in this order, never guessed

1. **EXIF GPS from the original file** (clipboard extractions never have it):
   `mdls -name kMDItemLatitude -name kMDItemLongitude photo.jpg`
2. **Geocode the place** via Nominatim, then show the user the resolved
   display_name so they can veto it:
   `https://nominatim.openstreetmap.org/search?q=<query>&format=jsonv2&limit=5`
   Full addresses often return `[]` — retry with looser queries (street +
   town beat street + full municipality: "Samudra Mawatha, Dehiwala" worked
   where the full form failed).
3. Both fail → ask the user.

Round to 5 decimals (~1 m), matching the existing posts.

## 3. Create the files

Photo → `map-photos/<slug>.jpg` (slug = kebab-case of the title; filename
must match the `photos:` line exactly). The original stays untouched as the
archival copy.

Post → `_posts/YYYY-MM-DD-<slug>.md`:

```markdown
---
layout: post
title: Restaurant Pearl Morissette
place: Jordan Station, Ontario, Canada
type: food
coords: 43.15614, -79.35629
photos:
  - /map-photos/restaurant-pearl-morissette.jpg
---
One or two sentences in the house voice.
```

Parser constraints (both map.html and post.html hand-roll this): scalar keys
match `^(\w+):` only, lists are one level of `- item`, `coords` is a single
"lat, lon" string. No nesting, no quotes needed, no colons in values.

**Body voice:** short and sensory, about the plate or the scene in front of
you — what's on the dish, what the light was doing. Never rankings, stars,
history, or press-release framing. Read 2–3 existing posts first and match.

**Slug uniqueness check (before creating the file):** the post's clean URL is
`https://snailface.com/trail/<slug>`, resolved by matching the slug against
filenames in posts.json — so the slug must be unique across `_posts/`
regardless of date. `ls _posts/ | grep -- "-<slug>.md"` must be empty first.

Manifest → append the post path to `map-photos/posts.json` (valid JSON, keep
trailing entry comma-free).

Sitemap → regenerate `sitemap.xml` from the manifest (three static URLs plus
one `/trail/<slug>` entry per post with `<lastmod>` from the filename date —
see the existing file for the exact shape), then validate:
`python3 -c "import xml.etree.ElementTree as ET; ET.parse('sitemap.xml')"`.

## 4. Derivatives

```bash
bash .tools/make-derivatives.sh
```

Generates `<slug>-480.jpg` (map popup) and `<slug>-1400.jpg` (article).
Idempotent and deterministic — re-encoding existing photos produces
byte-identical files, so re-running is always safe. It also converts
Display-P3 → sRGB and strips metadata from derivatives only.

## 5. Verify (do not skip)

```bash
python3 -c "import json; json.load(open('map-photos/posts.json'))"
python3 -m http.server 8765   # repo root, background
```

Then in the browser on `http://localhost:8765/map.html`:

- pin count went up by one; `#lost-snails` is empty
- search finds the new title; the popup shows title, date, AND the photo
- if the photo reports 0×0 / `complete:false`: images are `loading="lazy"`
  and **defer in background browser tabs** — test in the active tab before
  concluding anything is broken
- open `post.html?p=/_posts/<file>.md`: article renders, photo shows,
  clicking opens the lightbox (this is the local stand-in for
  `/trail/<slug>` — the Functions runtime doesn't exist under http.server,
  so the clean URL 404s locally; that is expected, not a bug)
- sitemap.xml parses and contains the new `/trail/<slug>` entry

Kill the server when done.

After deploy, spot-check the real thing once:
`curl -s https://snailface.com/trail/<slug> | grep -c og:image` → should be 1
(server-rendered meta present), and the page should show the article without
a "loading the trail…" flash.

## Repo rules that bite here

- Cloudflare Pages serves the repo root verbatim: never leave scripts or
  temp files in `map-photos/` (tooling lives in `.tools/`, which starts with
  a dot and is excluded from deploys).
- Derivatives are cached immutable for a year under their filename. Never
  regenerate different pixels under the same name — if a photo is replaced,
  its filename (and the post's `photos:` line) must change.
- Accent handling is automatic: search folds diacritics (and æ/ø/å) at
  runtime, so titles/places should use the correct native spelling.

// Cloudflare Pages Function — pretty, crawlable post URLs.
//
//   /trail/<slug>  ->  server-rendered article for /_posts/YYYY-MM-DD-<slug>.md
//
// Why server-side: post.html is client-rendered, so to a crawler every post
// used to be the same thin "loading the trail…" page. This function returns
// real HTML per post — unique <title>, meta description, canonical, Open
// Graph tags (including the food photo), and the full article body — which
// is what makes the posts indexable and gives shared links real previews.
//
// How it renders: post.html itself is fetched from static assets and used as
// the template, so there is exactly ONE copy of the page's markup and CSS.
// This function only (a) rewrites <title> and the description meta, (b)
// injects canonical + OG tags before </head>, and (c) replaces the
// "loading the trail…" placeholder inside <main> with the rendered article,
// marking <main data-prerendered="1"> so post.html's own script skips its
// client-side fetch/render and just wires up the lightbox.
//
// KEEP IN SYNC: the article markup built in articleHtml() below must match
// render() in post.html's inline script — same classes, same photo fallback
// chain — so a server-rendered page and a client-rendered (?p=) page are
// pixel-identical. Same for the front-matter parser.
//
// Slugs must therefore stay unique across _posts/ regardless of date — the
// add-post skill checks this before creating a file.

const ORIGIN = "https://snailface.com"; // canonical/OG URLs always use prod

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Same front-matter subset the pages parse client-side: scalar `key: value`
// lines and one-level `- item` lists, body below the closing --- .
function parsePost(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const fm = {};
  let listKey = null;
  m[1].split(/\r?\n/).forEach((line) => {
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && listKey) { fm[listKey].push(item[1].trim()); return; }
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) return;
    if (kv[2] === "") { listKey = kv[1]; fm[listKey] = []; }
    else { listKey = null; fm[kv[1]] = kv[2].trim(); }
  });
  fm.body = m[2].trim();
  return fm;
}

function sizedPhoto(src, width) {
  return /^\/map-photos\/[^?#]+\.jpe?g$/i.test(src)
    ? src.replace(/\.jpe?g$/i, "-" + width + ".jpg")
    : src;
}

function dateLabelOf(p) {
  const m = p.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? MONTHS[parseInt(m[2], 10) - 1] + " " + m[1] : "";
}

// Must mirror render() in post.html exactly (classes, fallback chain).
function articleHtml(post, postPath) {
  const paras = (post.body || "").split(/\n\s*\n/).filter((p) => p.trim())
    .map((p) => "<p>" + esc(p.replace(/\s+/g, " ").trim()) + "</p>").join("");
  const photos = (post.photos || []).map((src) =>
    '<img src="' + esc(sizedPhoto(src, 1400)) + '" data-orig="' + esc(src) +
    '" alt="" title="click to enlarge"' +
    ' onerror="this.onerror=function(){this.style.display=\'none\';};this.src=this.getAttribute(\'data-orig\');" />'
  ).join("");
  const when = dateLabelOf(postPath);
  return '<div class="article-card">' +
    "<h1>" + esc(post.title) + "</h1>" +
    (post.place ? '<div class="place">' + esc(post.place) + "</div>" : "") +
    (when ? '<div class="when">' + esc(when) + "</div>" : "") +
    '<div class="body">' + paras + "</div>" +
    '<div class="photos">' + photos + "</div>" +
    "</div>";
}

// First paragraph, whitespace-collapsed, cut at a word boundary near 160.
function descriptionOf(post) {
  const first = (post.body || "").split(/\n\s*\n/)[0] || "";
  let d = first.replace(/\s+/g, " ").trim();
  if (d.length > 160) d = d.slice(0, 157).replace(/\s+\S*$/, "") + "…";
  return d || (post.title + " — a stop on the snailface trail map.");
}

async function notFound(env, request) {
  const res = await env.ASSETS.fetch(new URL("/404.html", request.url));
  return new Response(await res.text(), {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const slug = params.slug;

  // Slugs are kebab-case filename tails; anything else 404s before any fetch.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return notFound(env, request);

  // Resolve slug -> post file via the same manifest the map uses.
  const manifestRes = await env.ASSETS.fetch(new URL("/map-photos/posts.json", request.url));
  if (!manifestRes.ok) return notFound(env, request);
  const posts = await manifestRes.json();
  const postPath = posts.find((p) =>
    new RegExp("^/_posts/\\d{4}-\\d{2}-\\d{2}-" + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.md$").test(p)
  );
  if (!postPath) return notFound(env, request);

  const mdRes = await env.ASSETS.fetch(new URL(postPath, request.url));
  if (!mdRes.ok) return notFound(env, request);
  const post = parsePost(await mdRes.text());
  if (!post || !post.title) return notFound(env, request);

  // post.html is the single template; fetch it and rewrite in place.
  const tplRes = await env.ASSETS.fetch(new URL("/post.html", request.url));
  let html = await tplRes.text();

  const title = "snailface.com - " + post.title;
  const desc = descriptionOf(post);
  const canonical = ORIGIN + "/trail/" + slug;
  const photo = (post.photos || [])[0];
  const ogImage = photo ? ORIGIN + sizedPhoto(photo, 1400) : ORIGIN + "/eye.jpg";

  html = html.replace(/<title>[^<]*<\/title>/, "<title>" + esc(title) + "</title>");
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    '<meta name="description" content="' + esc(desc) + '">'
  );
  html = html.replace(
    "</head>",
    '  <link rel="canonical" href="' + esc(canonical) + '" />\n' +
    '  <meta property="og:type" content="article" />\n' +
    '  <meta property="og:url" content="' + esc(canonical) + '" />\n' +
    '  <meta property="og:title" content="' + esc(post.title) + '" />\n' +
    '  <meta property="og:description" content="' + esc(desc) + '" />\n' +
    '  <meta property="og:image" content="' + esc(ogImage) + '" />\n' +
    '  <meta name="twitter:card" content="summary_large_image" />\n' +
    '  <meta name="twitter:title" content="' + esc(post.title) + '" />\n' +
    '  <meta name="twitter:image" content="' + esc(ogImage) + '" />\n' +
    "</head>"
  );
  html = html.replace(
    /<main id="main">[\s\S]*?<\/main>/,
    '<main id="main" data-prerendered="1">' + articleHtml(post, postPath) + "</main>"
  );

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Same policy as static HTML in _headers: always revalidate.
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}

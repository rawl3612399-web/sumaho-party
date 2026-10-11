/* Bundles src/index.html with its local stylesheet and scripts into one self-contained page.
 * Usage: node tools/build.js   ->  writes oekaki-20byou.html (the published artifact) */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "oekaki-20byou.html");

function readLocal(file) {
  const full = path.join(SRC, file);
  if (!full.startsWith(SRC + path.sep)) throw new Error(`refusing to read outside src: ${file}`);
  if (!fs.existsSync(full)) throw new Error(`missing file referenced by index.html: ${file}`);
  return fs.readFileSync(full, "utf8");
}

/* Keeps "</script" inside inlined code from closing the tag early. */
const safeScript = (code) => code.replace(/<\/script/gi, "<\\/script");

/* <!-- include partials/x.html --> pulls a game's markup in from its own file (one level, no nesting). */
const INCLUDE = /<!--\s*include\s+([\w./-]+\.html)\s*-->/g;

function buildHtml() {
  let html = readLocal("index.html").replace(INCLUDE, (_, file) => readLocal(file).trim());
  if (/<!--\s*include\s/.test(html)) throw new Error("nested includes are not supported");
  html = html.replace(/<link rel="stylesheet" href="([^":]+\.css)">/g, (_, file) => `<style>\n${readLocal(file)}</style>`);
  html = html.replace(/<script src="([^":]+\.js)"[^>]*><\/script>/g, (_, file) => `<script>\n/* ${file} */\n${safeScript(readLocal(file))}</script>`);
  if (/<script src="(?!https:)/.test(html) || /<link rel="stylesheet" href="(?!https:)/.test(html)) {
    throw new Error("a local file was not inlined");
  }
  return { html };
}

function build() {
  const { html } = buildHtml();
  fs.writeFileSync(OUT, html);
  return { bytes: Buffer.byteLength(html), lines: html.split("\n").length };
}

/* Web version for GitHub Pages: same page plus install metadata (home-screen icon, theme color, manifest). */
const SITE_HEAD = `<meta name="theme-color" content="#f6f8fb" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1d2925" media="(prefers-color-scheme: dark)">
<meta name="description" content="スマホ1台で遊べるパーティーゲームと定番ゲーム集">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="スマホ1台パーティー">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="manifest" href="manifest.webmanifest">`;

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="112" fill="#2160d4"/>
<rect x="148" y="84" width="216" height="344" rx="40" fill="#ffffff"/>
<rect x="172" y="120" width="168" height="250" rx="16" fill="#ffe25e"/>
<circle cx="256" cy="398" r="14" fill="#2160d4"/>
<circle cx="214" cy="200" r="22" fill="#dc3e33"/><circle cx="298" cy="200" r="22" fill="#16a05a"/>
<path d="M206 268q50 48 100 0" stroke="#1c2838" stroke-width="18" stroke-linecap="round" fill="none"/>
</svg>
`;

const MANIFEST = {
  name: "スマホ1台パーティー",
  short_name: "パーティー",
  start_url: "./",
  display: "standalone",
  background_color: "#f6f8fb",
  theme_color: "#2160d4",
  lang: "ja",
  icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
};

function buildSite(dir) {
  const { html } = buildHtml();
  const out = path.resolve(ROOT, dir);
  fs.mkdirSync(out, { recursive: true });
  const page = html.replace(/(<meta name="viewport"[^>]*>)/, `$1\n${SITE_HEAD}`);
  if (page === html) throw new Error("viewport meta not found; cannot add site metadata");
  fs.writeFileSync(path.join(out, "index.html"), page);
  fs.writeFileSync(path.join(out, "icon.svg"), ICON_SVG);
  fs.writeFileSync(path.join(out, "manifest.webmanifest"), JSON.stringify(MANIFEST, null, 2));
  return out;
}

if (require.main === module) {
  const siteFlag = process.argv.indexOf("--site");
  if (siteFlag !== -1) {
    const out = buildSite(process.argv[siteFlag + 1] || "_site");
    console.log(`built site in ${path.relative(ROOT, out)}`);
  } else {
    const { bytes, lines } = build();
    console.log(`built ${path.relative(ROOT, OUT)}: ${(bytes / 1024).toFixed(1)} KB, ${lines} lines`);
  }
}
module.exports = { build, buildSite };

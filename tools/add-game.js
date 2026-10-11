/* Wires finished games into the app: markup include, styles, scripts, icon and game-list entry.
 * Usage: node tools/add-game.js games.json
 * games.json: [{ id, title, module, modeId, players, desc, color, group, iconSvg, cssFile, overlayPartial, usesCards }]
 * Safe to run again: anything already wired is left alone. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");
const write = (f, s) => fs.writeFileSync(path.join(SRC, f), s);
const exists = (f) => fs.existsSync(path.join(SRC, f));

const COLORS = ["--c-blue", "--c-amber", "--c-purple", "--c-red", "--c-orange", "--c-pink", "--c-teal", "--c-green", "--c-indigo",
  "--c-slate", "--c-lime", "--c-cyan", "--c-rose", "--c-brown", "--c-sky", "--c-violet", "--c-gold", "--c-mint"];
const GROUPS = ["party", "classic", "brain", "reflex", "puzzle"];

function validate(g) {
  const problems = [];
  if (!/^[a-z][a-z0-9]*$/.test(g.id || "")) problems.push("id must be lowercase letters/digits");
  if (!/^[A-Z][A-Za-z0-9]*$/.test(g.module || "")) problems.push("module must be a PascalCase global name");
  if (!g.title || !g.players || !g.desc) problems.push("title, players and desc are required");
  if (!COLORS.includes(g.color)) problems.push(`unknown color ${g.color}`);
  if (!GROUPS.includes(g.group)) problems.push(`group must be one of ${GROUPS.join(", ")}`);
  if (!exists(`${g.id}.js`)) problems.push(`missing src/${g.id}.js`);
  if (!exists(`partials/${g.id}.html`)) problems.push(`missing src/partials/${g.id}.html`);
  else if (!read(`partials/${g.id}.html`).includes(`id="${g.modeId}"`)) problems.push(`partial has no element with id="${g.modeId}"`);
  if (g.overlayPartial && !exists(`partials/${g.id}-overlay.html`)) problems.push(`missing src/partials/${g.id}-overlay.html`);
  if (g.cssFile && !exists(g.cssFile)) problems.push(`missing src/${g.cssFile}`);
  if (!g.iconSvg || /<svg|<script|on\w+=/i.test(g.iconSvg)) problems.push("iconSvg must be inner SVG markup only");
  if (problems.length) throw new Error(`${g.id}: ${problems.join("; ")}`);
}

/* Inserts `line` right before `marker` unless `needle` is already present. */
function insertBefore(text, marker, line, needle = line.trim()) {
  if (text.includes(needle)) return text;
  if (!text.includes(marker)) throw new Error(`marker not found: ${marker}`);
  return text.replace(marker, `${line}\n${marker}`);
}

function wireHtml(html, g) {
  let out = insertBefore(html, "  <!-- games:partials -->", `  <!-- include partials/${g.id}.html -->`);
  if (g.overlayPartial) out = insertBefore(out, "<!-- games:overlays -->", `<!-- include partials/${g.id}-overlay.html -->`);
  if (g.usesCards) out = insertBefore(out, "<!-- games:styles -->", `<link rel="stylesheet" href="styles-cards.css">`);
  if (g.cssFile) out = insertBefore(out, "<!-- games:styles -->", `<link rel="stylesheet" href="${g.cssFile}">`);
  if (g.usesCards) out = insertBefore(out, "<!-- games:scripts -->", `<script src="cards.js" charset="utf-8"></script>`);
  if (exists(`${g.id}-rules.js`)) out = insertBefore(out, "<!-- games:scripts -->", `<script src="${g.id}-rules.js" charset="utf-8"></script>`);
  return insertBefore(out, "<!-- games:scripts -->", `<script src="${g.id}.js" charset="utf-8"></script>`);
}

function wireMenu(main, g) {
  const entry = `    { id: ${JSON.stringify(g.id)}, title: ${JSON.stringify(g.title)}, players: ${JSON.stringify(g.players)}, desc: ${JSON.stringify(g.desc)}, color: ${JSON.stringify(g.color)}, el: ${JSON.stringify(g.modeId)}, game: ${g.module}, group: ${JSON.stringify(g.group)} },`;
  return insertBefore(main, "    /* games:entries */", entry, `id: ${JSON.stringify(g.id)}`);
}

function wireIcon(icons, g) {
  const body = g.iconSvg.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\s*\n\s*/g, " ");
  return insertBefore(icons, "    /* games:icons */", `    ${g.id}: svg('${body}'),`, `    ${g.id}: svg(`);
}

function addGames(list) {
  list.forEach(validate);
  let html = read("index.html");
  let main = read("main.js");
  let icons = read("icons.js");
  list.forEach(g => {
    html = wireHtml(html, g);
    main = wireMenu(main, g);
    icons = wireIcon(icons, g);
  });
  write("index.html", html);
  write("main.js", main);
  write("icons.js", icons);
  return list.map(g => g.id);
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node tools/add-game.js games.json");
    process.exit(1);
  }
  const ids = addGames(JSON.parse(fs.readFileSync(file, "utf8")));
  console.log(`wired: ${ids.join(", ")}`);
}
module.exports = { addGames, insertBefore, wireMenu, wireIcon, validate };

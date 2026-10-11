const test = require("node:test");
const assert = require("node:assert/strict");
const { insertBefore, wireMenu, wireIcon } = require("../tools/add-game.js");

test("add-game: inserts before the marker once", () => {
  const text = "a\n<!-- m -->\nb";
  const once = insertBefore(text, "<!-- m -->", "x");
  assert.equal(once, "a\nx\n<!-- m -->\nb");
  assert.equal(insertBefore(once, "<!-- m -->", "x"), once, "second run changes nothing");
  assert.throws(() => insertBefore("no marker", "<!-- m -->", "x"));
});

test("add-game: menu entry is valid JS with quotes escaped", () => {
  const main = "const GAMES = [\n    /* games:entries */\n  ];";
  const g = { id: "demo", title: "デモ\"", players: "2人", desc: "説明", color: "--c-blue", modeId: "modeDemo", module: "Demo", group: "classic" };
  const out = wireMenu(main, g);
  const Demo = {};
  const GAMES = new Function("Demo", `${out}; return GAMES;`)(Demo);
  assert.equal(GAMES.length, 1);
  assert.equal(GAMES[0].title, "デモ\"");
  assert.equal(GAMES[0].game, Demo);
  assert.equal(wireMenu(out, g), out);
});

test("add-game: icon markup with quotes stays a valid string", () => {
  const icons = "const svg = (b) => b;\nconst I = {\n    /* games:icons */\n};";
  const out = wireIcon(icons, { id: "demo", iconSvg: "<path d='M1 1'/>\n<circle r=\"2\"/>" });
  const I = new Function(`${out}; return I;`)();
  assert.equal(I.demo, "<path d='M1 1'/> <circle r=\"2\"/>");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../src/denki-rules.js");
const H = require("../src/hitblow-rules.js");
const Q = require("../src/hayaoshi-rules.js");

/* ---------- electric chair ---------- */
test("denki: every chair count has a config; few chairs lose on 2 shocks", () => {
  for (let n = D.RULES.minChairs; n <= D.RULES.maxChairs; n++) {
    const c = D.configFor(n);
    assert.ok(c.target > 0 && c.target < (n * (n + 1)) / 2, `target for ${n}`);
    assert.equal(c.maxShocks, n <= 7 ? 2 : 3);
  }
});

test("denki: chair count must be 5-12", () => {
  assert.throws(() => D.newGame(["A", "B"], 0, 4));
  assert.throws(() => D.newGame(["A", "B"], 0, 13));
  assert.equal(D.newGame(["A", "B"], 0).chairs, 12);
});

test("denki: safe sit scores and removes the chair; shock resets and keeps it", () => {
  let g = D.newGame(["A", "B"], 0, 12);
  assert.equal(D.defender(g), 1);
  g = D.sit(D.setTrap(g, 5), 12);
  assert.deepEqual(g.scores, [0, 12]);
  assert.equal(g.remaining.includes(12), false);
  g = D.nextTurn(g);
  g = D.sit(D.setTrap(g, 3), 3);
  assert.deepEqual(g.shocks, [1, 0]);
  assert.equal(g.remaining.includes(3), true);
  assert.deepEqual(g.history.map(h => h.trap), [5, 3]);
});

test("denki: losing all points on a shock", () => {
  let g = { ...D.newGame(["A", "B"], 0, 12), scores: [0, 20] };
  g = D.sit(D.setTrap(g, 7), 7);
  assert.deepEqual(g.scores, [0, 0]);
  assert.equal(g.last.lost, 20);
});

test("denki: bonus chair doubles points", () => {
  let g = D.newGame(["A", "B"], 0, 6, { bonus: 4 });
  g = D.sit(D.setTrap(g, 1), 4);
  assert.deepEqual(g.scores, [0, 8]);
  assert.equal(g.last.gained, 8);
  assert.throws(() => D.newGame(["A", "B"], 0, 6, { bonus: 7 }));
});

test("denki: wins by target, shocks, and last chair (including draw)", () => {
  let g = { ...D.newGame(["A", "B"], 0, 5), scores: [0, 4] };
  g = D.sit(D.setTrap(g, 1), 3);
  assert.deepEqual(g.outcome, { winner: 1, reason: "target" });

  let s = { ...D.newGame(["A", "B"], 0, 5), shocks: [0, 1] };
  s = D.sit(D.setTrap(s, 2), 2);
  assert.deepEqual(s.outcome, { winner: 0, reason: "shocks" });

  let l = { ...D.newGame(["A", "B"], 0, 12), remaining: [1, 2], scores: [10, 5] };
  l = D.sit(D.setTrap(l, 1), 2);
  assert.deepEqual(l.outcome, { winner: 0, reason: "lastChair" });

  let t = { ...D.newGame(["A", "B"], 0, 12), remaining: [3, 4], scores: [7, 4] };
  t = D.sit(D.setTrap(t, 4), 3);
  assert.deepEqual(t.outcome, { winner: null, reason: "lastChair" });
});

test("denki: moves do not change the previous game object", () => {
  const g = D.setTrap(D.newGame(["A", "B"], 0, 12), 5);
  const before = JSON.stringify(g);
  D.sit(g, 6);
  assert.equal(JSON.stringify(g), before);
});

test("denki: match of 3 needs 2 set wins; draws do not count", () => {
  let m = D.newMatch(3);
  m = D.recordGame(m, { winner: 0 });
  assert.equal(D.matchWinner(m), null);
  m = D.recordGame(m, { winner: null });
  assert.equal(D.matchWinner(m), null);
  m = D.recordGame(m, { winner: 0 });
  assert.equal(D.matchWinner(m), 0);
  assert.equal(m.played, 3);
  assert.throws(() => D.newMatch(2));
});

/* ---------- hit & blow ---------- */
test("hitblow: judge counts hits and blows", () => {
  assert.deepEqual(H.judge("123", "123"), { hit: 3, blow: 0 });
  assert.deepEqual(H.judge("123", "321"), { hit: 1, blow: 2 });
  assert.deepEqual(H.judge("123", "456"), { hit: 0, blow: 0 });
  assert.deepEqual(H.judge("1234", "4321"), { hit: 0, blow: 4 });
});

test("hitblow: codes need the right length and no repeats", () => {
  assert.equal(H.codeError("123", 3), null);
  assert.match(H.codeError("112", 3), /同じ数字/);
  assert.match(H.codeError("12", 3), /3けた/);
  assert.match(H.codeError("12a", 3), /数字だけ/);
  assert.throws(() => H.newGame(["A", "B"], 5, 0));
});

function readyGame(first = 0) {
  let g = H.newGame(["A", "B"], 3, first);
  g = H.setSecret(g, 0, "123");
  g = H.setSecret(g, 1, "456");
  return g;
}

test("hitblow: cannot guess before both secrets are set", () => {
  const g = H.setSecret(H.newGame(["A", "B"], 3, 0), 0, "123");
  assert.throws(() => H.guess(g, "456"));
});

test("hitblow: second player gets a last chance, and can force a draw", () => {
  let g = readyGame(0);
  g = H.guess(g, "456");
  assert.equal(g.outcome, null);
  assert.equal(H.lastChance(g), true);
  const lose = H.guess(g, "789");
  assert.deepEqual(lose.outcome, { winner: 0, guesses: 1 });
  const draw = H.guess(g, "123");
  assert.deepEqual(draw.outcome, { winner: null, guesses: 1 });
});

test("hitblow: second guesser wins outright when only they solve it", () => {
  let g = readyGame(1);
  g = H.guess(g, "789");
  assert.equal(H.guesser(g), 0);
  g = H.guess(g, "456");
  assert.deepEqual(g.outcome, { winner: 0, guesses: 1 });
  assert.throws(() => H.guess(g, "123"));
});

/* ---------- quick press ---------- */
test("hayaoshi: fast press scores for the presser, foul scores for the other", () => {
  let m = Q.newMatch(["A", "B"], 3, true);
  m = Q.award(m, 0, "fast", 250);
  m = Q.award(m, 0, "foul");
  assert.deepEqual(m.scores, [1, 1]);
  assert.equal(Q.bestTime(m, 0), 250);
  assert.equal(Q.bestTime(m, 1), null);
});

test("hayaoshi: first to the target wins and the match then locks", () => {
  let m = Q.newMatch(["A", "B"], 3, false);
  [1, 1, 1].forEach(() => { m = Q.award(m, 1, "fast", 300); });
  assert.equal(m.winner, 1);
  assert.throws(() => Q.award(m, 0, "fast", 200));
  assert.throws(() => Q.newMatch(["A", "B"], 4, false));
});

test("hayaoshi: round plan stays inside the wait window and fakes end before the signal", () => {
  for (const r of [0, 0.2, 0.5, 0.99]) {
    const p = Q.planRound(true, r, 0, r);
    assert.ok(p.signalAt >= Q.WAIT_MS.min && p.signalAt <= Q.WAIT_MS.max);
    if (p.fakeAt !== null) assert.ok(p.fakeAt >= 800 && p.fakeAt <= p.signalAt - 1000);
  }
  assert.equal(Q.planRound(false, 0.9, 0, 0.5).fakeAt, null);
});

/* Playing cards: deck helpers (pure, testable in Node) and a DOM card face drawn with SVG suit shapes. */
const Cards = (() => {
  const SUITS = Object.freeze([
    { id: "S", name: "スペード", red: false },
    { id: "H", name: "ハート", red: true },
    { id: "D", name: "ダイヤ", red: true },
    { id: "C", name: "クラブ", red: false }
  ]);
  const RANKS = Object.freeze(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);

  /* 24x24 suit shapes, filled with currentColor. */
  const SUIT_PATHS = Object.freeze({
    S: "M12 2C9 6.5 3.5 9.5 3.5 14a4.3 4.3 0 0 0 7.2 3.2L9.5 22h5l-1.2-4.8A4.3 4.3 0 0 0 20.5 14C20.5 9.5 15 6.5 12 2z",
    H: "M12 21.5C6.5 17 2.5 13.3 2.5 8.8A5 5 0 0 1 12 6.2a5 5 0 0 1 9.5 2.6c0 4.5-4 8.2-9.5 12.7z",
    D: "M12 1.8 20 12l-8 10.2L4 12z",
    C: "M12 2.2a4.4 4.4 0 0 0-3.7 6.8A4.4 4.4 0 1 0 10.6 16L9.5 22h5l-1.1-6a4.4 4.4 0 1 0 2.3-7A4.4 4.4 0 0 0 12 2.2z"
  });

  /* ---------- pure helpers ---------- */
  function newDeck(decks = 1) {
    if (!Number.isInteger(decks) || decks < 1 || decks > 8) throw new Error("デッキの数が正しくありません");
    const one = SUITS.flatMap(s => RANKS.map(rank => ({ suit: s.id, rank })));
    return Array.from({ length: decks }, (_, d) => one.map(c => ({ ...c, id: `${c.suit}${c.rank}-${d}` }))).flat();
  }
  const suitOf = (card) => SUITS.find(s => s.id === card.suit);
  const isRed = (card) => Boolean(suitOf(card)?.red);
  const rankIndex = (card) => RANKS.indexOf(card.rank);
  const label = (card) => `${suitOf(card).name}の${card.rank}`;

  /* ---------- DOM ---------- */
  function suitSvg(suit, cls = "") {
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${SUIT_PATHS[suit]}" fill="currentColor"/></svg>`;
  }
  /* Builds a card element. options: { faceDown, size: "sm" | "md" | "lg" }. */
  function el(card, options = {}) {
    const node = document.createElement("div");
    const size = ["sm", "md", "lg"].includes(options.size) ? options.size : "md";
    node.className = `pcard pcard-${size}` + (options.faceDown ? " down" : "") + (card && isRed(card) ? " red" : "");
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", options.faceDown || !card ? "伏せたカード" : label(card));
    const face = card
      ? `<span class="pc-corner tl"><b>${card.rank}</b>${suitSvg(card.suit)}</span>
         <span class="pc-center">${["J", "Q", "K"].includes(card.rank) ? `<b class="pc-court">${card.rank}</b>` : ""}${suitSvg(card.suit, "pc-pip")}</span>
         <span class="pc-corner br"><b>${card.rank}</b>${suitSvg(card.suit)}</span>`
      : "";
    node.innerHTML = `<span class="pc-inner"><span class="pc-front">${face}</span><span class="pc-back"></span></span>`;
    return node;
  }
  /* Turns a card element face up or face down with the flip animation. */
  function setFaceDown(node, faceDown) {
    node.classList.toggle("down", Boolean(faceDown));
  }

  return { SUITS, RANKS, newDeck, suitOf, isRed, rankIndex, label, suitSvg, el, setFaceDown };
})();

if (typeof module !== "undefined") module.exports = Cards;

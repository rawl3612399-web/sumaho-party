/* Line icons for the game list (24x24, drawn with currentColor). */
const Icons = (() => {
  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  return {
    oekaki: svg('<path d="M4 20l1.2-4.6L15.5 5.1a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8 4 20z"/><path d="M13.5 7l3.5 3.5"/>'),
    denki: svg('<path d="M7 3v9h10V3"/><path d="M5 12h14"/><path d="M7 12v9M17 12v9"/><path d="M12.5 4.5L10.5 8h3l-2 3.5" stroke-width="1.6"/>'),
    hitblow: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7.5 10v4M11 10h2.2v2H11v2h2.2M16 10h2v4h-2M16 12h2"/>'),
    hayaoshi: svg('<ellipse cx="12" cy="16" rx="8" ry="3"/><path d="M4 16v-2.5c0-1.7 3.6-3 8-3s8 1.3 8 3V16"/><path d="M12 7V3M8.5 8 7 5M15.5 8 17 5"/>'),
    wordwolf: svg('<path d="M5 4l3 4h8l3-4v9a7 7 0 0 1-14 0V4z"/><path d="M9.5 12.5h.01M14.5 12.5h.01"/><path d="M10.5 16l1.5 1 1.5-1"/>'),
    bomb: svg('<circle cx="10.5" cy="14" r="6.5"/><path d="M15 9.5l2-2"/><path d="M17 7.5c.5-1.5 1.7-2.4 3-2.5"/><path d="M20.5 2.5v1M22 4h-1M21.6 2.9l-.7.7"/>'),
    atekko: svg('<circle cx="12" cy="15" r="5.5"/><rect x="6.5" y="2.5" width="11" height="6" rx="1.2"/><path d="M10 15h.01M14 15h.01M10.5 17.5h3"/>'),
    kachikan: svg('<path d="M4 20h16"/><rect x="5" y="13" width="3" height="5" rx=".8"/><rect x="10.5" y="9" width="3" height="9" rx=".8"/><rect x="16" y="4" width="3" height="14" rx=".8"/>'),
    stop: svg('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 2.5h4M12 2.5V6M18.5 6.5l1.5-1.5"/>'),
    numbomb: svg('<circle cx="12" cy="13" r="7.5"/><path d="M9.5 10.5c0-1.4 1.1-2.3 2.5-2.3s2.5.9 2.5 2.2c0 1.8-2.5 2-2.5 3.6M12 17h.01"/><path d="M16.5 6.5L18 5"/>'),
    sound: {
      all: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
      sfx: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>'),
      off: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>')
    },
    back: svg('<path d="M14.5 5.5L8 12l6.5 6.5"/>')
  };
})();

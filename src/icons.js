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
    back: svg('<path d="M14.5 5.5L8 12l6.5 6.5"/>'),
    finger: svg('<circle cx="6" cy="6.5" r="2.4"/><circle cx="17.5" cy="6" r="2.4"/><circle cx="6.5" cy="17.5" r="2.4"/><circle cx="16" cy="16" r="1.8"/><circle cx="16" cy="16" r="5"/>'),
    rhythm: svg('<path d="M5.5 20.5h13L15 3.5H9z"/><path d="M8 16.5h8"/><path d="M12 16.5l4.2-9.5"/><circle cx="14.4" cy="10.8" r="1.4"/>'),
    tobira: svg('<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M4 21h16"/><path d="M10.2 9.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.6"/><path d="M12 15.6h.01"/>'),
    katakana: svg('<path d="M4.5 3h9A2.5 2.5 0 0 1 16 5.5V10a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3h-1A2.5 2.5 0 0 1 2 10V5.5A2.5 2.5 0 0 1 4.5 3z"/><path d="M6 6.6h5.4c0 2.2-.4 3.4-1.3 4.2M8.6 5c-.1 2.6-.8 4.4-2.3 5.6"/><circle cx="18.5" cy="18.5" r="3.5"/><path d="M16 16l5 5"/>'),
    henteko: svg('<path d="M5.5 19.5C4 15 5.2 9 12 9s8 6 6.5 10.5z"/><path d="M9 9.6 7.5 5.6M15 9.6l1.5-4"/><circle cx="7.2" cy="4.6" r="1"/><circle cx="16.8" cy="4.6" r="1"/><path d="M9.8 13.4h.01M14.2 13.4h.01" stroke-width="2.6"/><path d="M10 16.2c1.2 1 2.8 1 4 0"/><path d="M8.6 19.5v1.6M15.4 19.5v1.6"/>'),
    eshiritori: svg('<rect x="2.5" y="3.5" width="8.5" height="8.5" rx="1.8"/><rect x="13" y="12" width="8.5" height="8.5" rx="1.8"/><path d="M11 7.75h6.25V12"/><path d="M15.25 10l2 2 2-2"/><circle cx="6.75" cy="8.6" r="1.9"/><path d="M6.75 6.7V5.8"/><path d="M15.1 16.6l2.15-1.9 2.15 1.9M15.8 16v2.5h2.9V16"/>'),
    connect4: svg('<rect x="3" y="9" width="18" height="12" rx="2.5"/><circle cx="7.5" cy="13.1" r="1.2" stroke-width="1.3"/><circle cx="12" cy="13.1" r="1.85" fill="currentColor" stroke="none"/><circle cx="16.5" cy="13.1" r="1.2" stroke-width="1.3"/><circle cx="7.5" cy="17.3" r="1.85" fill="currentColor" stroke="none"/><circle cx="12" cy="17.3" r="1.85" fill="currentColor" stroke="none"/><circle cx="16.5" cy="17.3" r="1.85" fill="currentColor" stroke="none"/><path d="M16.5 2.5v3.6M14.6 4.4l1.9 1.9 1.9-1.9"/>'),
    reversi: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.7" cy="8.7" r="2.2"/><circle cx="15.3" cy="15.3" r="2.2"/><circle cx="15.3" cy="8.7" r="2.2" fill="currentColor"/><circle cx="8.7" cy="15.3" r="2.2" fill="currentColor"/>'),
    gomoku: svg('<path d="M3 6h18M3 12h18M3 18h18M6 3v18M12 3v18M18 3v18" stroke-width="1.3"/><circle cx="6" cy="18" r="2.6" fill="currentColor"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><circle cx="18" cy="6" r="2.6" fill="currentColor"/>'),
    mancala: svg('<rect x="1.5" y="4.5" width="21" height="15" rx="7"/><ellipse cx="5.7" cy="12" rx="1.5" ry="4.2" stroke-width="1.5"/><ellipse cx="18.3" cy="12" rx="1.5" ry="4.2" stroke-width="1.5"/><circle cx="9.9" cy="9.4" r="1.4" stroke-width="1.4"/><circle cx="14.1" cy="9.4" r="1.4" stroke-width="1.4"/><circle cx="9.9" cy="14.6" r="1.4" stroke-width="1.4"/><circle cx="14.1" cy="14.6" r="1.4" stroke-width="1.4"/>'),
    /* games:icons */
  };
})();

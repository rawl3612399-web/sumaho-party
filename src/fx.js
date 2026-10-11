/* Visual effects: confetti, 3-2-1 countdown, full-screen flash, shake, pop-in. All respect reduced motion. */
const Fx = (() => {
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /* Restarts a CSS animation class on an element. */
  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  const pop = (el) => replay(el, "fx-pop");
  const shake = (el = document.querySelector(".app")) => { if (!reduced()) replay(el, "fx-shake"); };

  function flash(colorToken = "--alert", ms = 450) {
    if (reduced()) return;
    const layer = document.createElement("div");
    layer.className = "fx-flash";
    layer.style.background = token(colorToken) || "#fff";
    layer.style.animationDuration = `${ms}ms`;
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), ms + 50);
  }

  function confetti(ms = 2600) {
    if (reduced()) return;
    const canvas = document.createElement("canvas");
    canvas.className = "fx-confetti";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    document.body.appendChild(canvas);
    const g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    const colors = ["--accent", "--alert", "--zap", "--go", "--c-purple", "--c-pink"].map(token).filter(Boolean);
    const parts = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
      y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 13,
      vy: -Math.random() * 13 - 4,
      size: 6 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      color: colors[Math.floor(Math.random() * colors.length)]
    }));
    const start = performance.now();
    let frame = 0;
    const draw = (now) => {
      const age = now - start;
      g.clearRect(0, 0, innerWidth, innerHeight);
      g.globalAlpha = Math.max(0, 1 - Math.max(0, age - ms * 0.6) / (ms * 0.4));
      parts.forEach(p => {
        p.vy += 0.32;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        g.restore();
      });
      if (age < ms) frame = requestAnimationFrame(draw);
      else canvas.remove();
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); canvas.remove(); };
  }

  /* Big 3-2-1-GO over the whole screen. Resolves when it finishes. */
  function countdown(goText = "スタート！", from = 3) {
    return new Promise(resolve => {
      const layer = document.createElement("div");
      layer.className = "fx-countdown";
      const label = document.createElement("span");
      layer.appendChild(label);
      document.body.appendChild(layer);
      const steps = [...Array.from({ length: from }, (_, i) => String(from - i)), goText];
      steps.forEach((text, i) => setTimeout(() => {
        if (!layer.isConnected) return;
        label.textContent = text;
        label.classList.toggle("go", i === steps.length - 1);
        replay(label, "fx-count");
        Sound.sfx(i === steps.length - 1 ? "go" : "count");
      }, i * 700));
      setTimeout(() => { layer.remove(); resolve(); }, steps.length * 700 - 150);
    });
  }

  /* Removes any countdown or confetti still on screen (used when the player leaves a game). */
  function clear() {
    document.querySelectorAll(".fx-countdown, .fx-confetti, .fx-flash").forEach(n => n.remove());
  }

  return { pop, shake, flash, confetti, countdown, replay, clear };
})();

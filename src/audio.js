/* Sound engine: one AudioContext, a master chain (compressor + room reverb), separate buses for music and effects,
 * and a library of synthesized sound effects. Everything is generated live; no audio files. */
const Sound = (() => {
  const MODE_KEY = "audio.mode";
  const MODES = ["all", "sfx", "off"];
  const MUSIC_LEVEL = 0.55;

  let ctx = null;
  let out = null;
  let sfxBus = null;
  let musicBus = null;
  let verb = null;
  let noise = null;
  /* Local test servers (localhost / 127.0.0.1) start silent so automated testing makes no noise; add ?sound to the URL to hear it. */
  const TEST_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !/[?&]sound\b/.test(location.search);
  const savedMode = Store.load(MODE_KEY, "all");
  let mode = TEST_HOST ? "off" : (MODES.includes(savedMode) ? savedMode : "all");

  /* ---------- graph ---------- */
  function impulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function buildGraph() {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    out = ctx.createGain();
    out.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.connect(out);
    musicBus = ctx.createGain();
    musicBus.connect(out);
    verb = ctx.createConvolver();
    verb.buffer = impulse(2.2, 2.8);
    const verbLevel = ctx.createGain();
    verbLevel.gain.value = 0.32;
    verb.connect(verbLevel).connect(out);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    applyMode();
  }
  function applyMode() {
    if (!ctx) return;
    const t = ctx.currentTime;
    out.gain.setTargetAtTime(mode === "off" ? 0 : 0.9, t, 0.02);
    musicBus.gain.setTargetAtTime(mode === "all" ? MUSIC_LEVEL : 0, t, 0.05);
  }
  function ensure() {
    try {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        buildGraph();
      }
      if (ctx.state === "suspended") ctx.resume();
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }
  function setMode(next) {
    if (!MODES.includes(next)) return;
    mode = next;
    Store.save(MODE_KEY, mode);
    applyMode();
  }

  /* ---------- primitives ---------- */
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  /* One oscillator voice with an envelope. Optional filter, pitch glide, vibrato and reverb send. */
  function tone(o) {
    if (!ctx) return;
    const t = o.t ?? ctx.currentTime;
    const dur = o.dur ?? 0.2;
    const attack = o.attack ?? 0.005;
    const vol = o.vol ?? 0.2;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(o.glide, t + (o.glideTime ?? dur));
    if (o.detune) osc.detune.value = o.detune;
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = o.vibrato.rate;
      depth.gain.value = o.vibrato.depth;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t + (o.vibrato.delay ?? 0));
      lfo.stop(t + dur + 0.1);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    if (o.hold) g.gain.setValueAtTime(vol, t + attack + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let head = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type || "lowpass";
      f.frequency.setValueAtTime(o.filter.freq, t);
      if (o.filter.to) f.frequency.exponentialRampToValueAtTime(o.filter.to, t + dur);
      f.Q.value = o.filter.q ?? 0.8;
      head.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(o.dest || sfxBus);
    if (o.send) {
      const s = ctx.createGain();
      s.gain.value = o.send;
      g.connect(s).connect(verb);
    }
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /* Filtered noise burst, optionally sweeping its filter. */
  function hiss(o) {
    if (!ctx) return;
    const t = o.t ?? ctx.currentTime;
    const dur = o.dur ?? 0.1;
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = noise;
    f.type = o.type || "highpass";
    f.frequency.setValueAtTime(o.freq ?? 1000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    f.Q.value = o.q ?? 0.7;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.2, t + (o.attack ?? 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(o.dest || sfxBus);
    if (o.send) {
      const s = ctx.createGain();
      s.gain.value = o.send;
      g.connect(s).connect(verb);
    }
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /* Cuts every effect already scheduled (drum rolls, fanfares, beats) — used when the player leaves a game. */
  function silence() {
    if (!ctx || !sfxBus) return;
    const old = sfxBus;
    old.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
    setTimeout(() => old.disconnect(), 250);
    sfxBus = ctx.createGain();
    sfxBus.connect(out);
  }

  function vibrate(pattern) {
    try { if (mode !== "off" && navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* not supported */ }
  }

  /* ---------- sound effects ---------- */
  const now = () => ctx.currentTime;
  const brass = (midi, t, dur, vol = 0.09) => {
    [-7, 7].forEach(d => tone({ freq: hz(midi), type: "sawtooth", t, dur, vol, attack: 0.025, detune: d, filter: { freq: 2600, to: 1400 }, send: 0.18 }));
  };
  const bell = (midi, t, dur, vol = 0.18) => {
    tone({ freq: hz(midi), t, dur, vol, send: 0.3 });
    tone({ freq: hz(midi) * 2.01, t, dur: dur * 0.5, vol: vol * 0.35, send: 0.3 });
    tone({ freq: hz(midi) * 3.98, t, dur: dur * 0.25, vol: vol * 0.12 });
  };
  const cymbal = (t, dur = 1.4, vol = 0.12) => hiss({ t, dur, vol, freq: 6000, send: 0.3 });

  const SFX = {
    tap: () => tone({ freq: 1250, glide: 900, type: "triangle", dur: 0.05, vol: 0.07 }),
    select: () => { const t = now(); tone({ freq: hz(81), type: "triangle", t, dur: 0.07, vol: 0.1 }); tone({ freq: hz(88), type: "triangle", t: t + 0.05, dur: 0.1, vol: 0.1 }); },
    confirm: () => { const t = now(); bell(84, t, 0.18, 0.12); bell(91, t + 0.07, 0.3, 0.12); },
    back: () => { const t = now(); tone({ freq: hz(79), type: "triangle", t, dur: 0.07, vol: 0.09 }); tone({ freq: hz(72), type: "triangle", t: t + 0.05, dur: 0.12, vol: 0.09 }); },
    correct: () => { const t = now(); bell(88, t, 0.25, 0.22); bell(84, t + 0.16, 0.9, 0.22); },
    wrong: () => { const t = now(); [0, 0.28].forEach(d => tone({ freq: 140, type: "square", t: t + d, dur: 0.24, vol: 0.12, hold: 0.18, filter: { freq: 900 } })); },
    pop: () => tone({ freq: 380, glide: 980, glideTime: 0.07, type: "sine", dur: 0.12, vol: 0.22 }),
    coin: () => { const t = now(); tone({ freq: hz(83), type: "square", t, dur: 0.07, vol: 0.07 }); tone({ freq: hz(88), type: "square", t: t + 0.07, dur: 0.35, vol: 0.07, send: 0.15 }); },
    flip: () => { const t = now(); hiss({ t, dur: 0.09, vol: 0.12, type: "bandpass", freq: 1800, to: 4200 }); tone({ freq: 660, glide: 990, type: "triangle", t: t + 0.03, dur: 0.08, vol: 0.06 }); },
    whoosh: () => hiss({ dur: 0.32, vol: 0.2, type: "bandpass", freq: 350, to: 3800, q: 1.2, attack: 0.08 }),
    count: () => tone({ freq: hz(81), type: "square", dur: 0.14, vol: 0.08, filter: { freq: 3000 } }),
    go: () => { const t = now(); tone({ freq: hz(93), type: "square", t, dur: 0.45, vol: 0.09, hold: 0.25, filter: { freq: 4000 }, send: 0.2 }); },
    tick: (alt = false) => { tone({ freq: alt ? 1450 : 1900, type: "sine", dur: 0.035, vol: 0.22 }); tone({ freq: alt ? 720 : 950, type: "triangle", dur: 0.03, vol: 0.08 }); },
    heartbeat: () => { const t = now(); [0, 0.2].forEach((d, i) => tone({ freq: 70, glide: 42, type: "sine", t: t + d, dur: 0.18, vol: i ? 0.35 : 0.5 })); },
    buzz: () => {
      const t = now();
      [220, 233].forEach(f => tone({ freq: f, type: "sawtooth", t, dur: 0.9, vol: 0.1, hold: 0.6, filter: { freq: 1600 } }));
      vibrate([200, 100, 300]);
    },
    fanfare: () => {
      const t = now();
      [[72, 0], [76, 0.1], [79, 0.2]].forEach(([m, d]) => brass(m, t + d, 0.14));
      [72, 76, 79, 84].forEach(m => brass(m, t + 0.32, 0.7, 0.06));
      cymbal(t + 0.32, 1.0, 0.08);
    },
    victory: () => {
      const t = now();
      const line = [[67, 0, 0.12], [67, 0.14, 0.12], [67, 0.28, 0.12], [72, 0.42, 0.5], [70, 0.98, 0.16], [72, 1.16, 0.16]];
      line.forEach(([m, d, len]) => brass(m, t + d, len + 0.06, 0.1));
      [60, 64, 67, 72, 76].forEach(m => brass(m, t + 1.36, 1.3, 0.05));
      tone({ freq: hz(36), type: "sine", t: t + 1.36, dur: 1.2, vol: 0.4 });
      cymbal(t + 1.36, 1.8, 0.14);
      vibrate([80, 60, 80, 60, 240]);
    },
    lose: () => {
      const t = now();
      [[62, 0, 0.32], [61, 0.36, 0.32], [60, 0.72, 0.32]].forEach(([m, d, len]) =>
        tone({ freq: hz(m), type: "sawtooth", t: t + d, dur: len, vol: 0.11, attack: 0.04, filter: { freq: 1100 }, send: 0.15 }));
      tone({ freq: hz(59), type: "sawtooth", t: t + 1.08, dur: 1.2, vol: 0.11, attack: 0.04, hold: 0.7, filter: { freq: 1100 }, vibrato: { rate: 6, depth: 9, delay: 0.25 }, send: 0.15 });
    },
    reveal: () => {
      const t = now();
      [60, 63, 67].forEach(m => brass(m, t, 0.16, 0.08));
      [60, 63, 67, 72].forEach(m => brass(m, t + 0.22, 1.0, 0.07));
      tone({ freq: hz(36), type: "sine", t: t + 0.22, dur: 0.8, vol: 0.45 });
      cymbal(t + 0.22, 1.4, 0.1);
    },
    boom: () => {
      const t = now();
      tone({ freq: 140, glide: 28, glideTime: 0.9, type: "sine", t, dur: 1.2, vol: 0.9 });
      tone({ freq: 70, glide: 25, glideTime: 1.2, type: "triangle", t, dur: 1.4, vol: 0.5 });
      hiss({ t, dur: 2.2, vol: 0.85, type: "lowpass", freq: 2400, to: 90, send: 0.4 });
      hiss({ t, dur: 0.25, vol: 0.5, type: "highpass", freq: 2500 });
      vibrate([600, 100, 300]);
    },
    zap: () => {
      const t = now();
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 95;
      lfo.type = "square";
      lfo.frequency.value = 42;
      lfoGain.gain.value = 70;
      lfo.connect(lfoGain).connect(osc.frequency);
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
      g.gain.setValueAtTime(0.32, t + 1.0);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      osc.connect(g).connect(sfxBus);
      [osc, lfo].forEach(o => { o.start(t); o.stop(t + 1.35); });
      for (let i = 0; i < 16; i++) hiss({ t: t + i * 0.075 + Math.random() * 0.04, dur: 0.05, vol: 0.28, freq: 3000 });
      vibrate([400, 80, 400, 80, 500]);
    },
    drumroll: (seconds = 1.8) => {
      const t0 = now();
      let t = 0;
      while (t < seconds) {
        const p = t / seconds;
        hiss({ t: t0 + t, dur: 0.07, vol: 0.06 + p * 0.2, type: "bandpass", freq: 1800, q: 0.6 });
        t += 0.065 - p * 0.03;
      }
      tone({ freq: 80, glide: 45, type: "sine", t: t0 + seconds, dur: 0.4, vol: 0.5 });
      cymbal(t0 + seconds, 1.2, 0.12);
    }
  };

  function sfx(name, ...args) {
    if (!ensure() || !SFX[name]) return;
    SFX[name](...args);
  }

  /* ---------- older call style kept for the drawing game ---------- */
  function beep(freq, dur, delay = 0, type = "sine", vol = 0.25) {
    if (!ctx) return;
    tone({ freq, type, t: ctx.currentTime + delay, dur, vol: Math.max(vol, 0.001) });
  }
  function hit(t, dur, cutoff, vol, dest) {
    hiss({ t, dur, freq: cutoff, vol, dest });
  }

  return {
    ensure, setMode, mode: () => mode, MODES,
    ctx: () => ctx, musicBus: () => musicBus, verb: () => verb, hz,
    tone, hiss, sfx, beep, hit, vibrate, silence,
    buzz: () => sfx("buzz"), fanfare: () => sfx("fanfare"), chime: () => sfx("correct"),
    drumroll: (s) => sfx("drumroll", s), zap: () => sfx("zap")
  };
})();

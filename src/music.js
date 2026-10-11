/* Background music: a 16th-note step sequencer and five generated tracks.
 * Each track picks a key and pattern variation when it starts, so it sounds a little different each time. */
const Music = (() => {
  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
  const hz = (m) => Sound.hz(m);

  let ctx = null;
  let bus = null;
  let current = null;
  let timerId = 0;
  let pos = { next: 0, step: 0, intense: false, vars: {} };

  /* ---------- instruments (all play into the track bus) ---------- */
  const I = {
    lead: (m, t, dur, vol = 0.05, type = "square") => Sound.tone({ freq: hz(m), type, t, dur, vol, dest: bus, filter: { freq: 3800 } }),
    pluck: (m, t, vol = 0.09, send = 0.25) => Sound.tone({ freq: hz(m), type: "triangle", t, dur: 0.35, vol, dest: bus, send }),
    marimba: (m, t, vol = 0.14) => {
      Sound.tone({ freq: hz(m), type: "sine", t, dur: 0.32, vol, dest: bus, send: 0.15 });
      Sound.tone({ freq: hz(m) * 3.9, type: "sine", t, dur: 0.05, vol: vol * 0.25, dest: bus });
    },
    keys: (notes, t, dur, vol = 0.05) => notes.forEach(m => {
      Sound.tone({ freq: hz(m), type: "sine", t, dur, vol, attack: 0.01, dest: bus, send: 0.22 });
      Sound.tone({ freq: hz(m) * 2, type: "sine", t, dur: dur * 0.4, vol: vol * 0.3, dest: bus });
    }),
    pad: (notes, t, dur, vol = 0.025, cutoff = 1100) => notes.forEach(m => [-8, 8].forEach(d =>
      Sound.tone({ freq: hz(m), type: "sawtooth", t, dur, vol, attack: dur * 0.3, detune: d, dest: bus, filter: { freq: cutoff }, send: 0.3 }))),
    bass: (m, t, dur, vol = 0.24) => {
      Sound.tone({ freq: hz(m), type: "triangle", t, dur, vol, dest: bus });
      Sound.tone({ freq: hz(m - 12), type: "sine", t, dur, vol: vol * 0.6, dest: bus });
    },
    kick: (t, vol = 0.6) => Sound.tone({ freq: 160, glide: 42, glideTime: 0.12, type: "sine", t, dur: 0.18, vol, dest: bus }),
    thump: (t, vol = 0.45) => Sound.tone({ freq: 72, glide: 40, glideTime: 0.14, type: "sine", t, dur: 0.2, vol, dest: bus }),
    snare: (t, vol = 0.16) => {
      Sound.hiss({ t, dur: 0.13, vol, type: "bandpass", freq: 1900, q: 0.5, dest: bus });
      Sound.tone({ freq: 210, glide: 160, type: "triangle", t, dur: 0.08, vol: vol * 0.7, dest: bus });
    },
    clap: (t, vol = 0.14) => [0, 0.012, 0.024].forEach(d => Sound.hiss({ t: t + d, dur: 0.09, vol, type: "bandpass", freq: 1400, q: 0.9, dest: bus })),
    hat: (t, vol = 0.04, open = false) => Sound.hiss({ t, dur: open ? 0.16 : 0.035, vol, freq: 7500, dest: bus }),
    shaker: (t, vol = 0.025) => Sound.hiss({ t, dur: 0.05, vol, type: "bandpass", freq: 6000, q: 1.5, dest: bus })
  };

  /* chord tones: quality "M" major, "m" minor, "M7", "m7" */
  const SHAPES = { M: [0, 4, 7], m: [0, 3, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };
  const chord = (root, q) => SHAPES[q].map(i => root + i);

  /* ---------- tracks ---------- */
  const TRACKS = {
    /* Upbeat chiptune for the 20-second drawing timer. */
    draw: {
      bpm: 140, boost: 30, gain: 1,
      init: () => ({
        prog: pickOne([
          [[60, "M"], [57, "m"], [53, "M"], [55, "M"]],
          [[57, "m"], [53, "M"], [60, "M"], [55, "M"]],
          [[60, "M"], [55, "M"], [57, "m"], [53, "M"]],
          [[62, "m"], [58, "M"], [60, "M"], [57, "M"]]
        ]),
        arp: pickOne([[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 3, 2, 4, 3, 2, 3], [3, 2, 1, 2, 3, 4, 5, 4]]),
        key: pickOne([0, 2, -2, 3, 5, -3])
      }),
      step: (t, s, v, intense, sixteenth) => {
        const half = s % 2 === 1;
        if (half) {
          if (intense) I.hat(t, 0.04);
          return;
        }
        const i = (s / 2) % 8;
        const [root, q] = v.prog[Math.floor(s / 16) % 4];
        const r = root + v.key + (intense ? 1 : 0);
        const tones = [...chord(r, q), ...chord(r + 12, q)];
        I.lead(tones[v.arp[i]] + 12, t, sixteenth * 1.7, 0.045);
        I.bass(r - 12 + (i % 2 ? 12 : 0), t, sixteenth * 1.8, 0.2);
        if (i % 4 === 0) I.kick(t);
        if (i % 4 === 2) I.snare(t);
        I.hat(t, 0.04);
        if (intense && i % 2 === 1) I.kick(t, 0.4);
      }
    },

    /* Suspense: heartbeat, low pad, sparse plucks. Used while people read each other. */
    tension: {
      bpm: 92, boost: 26, gain: 0.95,
      init: () => ({
        key: pickOne([0, -2, 2, -3]),
        prog: pickOne([[[57, "m"], [53, "M"], [50, "m"], [52, "M"]], [[57, "m"], [55, "M"], [53, "M"], [52, "M"]]]),
        motif: pickOne([[0, 6, 10, 12], [0, 3, 8, 14], [2, 6, 10, 13]])
      }),
      step: (t, s, v, intense, sixteenth) => {
        const bar = Math.floor(s / 16) % 4;
        const i = s % 16;
        const [root, q] = v.prog[bar];
        const r = root + v.key;
        if (i === 0) {
          I.pad(chord(r, q), t, sixteenth * 16, 0.02, intense ? 1500 : 900);
          I.bass(r - 12, t, sixteenth * 7, 0.18);
        }
        if (i === 0 || i === 8) I.thump(t, 0.5);
        if (i === 3 || i === 11) I.thump(t, 0.3);
        const motifIdx = v.motif.indexOf(i);
        if (motifIdx !== -1) I.pluck(chord(r + 12, q)[motifIdx % 3] + (motifIdx === 3 ? 12 : 0), t, 0.07);
        if (intense) {
          I.hat(t, i % 2 ? 0.02 : 0.035);
          if (i % 4 === 2) I.bass(r - 12, t, sixteenth, 0.12);
        }
      }
    },

    /* Thinking: mellow lo-fi with electric-piano chords and a lazy swing. */
    think: {
      bpm: 84, boost: 0, gain: 1,
      init: () => {
        const key = pickOne([0, 2, -3, 5]);
        const scale = [0, 2, 4, 7, 9];
        const melody = Array.from({ length: 64 }, (_, k) => (k % 4 === 2 && Math.random() < 0.35)
          ? 72 + scale[Math.floor(Math.random() * scale.length)] : null);
        return { key, melody, prog: [[65, "M7"], [64, "m7"], [62, "m7"], [60, "M7"]] };
      },
      step: (t, s, v, intense, sixteenth) => {
        const i = s % 16;
        const [root, q] = v.prog[Math.floor(s / 16) % 4];
        const r = root + v.key;
        const swing = (i % 4 === 2) ? sixteenth * 0.25 : 0;
        if (i === 0) I.keys(chord(r - 12, q), t, sixteenth * 9, 0.04);
        if (i === 10) I.keys(chord(r - 12, q).slice(1), t + swing, sixteenth * 6, 0.03);
        if (i === 0) I.bass(r - 24, t, sixteenth * 6, 0.2);
        if (i === 7) I.bass(r - 24 + 7, t, sixteenth * 3, 0.14);
        if (i === 0 || i === 10) I.kick(t + (i === 10 ? swing : 0), 0.45);
        if (i === 4 || i === 12) I.snare(t, 0.08);
        if (i % 2 === 0) I.hat(t + swing, 0.025);
        const note = v.melody[s % 64];
        if (note) I.pluck(note + v.key, t + swing, 0.05, 0.35);
      }
    },

    /* Game-show rush for the forehead quiz. */
    rush: {
      bpm: 150, boost: 20, gain: 0.9,
      init: () => ({
        key: pickOne([0, 2, 5, -2]),
        riff: pickOne([[0, 2, 4, 2, 5, 4, 2, 4], [4, 2, 0, 2, 4, 5, 4, 2], [0, 0, 4, 2, 5, 5, 4, 2]])
      }),
      step: (t, s, v, intense, sixteenth) => {
        if (s % 2 === 1) return;
        const i = (s / 2) % 8;
        const prog = [[60, "M"], [57, "m"], [53, "M"], [55, "M"]];
        const [root, q] = prog[Math.floor(s / 16) % 4];
        const r = root + v.key + (intense ? 1 : 0);
        const tones = [...chord(r + 12, q), ...chord(r + 24, q)];
        I.lead(tones[v.riff[i]], t, sixteenth * 1.6, 0.04, "square");
        I.bass(r - 12 + (i % 2 ? 12 : 0), t, sixteenth * 1.6, 0.2);
        I.kick(t, 0.5);
        if (i % 4 === 2) I.clap(t);
        I.hat(t + sixteenth, 0.05, true);
        if (intense) I.hat(t, 0.03);
      }
    },

    /* Light, bouncy loop for the game list. */
    menu: {
      bpm: 108, boost: 0, gain: 0.55,
      init: () => ({
        key: pickOne([0, 2, 5]),
        pattern: pickOne([[0, 2, 1, 2, 3, 2, 1, 2], [0, 1, 2, 3, 2, 1, 2, 4], [2, 1, 0, 1, 2, 3, 4, 3]])
      }),
      step: (t, s, v, intense, sixteenth) => {
        const prog = [[60, "M"], [55, "M"], [57, "m"], [53, "M"]];
        const [root, q] = prog[Math.floor(s / 16) % 4];
        const r = root + v.key;
        I.shaker(t, s % 2 ? 0.015 : 0.025);
        if (s % 2 === 1) return;
        const i = (s / 2) % 8;
        const tones = [...chord(r + 12, q), ...chord(r + 24, q)];
        I.marimba(tones[v.pattern[i]], t, 0.12);
        if (i === 0 || i === 4) I.bass(r - 12, t, sixteenth * 3, 0.14);
        if (i === 0) I.kick(t, 0.3);
      }
    }
  };

  /* ---------- sequencer ---------- */
  function pump() {
    const track = TRACKS[current];
    while (pos.next < ctx.currentTime + 0.15) {
      const bpm = track.bpm + (pos.intense ? track.boost : 0);
      const sixteenth = 60 / bpm / 4;
      track.step(pos.next, pos.step, pos.vars, pos.intense, sixteenth);
      pos = { ...pos, next: pos.next + sixteenth, step: pos.step + 1 };
    }
  }

  function play(name) {
    if (!TRACKS[name]) return;
    if (current === name && timerId) return;
    stop();
    ctx = Sound.ensure();
    if (!ctx || !Sound.musicBus()) return;
    bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.exponentialRampToValueAtTime(TRACKS[name].gain, ctx.currentTime + 0.4);
    bus.connect(Sound.musicBus());
    current = name;
    pos = { next: ctx.currentTime + 0.08, step: 0, intense: false, vars: TRACKS[name].init() };
    timerId = setInterval(pump, 25);
    pump();
  }

  function stop(fade = 0.12) {
    clearInterval(timerId);
    timerId = 0;
    current = null;
    if (!bus) return;
    const g = bus;
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, fade / 3);
    setTimeout(() => g.disconnect(), fade * 1000 + 400);
    bus = null;
  }

  function intensify() {
    if (!timerId || pos.intense) return;
    pos = { ...pos, intense: true };
  }

  return { play, stop, intensify, playing: () => current, start: () => play("draw"), TRACKS: Object.keys(TRACKS) };
})();

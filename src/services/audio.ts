/**
 * Original, synthesized card sounds in the spirit of classic desktop solitaire:
 * a light paper "tick" on pick-up, a crisp snap when a card lands, a quick
 * riffle when dealing, a cascade + chime when a run completes, and a fanfare
 * with firework pops on a win. No audio files are used.
 */
export type Sfx = 'pick' | 'drop' | 'flip' | 'deal' | 'deal-all' | 'complete' | 'win' | 'pop' | 'undo' | 'error';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function live(): { a: AudioContext; out: GainNode } | null {
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { a: ctx, out: master! };
}

function noise(a: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(a);
  if (!b) {
    b = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(a, b);
  }
  return b;
}

const rnd = (x: number, spread = 0.12) => x * (1 + (Math.random() * 2 - 1) * spread);

/** Filtered noise burst with a sharp attack and exponential decay. */
function burst(
  a: BaseAudioContext,
  out: AudioNode,
  t: number,
  o: { freq: number; q?: number; dur: number; gain: number; type?: BiquadFilterType; sweepTo?: number; hp?: number },
) {
  const src = a.createBufferSource();
  src.buffer = noise(a);
  const f = a.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq, t);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.dur);
  f.Q.value = o.q ?? 1.2;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  let node: AudioNode = src.connect(f);
  if (o.hp) {
    const h = a.createBiquadFilter();
    h.type = 'highpass';
    h.frequency.value = o.hp;
    node = node.connect(h);
  }
  node.connect(g).connect(out);
  src.start(t, Math.random() * 0.5, o.dur + 0.05);
}

/** Short pitched body that gives a "knock" to the snap. */
function knock(a: BaseAudioContext, out: AudioNode, t: number, freq: number, dur: number, gain: number) {
  const o = a.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.4);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Bell-like tone (a few inharmonic partials). */
function bell(a: BaseAudioContext, out: AudioNode, t: number, freq: number, dur: number, gain: number) {
  const partials: [number, number][] = [
    [1, 1],
    [2.01, 0.35],
    [3.02, 0.15],
    [4.17, 0.06],
  ];
  for (const [m, amp] of partials) {
    const o = a.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq * m;
    const g = a.createGain();
    const d = dur / Math.sqrt(m);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * amp, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + d + 0.02);
  }
}

// ---------- the sounds ----------

function tick(a: BaseAudioContext, out: AudioNode, t: number, gain = 0.5) {
  // light paper tick: very short, bright
  burst(a, out, t, { freq: rnd(4200), q: 0.9, dur: 0.018, gain, hp: 1800 });
}

function snap(a: BaseAudioContext, out: AudioNode, t: number, gain = 1) {
  // card landing on felt: crisp slap + small low knock
  burst(a, out, t, { freq: rnd(2300), q: 0.8, dur: 0.045, gain: 0.9 * gain, sweepTo: 1300 });
  burst(a, out, t, { freq: rnd(6000), q: 0.7, dur: 0.012, gain: 0.35 * gain, hp: 3500 });
  knock(a, out, t, rnd(160, 0.08), 0.05, 0.25 * gain);
}

function flick(a: BaseAudioContext, out: AudioNode, t: number, gain = 0.7) {
  // a card sliding off the deck: quick downward swish ending in a tap
  burst(a, out, t, { freq: rnd(5200), q: 1.4, dur: 0.035, gain: 0.35 * gain, sweepTo: 1800 });
  burst(a, out, t + 0.03, { freq: rnd(2600), q: 0.9, dur: 0.03, gain: 0.6 * gain, sweepTo: 1500 });
}

export function render(sfx: Sfx, a: BaseAudioContext, out: AudioNode, t: number) {
  switch (sfx) {
    case 'pick':
      tick(a, out, t, 0.55);
      break;
    case 'drop':
      snap(a, out, t);
      break;
    case 'flip':
      tick(a, out, t, 0.4);
      burst(a, out, t + 0.018, { freq: rnd(3000), q: 1, dur: 0.02, gain: 0.3 });
      break;
    case 'deal':
      // ten cards, in step with the deal animation (40 ms apart)
      for (let i = 0; i < 10; i++) flick(a, out, t + i * 0.04 + Math.random() * 0.006, 0.65);
      break;
    case 'deal-all':
      // a new game: 54 cards dealt quickly (16 ms apart, matching the animation)
      for (let i = 0; i < 54; i++) flick(a, out, t + i * 0.016 + Math.random() * 0.004, 0.38);
      break;
    case 'undo':
      // card pulled back: upward swish + soft landing
      burst(a, out, t, { freq: 900, q: 1.3, dur: 0.09, gain: 0.35, sweepTo: 3800 });
      snap(a, out, t + 0.09, 0.55);
      break;
    case 'complete': {
      // thirteen cards ruffle onto the foundation, then a bright two-note chime
      for (let i = 0; i < 13; i++) flick(a, out, t + i * 0.035, 0.45 + i * 0.015);
      const c = t + 13 * 0.035 + 0.05;
      bell(a, out, c, 1046.5, 0.9, 0.16);
      bell(a, out, c + 0.09, 1568, 1.1, 0.14);
      break;
    }
    case 'win': {
      // rising fanfare
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
      const at = [0, 0.11, 0.22, 0.33, 0.5, 0.6, 0.72];
      notes.forEach((f, i) => bell(a, out, t + at[i], f, i === notes.length - 1 ? 1.6 : 0.7, 0.16));
      break;
    }
    case 'pop':
      // distant firework: thump + crackle tail
      knock(a, out, t, rnd(70, 0.2), 0.25, 0.35);
      burst(a, out, t, { freq: 900, type: 'lowpass', q: 0.5, dur: 0.35, gain: 0.35 });
      for (let i = 0; i < 6; i++)
        burst(a, out, t + 0.08 + Math.random() * 0.4, { freq: rnd(5000, 0.3), q: 2, dur: 0.012, gain: 0.08 + Math.random() * 0.08 });
      break;
    case 'error':
      // soft muted knock (not a system "ding")
      knock(a, out, t, 190, 0.09, 0.35);
      knock(a, out, t + 0.07, 140, 0.12, 0.3);
      break;
  }
}

export function play(sfx: Sfx, delayMs = 0) {
  const l = live();
  if (!l) return;
  render(sfx, l.a, l.out, l.a.currentTime + 0.005 + delayMs / 1000);
}

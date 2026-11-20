interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  trail?: boolean;
}

const COLORS = ['#ffd84a', '#ff5a5a', '#5ad1ff', '#7dff6a', '#ff8af0', '#ffffff', '#ffa53a'];

/** Canvas fireworks over the board. Resolves when finished or stopped. */
export function fireworks(host: HTMLElement, durationMs = 5000): { stop: () => void; done: Promise<void> } {
  const canvas = document.createElement('canvas');
  canvas.className = 'fireworks';
  host.appendChild(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const ctx = canvas.getContext('2d')!;
  let w = 0;
  let h = 0;
  const size = () => {
    w = host.clientWidth;
    h = host.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  const parts: P[] = [];
  const start = performance.now();
  let nextLaunch = 0;
  let raf = 0;
  let stopped = false;
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));

  const launch = () => {
    const x = w * (0.2 + Math.random() * 0.6);
    parts.push({ x, y: h, vx: (Math.random() - 0.5) * 2, vy: -(h / 70 + Math.random() * 3), life: 0, max: 60 + Math.random() * 15, color: '#fff', trail: true });
  };
  const burst = (x: number, y: number) => {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const n = 50 + Math.floor(Math.random() * 30);
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n;
      const s = 1.5 + Math.random() * 3.5;
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 50 + Math.random() * 30, color });
    }
  };

  const frame = (t: number) => {
    if (stopped) return;
    const elapsed = t - start;
    if (elapsed < durationMs && t > nextLaunch) {
      launch();
      nextLaunch = t + 250 + Math.random() * 350;
    }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.trail ? 0.12 : 0.05;
      if (!p.trail) {
        p.vx *= 0.985;
        p.vy *= 0.985;
      }
      if (p.trail && (p.vy >= -1 || p.life > p.max)) {
        burst(p.x, p.y);
        parts.splice(i, 1);
        continue;
      }
      if (p.life > p.max) {
        parts.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = p.trail ? 1 : 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.trail ? 2 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (elapsed > durationMs && parts.length === 0) return stop();
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    canvas.remove();
    window.removeEventListener('resize', size);
    resolve();
  };
  window.addEventListener('resize', size);
  raf = requestAnimationFrame(frame);
  return { stop, done };
}

import { COLUMNS } from '../engine/cards';

export interface Metrics {
  W: number;
  H: number;
  margin: number;
  cw: number;
  ch: number;
  colStep: number;
  tableauTop: number;
  /** y of the bottom row (stock + foundations) */
  bottomY: number;
  /** max y a column's last card may reach (its bottom edge) */
  tableauBottom: number;
  compact: boolean;
  /** natural fan offsets (px) */
  downGap: number;
  upGap: number;
  /** horizontal step between stacked stock piles / completed runs */
  stockStep: number;
  foundStep: number;
}

export function computeMetrics(W: number, H: number): Metrics {
  const margin = Math.max(6, Math.min(16, W * 0.012));
  let cw = Math.min((W - 2 * margin) / 10.6, (H - 3 * margin) / 4.8, 120);
  cw = Math.max(cw, 20);
  const ch = cw * 1.4;
  const colStep = (W - 2 * margin) / COLUMNS;
  const compact = cw < 60;
  const tableauTop = margin;
  const bottomY = H - margin - ch;
  const tableauBottom = bottomY - margin * 0.75;
  return {
    W,
    H,
    margin,
    cw,
    ch,
    colStep,
    tableauTop,
    bottomY,
    tableauBottom,
    compact,
    downGap: ch * (compact ? 0.14 : 0.12),
    upGap: compact ? Math.max(ch * 0.4, 18) : ch * 0.25,
    stockStep: cw * 0.16,
    foundStep: cw * (compact ? 0.22 : 0.3),
  };
}

export function columnX(m: Metrics, col: number): number {
  return m.margin + col * m.colStep + (m.colStep - m.cw) / 2;
}

/**
 * y offset of each card in a column, compressing the fan so the column
 * never runs past tableauBottom. Face-down gaps shrink first.
 */
export function columnYs(m: Metrics, faceUps: boolean[]): number[] {
  const n = faceUps.length;
  if (n === 0) return [];
  let nd = 0;
  let nu = 0;
  for (let i = 0; i < n - 1; i++) faceUps[i] ? nu++ : nd++;
  const avail = m.tableauBottom - m.tableauTop - m.ch;
  let d = m.downGap;
  let u = m.upGap;
  if (nd * d + nu * u > avail) {
    const minD = m.ch * 0.05;
    if (nd > 0) d = Math.max(minD, (avail - nu * u) / nd);
    if (nd * d + nu * u > avail && nu > 0) u = Math.max(m.ch * 0.1, (avail - nd * d) / nu);
  }
  const ys: number[] = [];
  let y = m.tableauTop;
  for (let i = 0; i < n; i++) {
    ys.push(y);
    y += faceUps[i] ? u : d;
  }
  return ys;
}

export function stockX(m: Metrics, group: number): number {
  // Up to 5 piles, anchored at the right edge; group 0 is the leftmost / oldest.
  return m.W - m.margin - m.cw - 4 * m.stockStep + group * m.stockStep;
}

export function foundationX(m: Metrics, run: number): number {
  return m.margin + run * m.foundStep;
}

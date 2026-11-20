import { RANK_LABEL, Suit } from '../engine/cards';

/** Original suit and court-card artwork as an inline SVG sprite. */
export const SPRITE = `
<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    <symbol id="suit-0" viewBox="0 0 100 100">
      <path d="M50 4C40 22 8 40 8 60c0 14 11 22 22 22 8 0 14-4 17-10-1 10-5 18-13 24h32c-8-6-12-14-13-24 3 6 9 10 17 10 11 0 22-8 22-22C92 40 60 22 50 4z"/>
    </symbol>
    <symbol id="suit-1" viewBox="0 0 100 100">
      <path d="M50 90C22 68 5 50 5 31 5 16 16 6 30 6c9 0 16 5 20 13 4-8 11-13 20-13 14 0 25 10 25 25 0 19-17 37-45 59z"/>
    </symbol>
    <symbol id="suit-2" viewBox="0 0 100 100">
      <path d="M50 3l38 47-38 47-38-47z"/>
    </symbol>
    <symbol id="suit-3" viewBox="0 0 100 100">
      <circle cx="50" cy="27" r="20"/><circle cx="27" cy="57" r="20"/><circle cx="73" cy="57" r="20"/>
      <path d="M45 50h10c0 22 4 34 13 46H32c9-12 13-24 13-46z"/>
    </symbol>
    <symbol id="motif-13" viewBox="0 0 100 60">
      <path d="M10 52 L4 12 L28 32 L50 4 L72 32 L96 12 L90 52 Z" fill="currentColor" opacity=".9"/>
      <rect x="10" y="52" width="80" height="7" rx="2" fill="currentColor"/>
      <circle cx="50" cy="30" r="5" fill="#fff"/><circle cx="26" cy="40" r="3.5" fill="#fff"/><circle cx="74" cy="40" r="3.5" fill="#fff"/>
    </symbol>
    <symbol id="motif-12" viewBox="0 0 100 60">
      <path d="M8 50 Q50 -10 92 50 Q70 36 50 38 Q30 36 8 50Z" fill="currentColor" opacity=".9"/>
      <circle cx="50" cy="14" r="7" fill="currentColor"/><circle cx="50" cy="14" r="3" fill="#fff"/>
      <circle cx="28" cy="30" r="4" fill="currentColor"/><circle cx="72" cy="30" r="4" fill="currentColor"/>
      <rect x="12" y="50" width="76" height="6" rx="3" fill="currentColor"/>
    </symbol>
    <symbol id="motif-11" viewBox="0 0 100 60">
      <path d="M18 54 Q50 44 82 54 L78 38 Q50 30 22 38Z" fill="currentColor"/>
      <path d="M58 36 C66 18 82 8 94 4 C86 16 76 28 62 38Z" fill="currentColor" opacity=".75"/>
      <rect x="20" y="54" width="60" height="5" rx="2" fill="currentColor"/>
    </symbol>
  </defs>
</svg>`;

// Pip positions (x, y as % of the pip area). Pips below the middle are drawn upside down.
const PIPS: Record<number, [number, number][]> = {
  2: [[50, 0], [50, 100]],
  3: [[50, 0], [50, 50], [50, 100]],
  4: [[0, 0], [100, 0], [0, 100], [100, 100]],
  5: [[0, 0], [100, 0], [50, 50], [0, 100], [100, 100]],
  6: [[0, 0], [100, 0], [0, 50], [100, 50], [0, 100], [100, 100]],
  7: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [0, 100], [100, 100]],
  8: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [50, 75], [0, 100], [100, 100]],
  9: [[0, 0], [100, 0], [0, 33.3], [100, 33.3], [50, 50], [0, 66.7], [100, 66.7], [0, 100], [100, 100]],
  10: [[0, 0], [100, 0], [50, 16.7], [0, 33.3], [100, 33.3], [0, 66.7], [100, 66.7], [50, 83.3], [0, 100], [100, 100]],
};

const use = (id: string, cls: string, style = '') =>
  `<svg class="${cls}"${style ? ` style="${style}"` : ''} aria-hidden="true"><use href="#${id}"/></svg>`;

export function frontHTML(suit: Suit, rank: number): string {
  const r = RANK_LABEL[rank];
  const idx = (pos: string) => `<div class="idx ${pos}"><span class="rk">${r}</span>${use(`suit-${suit}`, 'sym')}</div>`;
  let mid: string;
  if (rank === 1) {
    mid = `<div class="mid ace">${use(`suit-${suit}`, 'pip big')}</div>`;
  } else if (rank <= 10) {
    mid =
      `<div class="mid pips">` +
      PIPS[rank]
        .map(([x, y]) => use(`suit-${suit}`, y > 50 ? 'pip inv' : 'pip', `left:${x}%;top:${y}%`))
        .join('') +
      `</div>`;
  } else {
    mid =
      `<div class="mid court">` +
      use(`motif-${rank}`, 'motif') +
      `<span class="court-rk">${r}</span>` +
      use(`suit-${suit}`, 'court-suit') +
      use(`motif-${rank}`, 'motif inv') +
      `</div>`;
  }
  return `<div class="face front s${suit}">${idx('tl')}${idx('br')}${mid}${use(`suit-${suit}`, 'cpip')}</div>`;
}

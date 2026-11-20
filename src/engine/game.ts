import { COLUMNS, DECK_SIZE, Rules, rankOf, suitOf } from './cards';
import { shuffle } from './rng';

export const START_SCORE = 500;
export const RUN_BONUS = 100;
const MAX_HISTORY = 3000;

export interface Board {
  /** 10 columns of card ids, index 0 = bottom (deepest) card. */
  tableau: number[][];
  /** Remaining stock; the last 10 ids are dealt next. */
  stock: number[];
  /** Completed runs, each 13 ids ordered King..Ace. */
  foundations: number[][];
  /** faceUp[id] */
  faceUp: boolean[];
}

export interface Move {
  from: number;
  index: number;
  to: number;
}

export interface ActionResult {
  /** Ids of cards that changed place. */
  moved: number[];
  /** Ids that were turned face up. */
  flipped: number[];
  /** Columns whose run was completed and removed (in order). */
  completed: number[];
}

export type DealCheck = 'ok' | 'empty-stock' | 'empty-column';

export interface SavedGame {
  v: 1;
  rules: Rules;
  seed: number;
  board: string;
  moves: number;
  elapsedMs: number;
  undo: string[];
  redo: string[];
}

export class Game {
  rules: Rules;
  seed: number;
  board: Board;
  /** All moves, deals, undos and redos (Windows 7 counts them all). */
  moves = 0;
  elapsedMs = 0;
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  private constructor(rules: Rules, seed: number, board: Board) {
    this.rules = { ...rules };
    this.seed = seed;
    this.board = board;
  }

  static create(rules: Rules, seed: number): Game {
    const ids = shuffle(
      Array.from({ length: DECK_SIZE }, (_, i) => i),
      seed,
    );
    const tableau: number[][] = Array.from({ length: COLUMNS }, () => []);
    // 54 cards round-robin: columns 1-4 get 6, columns 5-10 get 5.
    for (let i = 0; i < 54; i++) tableau[i % COLUMNS].push(ids[i]);
    const stock = ids.slice(54);
    const faceUp = new Array<boolean>(DECK_SIZE).fill(false);
    for (const col of tableau) faceUp[col[col.length - 1]] = true;
    return new Game(rules, seed, { tableau, stock, foundations: [], faceUp });
  }

  // ---------- derived state ----------

  get score(): number {
    return Math.max(0, START_SCORE - this.moves + RUN_BONUS * this.board.foundations.length);
  }

  get won(): boolean {
    return this.board.foundations.length === 8;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Has the player made any move yet? */
  get started(): boolean {
    return this.moves > 0;
  }

  get dealsLeft(): number {
    return Math.ceil(this.board.stock.length / COLUMNS);
  }

  suit(id: number) {
    return suitOf(id, this.rules.suits);
  }

  rank(id: number) {
    return rankOf(id);
  }

  // ---------- rules ----------

  /** True if the cards from `index` to the end of the column can be picked up together. */
  isMovableRun(col: number, index: number): boolean {
    const c = this.board.tableau[col];
    if (!c || index < 0 || index >= c.length) return false;
    for (let i = index; i < c.length; i++) {
      if (!this.board.faceUp[c[i]]) return false;
      if (i > index) {
        const prev = c[i - 1];
        const cur = c[i];
        if (this.suit(prev) !== this.suit(cur) || rankOf(prev) !== rankOf(cur) + 1) return false;
      }
    }
    return true;
  }

  /** Lowest index from which the column's top run is movable (or -1 if the column is empty). */
  runStart(col: number): number {
    const c = this.board.tableau[col];
    if (c.length === 0) return -1;
    let i = c.length - 1;
    while (i > 0 && this.isMovableRun(col, i - 1)) i--;
    return i;
  }

  canMove(from: number, index: number, to: number): boolean {
    if (from === to || to < 0 || to >= COLUMNS) return false;
    if (!this.isMovableRun(from, index)) return false;
    const target = this.board.tableau[to];
    if (target.length === 0) return true;
    const top = target[target.length - 1];
    const card = this.board.tableau[from][index];
    return rankOf(top) === rankOf(card) + 1;
  }

  checkDeal(): DealCheck {
    if (this.board.stock.length === 0) return 'empty-stock';
    if (this.rules.strictDeal && this.board.tableau.some((c) => c.length === 0)) return 'empty-column';
    return 'ok';
  }

  // ---------- actions ----------

  move(from: number, index: number, to: number): ActionResult | null {
    if (!this.canMove(from, index, to)) return null;
    this.pushHistory();
    const t = this.board.tableau;
    const cards = t[from].splice(index);
    t[to].push(...cards);
    this.moves++;
    const result: ActionResult = { moved: cards.slice(), flipped: [], completed: [] };
    this.flipTop(from, result);
    this.collect(to, result);
    return result;
  }

  deal(): ActionResult | null {
    if (this.checkDeal() !== 'ok') return null;
    this.pushHistory();
    const result: ActionResult = { moved: [], flipped: [], completed: [] };
    const n = Math.min(COLUMNS, this.board.stock.length);
    for (let c = 0; c < n; c++) {
      const id = this.board.stock.pop()!;
      this.board.faceUp[id] = true;
      this.board.tableau[c].push(id);
      result.moved.push(id);
    }
    this.moves++;
    for (let c = 0; c < COLUMNS; c++) this.collect(c, result);
    return result;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (prev === undefined) return false;
    this.redoStack.push(encodeBoard(this.board));
    this.board = decodeBoard(prev);
    this.moves++;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(encodeBoard(this.board));
    this.board = decodeBoard(next);
    this.moves++;
    return true;
  }

  private pushHistory() {
    this.undoStack.push(encodeBoard(this.board));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  private flipTop(col: number, result: ActionResult) {
    const c = this.board.tableau[col];
    if (c.length && !this.board.faceUp[c[c.length - 1]]) {
      this.board.faceUp[c[c.length - 1]] = true;
      result.flipped.push(c[c.length - 1]);
    }
  }

  /** Remove a completed King..Ace suited run from the top of `col`, if there is one. */
  private collect(col: number, result: ActionResult) {
    const c = this.board.tableau[col];
    if (c.length < 13) return;
    const start = c.length - 13;
    if (rankOf(c[start]) !== 13 || !this.isMovableRun(col, start)) return;
    const run = c.splice(start);
    this.board.foundations.push(run);
    result.completed.push(col);
    this.flipTop(col, result);
  }

  // ---------- hints ----------

  /** Every legal tableau move (each movable sub-run to each accepting column). */
  legalMoves(): Move[] {
    const out: Move[] = [];
    for (let from = 0; from < COLUMNS; from++) {
      const start = this.runStart(from);
      if (start < 0) continue;
      const len = this.board.tableau[from].length;
      for (let index = start; index < len; index++) {
        for (let to = 0; to < COLUMNS; to++) if (this.canMove(from, index, to)) out.push({ from, index, to });
      }
    }
    return out;
  }

  /**
   * Useful moves, best first. Skips moves that change nothing meaningful,
   * e.g. shuffling a run between two equivalent spots.
   */
  hints(): Move[] {
    const scored: { m: Move; s: number }[] = [];
    const t = this.board.tableau;
    for (const m of this.legalMoves()) {
      const card = t[m.from][m.index];
      const target = t[m.to];
      const toEmpty = target.length === 0;
      const sameSuit = !toEmpty && this.suit(target[target.length - 1]) === this.suit(card);
      const below = m.index > 0 ? t[m.from][m.index - 1] : -1;
      const belowUp = below >= 0 && this.board.faceUp[below];
      const sitsOnParent = belowUp && rankOf(below) === rankOf(card) + 1;
      const belowSameSuit = sitsOnParent && this.suit(below) === this.suit(card);

      if (toEmpty && m.index === 0) continue; // whole column to an empty column
      if (belowSameSuit) continue; // splitting a suited run
      if (sitsOnParent && !sameSuit) continue; // already on a valid parent; no gain
      if (toEmpty && sitsOnParent) continue;

      let s = 0;
      if (sameSuit) s += 50;
      if (below >= 0 && !belowUp) s += 30; // reveals a card
      if (m.index === 0) s += 15; // empties a column
      if (m.index === this.runStart(m.from)) s += 10;
      if (toEmpty) s -= 20;
      s += rankOf(card) / 100; // tie-break: longer chains first
      scored.push({ m, s });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.m);
  }

  /** No legal move and no deal possible. */
  isStuck(): boolean {
    return !this.won && this.checkDeal() !== 'ok' && this.legalMoves().length === 0;
  }

  // ---------- persistence ----------

  serialize(): SavedGame {
    return {
      v: 1,
      rules: { ...this.rules },
      seed: this.seed,
      board: encodeBoard(this.board),
      moves: this.moves,
      elapsedMs: Math.round(this.elapsedMs),
      undo: this.undoStack.slice(),
      redo: this.redoStack.slice(),
    };
  }

  static deserialize(s: SavedGame): Game {
    if (!s || s.v !== 1) throw new Error('Unsupported save');
    const g = new Game(s.rules, s.seed, decodeBoard(s.board));
    g.moves = s.moves | 0;
    g.elapsedMs = s.elapsedMs || 0;
    g.undoStack = s.undo.slice();
    g.redoStack = s.redo.slice();
    validateBoard(g.board);
    return g;
  }
}

// Compact board encoding: one char per card (id + 104 when face up),
// sections separated by '/', columns and runs separated by ','.
const BASE = 48;
function enc(ids: number[], faceUp: boolean[]): string {
  return String.fromCharCode(...ids.map((id) => BASE + id + (faceUp[id] ? DECK_SIZE : 0)));
}

export function encodeBoard(b: Board): string {
  return [
    b.tableau.map((c) => enc(c, b.faceUp)).join(','),
    enc(b.stock, b.faceUp),
    b.foundations.map((r) => enc(r, b.faceUp)).join(','),
  ].join('/');
}

export function decodeBoard(s: string): Board {
  const faceUp = new Array<boolean>(DECK_SIZE).fill(false);
  const dec = (str: string) =>
    Array.from(str, (ch) => {
      let v = ch.charCodeAt(0) - BASE;
      if (v >= DECK_SIZE) {
        v -= DECK_SIZE;
        faceUp[v] = true;
      }
      return v;
    });
  const [t, st, f] = s.split('/');
  const tableau = t.split(',').map(dec);
  const stock = dec(st);
  const foundations = f ? f.split(',').map(dec) : [];
  return { tableau, stock, foundations, faceUp };
}

function validateBoard(b: Board) {
  const seen = new Set<number>();
  const all = [...b.tableau.flat(), ...b.stock, ...b.foundations.flat()];
  for (const id of all) {
    if (id < 0 || id >= DECK_SIZE || seen.has(id)) throw new Error('Corrupt save');
    seen.add(id);
  }
  if (seen.size !== DECK_SIZE || b.tableau.length !== COLUMNS) throw new Error('Corrupt save');
}

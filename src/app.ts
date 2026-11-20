import { COLUMNS, DECK_SIZE, Rules, SUIT_NAME, cardName, rankOf, suitOf } from './engine/cards';
import { ActionResult, Game } from './engine/game';
import { randomSeed } from './engine/rng';
import { play, Sfx } from './services/audio';
import * as store from './services/storage';
import { Settings } from './services/storage';
import { SPRITE, frontHTML } from './ui/cardface';
import { dialogOpen, showDialog } from './ui/dialogs';
import { fireworks } from './ui/fireworks';
import { Metrics, columnX, columnYs, computeMetrics, foundationX, stockX } from './ui/layout';

interface Pos {
  x: number;
  y: number;
  z: number;
}

type Press =
  | { kind: 'card'; col: number; index: number; ids: number[]; x0: number; y0: number; pointerId: number; touch: boolean; dragging: boolean }
  | { kind: 'bad'; id: number; touch: boolean; pointerId: number }
  | { kind: 'stock'; pointerId: number }
  | { kind: 'slot'; col: number; pointerId: number };

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export class App {
  game!: Game;
  settings: Settings;
  m!: Metrics;
  touchUI: boolean;

  private boardEl = $('#board');
  private cardEls: HTMLElement[] = [];
  private slotEls: HTMLElement[] = [];
  private stockSlot!: HTMLElement;
  private pos: Pos[] = [];
  private elevateTimers = new Map<number, number>();

  private press: Press | null = null;
  private dropTarget = -1;
  private tapCycle: { id: number; col: number; time: number; visited: Set<number> } | null = null;
  private selected: { col: number; index: number } | null = null;
  private kb = { active: false, col: 0, count: 1, picked: null as { col: number; index: number } | null };
  private hintIdx = 0;
  private hintTimer = 0;
  private twoFinger: { time: number } | null = null;
  private fw: { stop: () => void } | null = null;
  private lastTick = performance.now();
  private gameOverShown = false;

  constructor() {
    this.touchUI = detectTouchUI();
    this.settings = store.loadSettings(this.touchUI);
    document.body.insertAdjacentHTML('afterbegin', SPRITE);
    this.buildBoard();
    this.applyAppearance();
    this.bindInput();
    this.bindChrome();
    this.start();
    setInterval(() => this.tick(), 1000);
  }

  // =========================================================== setup

  private buildBoard() {
    for (let c = 0; c < COLUMNS; c++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset.col = String(c);
      this.boardEl.appendChild(s);
      this.slotEls.push(s);
    }
    this.stockSlot = document.createElement('div');
    this.stockSlot.className = 'slot stock-slot';
    this.boardEl.appendChild(this.stockSlot);
    for (let id = 0; id < DECK_SIZE; id++) {
      const el = document.createElement('div');
      el.className = 'card down';
      el.dataset.id = String(id);
      el.innerHTML = `<div class="inner"><div class="face-wrap"></div><div class="face back"></div></div>`;
      this.boardEl.appendChild(el);
      this.cardEls.push(el);
      this.pos.push({ x: 0, y: 0, z: 0 });
    }
  }

  private paintFaces() {
    for (let id = 0; id < DECK_SIZE; id++) {
      const wrap = this.cardEls[id].querySelector('.face-wrap') as HTMLElement;
      wrap.innerHTML = frontHTML(suitOf(id, this.game.rules.suits), rankOf(id));
    }
  }

  private start() {
    const saved = store.loadGame();
    let restored: Game | null = null;
    if (saved) {
      try {
        restored = Game.deserialize(saved);
        if (restored.won) restored = null;
      } catch {
        store.saveGame(null);
      }
    }
    if (restored && this.settings.autoContinue) {
      this.setGame(restored, false);
    } else {
      this.setGame(Game.create(this.settings.rules, randomSeed()), true);
      if (restored) {
        const r = restored;
        showDialog({
          title: 'Saved game',
          body: '<p>Do you want to continue your saved game?</p>',
          buttons: [
            { label: 'Continue', primary: true, onClick: () => this.setGame(r, false) },
            { label: 'New game' },
          ],
        });
      }
    }
    this.showFirstTips();
  }

  private setGame(g: Game, dealAnim: boolean) {
    this.fw?.stop();
    this.game = g;
    this.gameOverShown = false;
    this.selected = null;
    this.kb.picked = null;
    this.tapCycle = null;
    this.hintIdx = 0;
    this.paintFaces();
    this.measure();
    if (dealAnim && this.settings.animations) this.dealAnimation();
    else this.render(false);
    this.save();
  }

  // =========================================================== layout / render

  private measure() {
    const r = this.boardEl.getBoundingClientRect();
    this.m = computeMetrics(r.width, r.height);
    const s = this.boardEl.style;
    s.setProperty('--cw', `${this.m.cw}px`);
    s.setProperty('--ch', `${this.m.ch}px`);
    this.boardEl.classList.toggle('compact', this.m.compact);
  }

  /** Target position of every card for the current game state. */
  private layout(): { pos: Pos[]; up: boolean[] } {
    const m = this.m;
    const b = this.game.board;
    const pos: Pos[] = new Array(DECK_SIZE);
    const up = b.faceUp.slice();
    b.tableau.forEach((col, c) => {
      const ys = columnYs(m, col.map((id) => b.faceUp[id]));
      const x = columnX(m, c);
      col.forEach((id, i) => (pos[id] = { x, y: ys[i], z: 100 + i }));
    });
    const groups = Math.ceil(b.stock.length / COLUMNS);
    b.stock.forEach((id, i) => {
      const g = Math.floor(i / COLUMNS);
      pos[id] = { x: stockX(m, g + (5 - groups)), y: m.bottomY, z: 10 + i };
      up[id] = false;
    });
    b.foundations.forEach((run, k) => {
      run.forEach((id, j) => (pos[id] = { x: foundationX(m, k), y: m.bottomY, z: 300 + k * 20 + (13 - j) }));
    });
    return { pos, up };
  }

  /**
   * Move every card element to its place.
   * delays: per-card transition delay (ms) for staggered animations.
   */
  private render(animate = true, delays?: Map<number, number>) {
    const { pos, up } = this.layout();
    const anim = animate && this.settings.animations;
    this.boardEl.classList.toggle('instant', !anim);
    const dur = 220;
    for (let id = 0; id < DECK_SIZE; id++) {
      const el = this.cardEls[id];
      const p = pos[id];
      const old = this.pos[id];
      const moved = Math.abs(old.x - p.x) > 0.5 || Math.abs(old.y - p.y) > 0.5;
      const delay = anim ? delays?.get(id) ?? 0 : 0;
      el.style.transitionDelay = delay ? `${delay}ms` : '';
      (el.firstElementChild as HTMLElement).style.transitionDelay = delay ? `${delay}ms` : '';
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.classList.toggle('down', !up[id]);
      el.setAttribute('aria-label', up[id] ? cardName(id, this.game.rules.suits) : 'Face-down card');
      if (anim && moved) {
        // Fly above everything, then settle into the normal stacking order.
        el.style.zIndex = String(1000 + p.z);
        clearTimeout(this.elevateTimers.get(id));
        this.elevateTimers.set(
          id,
          window.setTimeout(() => {
            this.elevateTimers.delete(id);
            el.style.zIndex = String(this.pos[id].z);
          }, dur + delay + 40),
        );
      } else {
        if (!anim) {
          clearTimeout(this.elevateTimers.get(id));
          this.elevateTimers.delete(id);
        }
        if (!this.elevateTimers.has(id)) el.style.zIndex = String(p.z);
      }
      el.classList.remove('dragging', 'drop-ok');
      this.pos[id] = p;
    }
    // Slots
    this.slotEls.forEach((s, c) => {
      s.style.transform = `translate(${columnX(this.m, c)}px, ${this.m.tableauTop}px)`;
    });
    this.stockSlot.style.transform = `translate(${stockX(this.m, 4)}px, ${this.m.bottomY}px)`;
    this.stockSlot.classList.toggle('empty', this.game.board.stock.length === 0);
    this.paintMarks();
    this.updateStatus();
    if (anim) this.boardEl.offsetWidth; // flush so transitions run
  }

  /** Keyboard focus, selection and pick-up highlights. */
  private paintMarks() {
    for (const el of this.cardEls) el.classList.remove('kb-focus', 'picked');
    for (const s of this.slotEls) s.classList.remove('kb-focus', 'drop-ok');
    const t = this.game.board.tableau;
    const mark = (col: number, from: number, cls: string) => {
      if (t[col].length === 0) this.slotEls[col].classList.add(cls);
      for (let i = Math.max(0, from); i < t[col].length; i++) this.cardEls[t[col][i]].classList.add(cls);
    };
    if (this.kb.active) mark(this.kb.col, t[this.kb.col].length - this.kb.count, 'kb-focus');
    if (this.kb.picked) mark(this.kb.picked.col, this.kb.picked.index, 'picked');
    if (this.selected) mark(this.selected.col, this.selected.index, 'picked');
  }

  private updateStatus() {
    const g = this.game;
    const time = fmtTime(g.elapsedMs);
    $('#st-score').textContent = String(g.score);
    $('#st-moves').textContent = String(g.moves);
    $('#st-time').textContent = time;
    $('#st-deals').textContent = String(g.dealsLeft);
    $('#deal-badge').textContent = String(g.dealsLeft);
    const r = g.rules;
    $('#rules-chip').textContent = `${r.suits} suit${r.suits > 1 ? 's' : ''}${r.strictDeal ? '' : ' · free deal'}`;
    $<HTMLButtonElement>('#tb-redo').hidden = !g.canRedo;
    const set = (sel: string, disabled: boolean) =>
      document.querySelectorAll<HTMLButtonElement>(sel).forEach((b) => (b.disabled = disabled));
    set('[data-act="undo"]', !g.canUndo);
    set('[data-act="deal"]', g.board.stock.length === 0);
  }

  private dealAnimation() {
    // Put every card on the stock, face down, without animation...
    const m = this.m;
    this.boardEl.classList.add('instant');
    for (let id = 0; id < DECK_SIZE; id++) {
      const el = this.cardEls[id];
      el.style.transitionDelay = '';
      (el.firstElementChild as HTMLElement).style.transitionDelay = '';
      el.classList.add('down');
      this.pos[id] = { x: stockX(m, 4), y: m.bottomY, z: 10 };
      el.style.transform = `translate(${this.pos[id].x}px, ${this.pos[id].y}px)`;
      el.style.zIndex = '10';
    }
    this.boardEl.offsetWidth;
    // ...then deal them out round-robin.
    const delays = new Map<number, number>();
    let order = 0;
    const t = this.game.board.tableau;
    for (let row = 0; row < 6; row++)
      for (let c = 0; c < COLUMNS; c++) if (t[c][row] !== undefined) delays.set(t[c][row], order++ * 16);
    requestAnimationFrame(() => this.render(true, delays));
    if (this.settings.sounds) play('deal');
  }

  // =========================================================== actions

  private sfx(s: Sfx) {
    if (this.settings.sounds) play(s);
  }

  private buzz(ms = 12) {
    if (this.touchUI) navigator.vibrate?.(ms);
  }

  doMove(from: number, index: number, to: number): boolean {
    const id = this.game.board.tableau[from][index];
    const res = this.game.move(from, index, to);
    if (!res) return false;
    this.render(true, this.completionDelays(res, 160));
    this.sfx('drop');
    this.buzz();
    this.announce(`Moved ${cardName(id, this.game.rules.suits)} to column ${to + 1}.`);
    this.afterAction(res);
    return true;
  }

  doDeal() {
    if (this.press?.kind === 'card' && this.press.dragging) return;
    const check = this.game.checkDeal();
    if (check === 'empty-column') {
      for (const s of this.slotEls) s.classList.remove('flash');
      this.boardEl.offsetWidth;
      this.game.board.tableau.forEach((c, i) => c.length === 0 && this.slotEls[i].classList.add('flash'));
      setTimeout(() => this.slotEls.forEach((s) => s.classList.remove('flash')), 1300);
      this.toast("You can't deal while there are empty columns.");
      this.sfx('error');
      return;
    }
    if (check === 'empty-stock') {
      this.toast('There are no more cards to deal.');
      return;
    }
    this.clearTransient();
    const res = this.game.deal()!;
    const delays = new Map<number, number>();
    res.moved.forEach((id, i) => delays.set(id, i * 40));
    this.completionDelays(res, 500, delays);
    this.render(true, delays);
    this.sfx('deal');
    this.announce(`Dealt a new row. ${this.game.dealsLeft} deals left.`);
    this.afterAction(res);
  }

  doUndo() {
    if (!this.game.canUndo) return;
    this.clearTransient();
    this.game.undo();
    this.render(true);
    this.sfx('pick');
    this.announce('Undone.');
    this.afterAction(null);
  }

  doRedo() {
    if (!this.game.canRedo) return;
    this.clearTransient();
    this.game.redo();
    this.render(true);
    this.sfx('drop');
    this.announce('Redone.');
    this.afterAction(null);
  }

  /** Stagger the cards of a completed run as they fly to the foundation. */
  private completionDelays(res: ActionResult, base: number, delays = new Map<number, number>()) {
    const f = this.game.board.foundations;
    for (let k = 0; k < res.completed.length; k++) {
      const run = f[f.length - res.completed.length + k];
      // Ace first (top of the column), King last.
      for (let j = 12; j >= 0; j--) delays.set(run[j], base + (12 - j) * 35 + k * 300);
    }
    return delays;
  }

  private afterAction(res: ActionResult | null) {
    this.hintIdx = 0;
    this.clearHint();
    if (res?.completed.length) {
      setTimeout(() => this.sfx('complete'), 300);
      const suit = suitOf(this.game.board.foundations[this.game.board.foundations.length - 1][0], this.game.rules.suits);
      this.announce(`Completed a run of ${SUIT_NAME[suit]}.`);
    }
    this.save();
    if (this.game.won) {
      this.onWin();
    } else if (this.game.isStuck() && !this.gameOverShown) {
      this.gameOverShown = true;
      setTimeout(() => this.noMovesDialog(), 600);
    } else if (!this.game.isStuck()) {
      this.gameOverShown = false;
    }
  }

  private clearTransient() {
    this.selected = null;
    this.kb.picked = null;
    this.clearHint();
  }

  newGame(rules: Rules = this.game.rules) {
    this.recordAbandon();
    this.settings.rules = { ...rules };
    store.saveSettings(this.settings);
    this.setGame(Game.create(rules, randomSeed()), true);
  }

  restartGame() {
    this.recordAbandon();
    this.setGame(Game.create(this.game.rules, this.game.seed), true);
  }

  /** Leaving a started, unfinished game counts as a loss (as in Windows 7). */
  private recordAbandon() {
    if (this.game && this.game.started && !this.game.won) store.recordResult(this.game.rules, false, this.game.score);
  }

  private save() {
    if (this.game.won || !this.settings.saveOnExit) store.saveGame(null);
    else store.saveGame(this.game.serialize());
  }

  private tick() {
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    const g = this.game;
    if (g.started && !g.won && !document.hidden && !dialogOpen()) {
      g.elapsedMs += Math.min(dt, 2000);
      this.updateStatus();
      if (Math.floor(g.elapsedMs / 1000) % 10 === 0) this.save();
    }
  }

  private onWin() {
    store.recordResult(this.game.rules, true, this.game.score);
    this.sfx('win');
    this.announce('You won!');
    const show = () => this.winDialog();
    if (this.settings.animations) {
      setTimeout(() => {
        this.fw = fireworks(this.boardEl, 4500);
        let shown = false;
        const once = () => {
          if (shown) return;
          shown = true;
          show();
        };
        this.fw && (this.fw as ReturnType<typeof fireworks>).done.then(once);
        setTimeout(once, 2500);
      }, 900);
    } else show();
  }

  // =========================================================== hints

  hint() {
    this.clearHint();
    const g = this.game;
    const hints = g.hints();
    if (hints.length === 0) {
      if (g.checkDeal() === 'ok') {
        this.toast('No useful moves. Deal a new row.');
        this.stockSlot.classList.add('hint-dst');
        g.board.stock.slice(-COLUMNS).forEach((id) => this.cardEls[id].classList.add('hint-src'));
        this.hintTimer = window.setTimeout(() => this.clearHint(), 1600);
      } else if (g.legalMoves().length) {
        this.toast('There are no more useful moves.');
      } else {
        this.noMovesDialog();
      }
      return;
    }
    const h = hints[this.hintIdx % hints.length];
    this.hintIdx++;
    const t = g.board.tableau;
    for (let i = h.index; i < t[h.from].length; i++) this.cardEls[t[h.from][i]].classList.add('hint-src');
    if (t[h.to].length) this.cardEls[t[h.to][t[h.to].length - 1]].classList.add('hint-dst');
    else this.slotEls[h.to].classList.add('hint-dst');
    this.hintTimer = window.setTimeout(() => this.clearHint(), 1600);
  }

  private clearHint() {
    clearTimeout(this.hintTimer);
    this.boardEl.querySelectorAll('.hint-src, .hint-dst').forEach((el) => el.classList.remove('hint-src', 'hint-dst'));
  }

  // =========================================================== pointer input

  private locate(id: number): { where: 'tableau' | 'stock' | 'found'; col: number; index: number } {
    const b = this.game.board;
    for (let c = 0; c < COLUMNS; c++) {
      const i = b.tableau[c].indexOf(id);
      if (i >= 0) return { where: 'tableau', col: c, index: i };
    }
    if (b.stock.includes(id)) return { where: 'stock', col: -1, index: -1 };
    return { where: 'found', col: -1, index: -1 };
  }

  private bindInput() {
    const board = this.boardEl;
    board.addEventListener('pointerdown', (e) => this.onDown(e));
    board.addEventListener('pointermove', (e) => this.onMove(e));
    board.addEventListener('pointerup', (e) => this.onUp(e));
    board.addEventListener('pointercancel', () => this.cancelPress());
    board.addEventListener('contextmenu', (e) => e.preventDefault());

    // Two-finger tap = undo
    board.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 2 && this.settings.twoFingerUndo) {
          this.cancelPress();
          this.twoFinger = { time: performance.now() };
        } else if (e.touches.length > 2) this.twoFinger = null;
      },
      { passive: true },
    );
    board.addEventListener('touchend', (e) => {
      if (this.twoFinger && e.touches.length === 0) {
        if (performance.now() - this.twoFinger.time < 450) this.doUndo();
        this.twoFinger = null;
      }
    });

    new ResizeObserver(() => {
      this.cancelPress();
      this.measure();
      this.render(false);
    }).observe(board);

    document.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => document.hidden && this.save());
  }

  private onDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.press) return; // a second finger never starts a new interaction
    if (this.twoFinger) return;
    this.kb.active = false;
    const touch = e.pointerType !== 'mouse';
    const cardEl = (e.target as HTMLElement).closest<HTMLElement>('.card');
    const slotEl = (e.target as HTMLElement).closest<HTMLElement>('.slot');
    if (cardEl) {
      const id = Number(cardEl.dataset.id);
      const loc = this.locate(id);
      if (loc.where === 'stock') this.press = { kind: 'stock', pointerId: e.pointerId };
      else if (loc.where === 'tableau' && this.game.isMovableRun(loc.col, loc.index)) {
        const ids = this.game.board.tableau[loc.col].slice(loc.index);
        this.press = { kind: 'card', col: loc.col, index: loc.index, ids, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, touch, dragging: false };
      } else if (loc.where === 'tableau' && this.selected) {
        this.press = { kind: 'slot', col: loc.col, pointerId: e.pointerId };
      } else if (loc.where === 'tableau') this.press = { kind: 'bad', id, touch, pointerId: e.pointerId };
    } else if (slotEl) {
      if (slotEl === this.stockSlot) this.press = { kind: 'stock', pointerId: e.pointerId };
      else this.press = { kind: 'slot', col: Number(slotEl.dataset.col), pointerId: e.pointerId };
    }
    if (this.press) {
      try {
        this.boardEl.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      e.preventDefault();
    }
  }

  private onMove(e: PointerEvent) {
    const p = this.press;
    if (!p || p.kind !== 'card' || e.pointerId !== p.pointerId) return;
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < (p.touch ? 8 : 4)) return;
      p.dragging = true;
      this.clearTransient();
      this.paintMarks();
      this.boardEl.classList.add('is-dragging');
      p.ids.forEach((id, i) => {
        const el = this.cardEls[id];
        el.classList.add('dragging');
        el.style.transitionDelay = '';
        el.style.zIndex = String(3000 + i);
      });
      this.sfx('pick');
    }
    const lift = p.touch ? 20 : 0;
    p.ids.forEach((id) => {
      const o = this.pos[id];
      this.cardEls[id].style.transform = `translate(${o.x + dx}px, ${o.y + dy - lift}px)`;
    });
    this.updateDropTarget(p.col, p.index, this.pos[p.ids[0]].x + dx, this.pos[p.ids[0]].y + dy - lift);
  }

  private updateDropTarget(from: number, index: number, x: number, y: number) {
    const m = this.m;
    const t = this.game.board.tableau;
    let best = -1;
    let bestArea = 0;
    for (let c = 0; c < COLUMNS; c++) {
      if (c === from || !this.game.canMove(from, index, c)) continue;
      const cx = columnX(m, c);
      const top = t[c].length ? this.pos[t[c][t[c].length - 1]].y : m.tableauTop;
      const y0 = m.tableauTop;
      const y1 = top + m.ch * 1.25;
      const ox = Math.max(0, Math.min(x + m.cw, cx + m.cw) - Math.max(x, cx));
      const oy = Math.max(0, Math.min(y + m.ch, y1) - Math.max(y, y0));
      const area = ox * oy;
      if (area > bestArea) {
        bestArea = area;
        best = c;
      }
    }
    if (best !== this.dropTarget) {
      this.boardEl.querySelectorAll('.drop-ok').forEach((el) => el.classList.remove('drop-ok'));
      if (best >= 0) {
        const col = t[best];
        (col.length ? this.cardEls[col[col.length - 1]] : this.slotEls[best]).classList.add('drop-ok');
      }
      this.dropTarget = best;
    }
  }

  private onUp(e: PointerEvent) {
    const p = this.press;
    if (!p || e.pointerId !== p.pointerId) return;
    this.press = null;
    this.boardEl.classList.remove('is-dragging');
    if (this.twoFinger) return this.render(true);
    switch (p.kind) {
      case 'card':
        if (p.dragging) {
          const to = this.dropTarget;
          this.dropTarget = -1;
          if (to < 0 || !this.doMove(p.col, p.index, to)) this.render(true); // snap back
        } else this.onTapCard(p.col, p.index);
        break;
      case 'bad':
        if (this.selected) break;
        this.shake(p.id);
        break;
      case 'stock':
        this.doDeal();
        break;
      case 'slot':
        if (this.selected) this.trySelectedMove(p.col);
        break;
    }
  }

  private cancelPress() {
    const p = this.press;
    this.press = null;
    this.dropTarget = -1;
    this.boardEl.classList.remove('is-dragging');
    if (p?.kind === 'card' && p.dragging) this.render(true);
  }

  private shake(id: number) {
    const el = this.cardEls[id];
    el.classList.remove('shake');
    el.offsetWidth;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 400);
    this.sfx('error');
  }

  private onTapCard(col: number, index: number) {
    if (this.settings.twoTapSelect) {
      const s = this.selected;
      if (s && s.col === col && s.index === index) {
        this.selected = null;
      } else if (s && s.col !== col && this.game.canMove(s.col, s.index, col)) {
        this.selected = null;
        this.doMove(s.col, s.index, col);
        return;
      } else {
        this.selected = { col, index };
        this.sfx('pick');
      }
      this.paintMarks();
      return;
    }
    this.tapMove(col, index);
  }

  private trySelectedMove(col: number) {
    const s = this.selected!;
    this.selected = null;
    if (!this.doMove(s.col, s.index, col)) {
      this.sfx('error');
      this.paintMarks();
    }
  }

  /** Destinations for a run, best first: same suit, any suit, then empty columns. */
  private destinations(col: number, index: number): number[] {
    const g = this.game;
    const t = g.board.tableau;
    const id = t[col][index];
    const same: number[] = [];
    const other: number[] = [];
    const empty: number[] = [];
    for (let c = 0; c < COLUMNS; c++) {
      if (!g.canMove(col, index, c)) continue;
      if (t[c].length === 0) {
        if (index > 0) empty.push(c);
      } else if (g.suit(t[c][t[c].length - 1]) === g.suit(id)) same.push(c);
      else other.push(c);
    }
    return [...same, ...other, ...empty];
  }

  /** One tap moves a card to its best place; tapping it again within 2 s tries the next place. */
  private tapMove(col: number, index: number) {
    const id = this.game.board.tableau[col][index];
    const now = performance.now();
    const cyc = this.tapCycle;
    const continuing = cyc && cyc.id === id && cyc.col === col && now - cyc.time < 2000;
    let visited = continuing ? cyc!.visited : new Set([col]);
    const dests = this.destinations(col, index);
    let to = dests.find((d) => !visited.has(d));
    if (to === undefined && continuing) {
      visited = new Set([col]);
      to = dests.find((d) => !visited.has(d));
    }
    if (to === undefined) {
      this.tapCycle = null;
      this.shake(id);
      return;
    }
    visited.add(to);
    if (this.doMove(col, index, to)) this.tapCycle = { id, col: to, time: now, visited };
  }

  // =========================================================== keyboard

  private onKey(e: KeyboardEvent) {
    if (dialogOpen()) return;
    if (this.popoverOpen()) return this.popoverKey(e);
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const handled = () => e.preventDefault();
    if (k === 'F2') return handled(), this.newGame();
    if (k === 'F3') return handled(), this.statsDialog();
    if (k === 'F4') return handled(), this.appearanceDialog();
    if (k === 'F5') return handled(), this.optionsDialog();
    if (k === 'F1') return handled(), this.helpDialog();
    if (ctrl && (k === 'z' || k === 'Z')) return handled(), e.shiftKey ? this.doRedo() : this.doUndo();
    if (ctrl && (k === 'y' || k === 'Y')) return handled(), this.doRedo();
    if (ctrl || e.altKey) return;
    if (k === 'h' || k === 'H') return handled(), this.hint();
    if (k === 'd' || k === 'D') return handled(), this.doDeal();
    if ((e.target as HTMLElement).closest('.dock, .popover') && (k === 'Enter' || k === ' ')) return;

    const t = this.game.board.tableau;
    const kb = this.kb;
    const maxCount = (c: number) => (t[c].length ? t[c].length - this.game.runStart(c) : 1);
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      handled();
      if (kb.active) kb.col = (kb.col + (k === 'ArrowLeft' ? COLUMNS - 1 : 1)) % COLUMNS;
      kb.active = true;
      kb.count = 1;
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      handled();
      if (kb.active && !kb.picked) kb.count = Math.max(1, Math.min(maxCount(kb.col), kb.count + (k === 'ArrowUp' ? 1 : -1)));
      kb.active = true;
    } else if (k === 'Enter' || k === ' ') {
      if (!kb.active) return;
      handled();
      if (!kb.picked) {
        const index = t[kb.col].length - kb.count;
        if (t[kb.col].length && this.game.isMovableRun(kb.col, index)) {
          kb.picked = { col: kb.col, index };
          this.sfx('pick');
          this.announce(`Picked up ${cardName(t[kb.col][index], this.game.rules.suits)}. Choose a column and press Enter.`);
        } else this.sfx('error');
      } else {
        const pk = kb.picked;
        kb.picked = null;
        if (pk.col !== kb.col && !this.doMove(pk.col, pk.index, kb.col)) {
          this.sfx('error');
          this.announce("Can't move there.");
        }
        kb.count = 1;
      }
    } else if (k === 'Escape') {
      if (kb.picked) kb.picked = null;
      else kb.active = false;
      this.selected = null;
    } else return;
    this.paintMarks();
    if (kb.active) {
      const col = t[kb.col];
      this.announceQuiet(
        col.length ? `Column ${kb.col + 1}: ${kb.count} card${kb.count > 1 ? 's' : ''} from ${cardName(col[col.length - kb.count], this.game.rules.suits)}` : `Column ${kb.col + 1}: empty`,
      );
    }
  }

  // =========================================================== chrome (menus, toolbar, dialogs)

  private bindChrome() {
    const act = (a: string) => this.action(a);
    // Bottom bar buttons (Undo has its own press-and-hold handling below)
    document.querySelectorAll<HTMLElement>('.dock [data-act]').forEach((b) =>
      b.addEventListener('click', () => act(b.dataset.act!)),
    );
    // ⋯ menu (popover on desktop)
    const pop = $('#more-pop');
    $('#more-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.action('more');
    });
    pop.querySelectorAll<HTMLElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        this.togglePopover(false);
        act(b.dataset.act!);
      }),
    );
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (this.popoverOpen() && !t.closest('#more-pop, #more-btn')) this.togglePopover(false);
    });
    window.addEventListener('resize', () => this.togglePopover(false));
    // Undo: press and hold to repeat
    const undo = $('#tb-undo');
    let holdT = 0;
    let rep = 0;
    const stop = () => {
      clearTimeout(holdT);
      clearInterval(rep);
    };
    undo.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.doUndo();
      holdT = window.setTimeout(() => (rep = window.setInterval(() => (this.game.canUndo ? this.doUndo() : stop()), 160)), 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => undo.addEventListener(ev, stop));
    undo.addEventListener('click', (e) => {
      if ((e as MouseEvent).detail === 0) this.doUndo(); // keyboard activation
    });
  }

  action(a: string) {
    switch (a) {
      case 'new':
        return this.newGameDialog();
      case 'new-same':
        return this.newGame();
      case 'restart':
        return this.restartGame();
      case 'undo':
        return this.doUndo();
      case 'redo':
        return this.doRedo();
      case 'hint':
        return this.hint();
      case 'deal':
        return this.doDeal();
      case 'stats':
        return this.statsDialog();
      case 'options':
        return this.optionsDialog();
      case 'appearance':
        return this.appearanceDialog();
      case 'help':
        return this.helpDialog();
      case 'about':
        return this.aboutDialog();
      case 'more':
        return this.touchUI ? this.moreSheet() : this.togglePopover();
    }
  }

  private popoverOpen() {
    return !$('#more-pop').hidden;
  }

  private togglePopover(open = !this.popoverOpen()) {
    const pop = $('#more-pop');
    const btn = $('#more-btn');
    if (open === this.popoverOpen()) return;
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('active', open);
    if (open) {
      const r = btn.getBoundingClientRect();
      pop.style.bottom = `${innerHeight - r.top + 8}px`;
      pop.style.left = `${Math.max(8, r.left)}px`;
      (pop.querySelector('button') as HTMLElement).focus();
    }
  }

  private popoverKey(e: KeyboardEvent) {
    const items = Array.from($('#more-pop').querySelectorAll<HTMLElement>('button'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      this.togglePopover(false);
      $('#more-btn').focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      items[(i + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n].focus();
    } else if (e.key === 'Tab') {
      this.togglePopover(false);
    }
  }

  /** Phone/tablet: the same menu as a bottom sheet. */
  private moreSheet() {
    const body = document.createElement('div');
    body.className = 'sheet';
    let close = () => {};
    $('#more-pop')
      .querySelectorAll<HTMLElement>('button, .sep')
      .forEach((src) => {
        const el = src.cloneNode(true) as HTMLElement;
        el.removeAttribute('role');
        el.querySelector('kbd')?.remove();
        if (el.dataset.act)
          el.addEventListener('click', () => {
            close();
            setTimeout(() => this.action(el.dataset.act!), 0);
          });
        body.appendChild(el);
      });
    close = showDialog({ title: 'Menu', body, buttons: [], className: 'sheet-dlg' });
  }

  newGameDialog() {
    const r = this.game.rules;
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="group"><div class="group-label">Suits</div>
        <div class="segmented">
          ${([
            [1, 'Beginner'],
            [2, 'Intermediate'],
            [4, 'Advanced'],
          ] as const)
            .map(
              ([n, lvl]) =>
                `<label><input type="radio" name="suits" value="${n}" ${r.suits === n ? 'checked' : ''}><span><b>${n} suit${n > 1 ? 's' : ''}</b><small>${lvl}</small></span></label>`,
            )
            .join('')}
        </div>
      </div>
      <div class="group"><div class="group-label">Dealing</div>
        ${switchRow('strict', r.strictDeal, 'Deal only when no column is empty', 'The Windows 7 rule')}
      </div>
      ${this.game.started && !this.game.won ? '<p class="note">The current game will count as a loss.</p>' : ''}`;
    showDialog({
      title: 'New game',
      body,
      buttons: [
        {
          label: 'Start',
          primary: true,
          onClick: () => {
            const suits = Number((body.querySelector('input[name=suits]:checked') as HTMLInputElement).value) as 1 | 2 | 4;
            const strictDeal = (body.querySelector('input[name=strict]') as HTMLInputElement).checked;
            this.newGame({ suits, strictDeal });
          },
        },
        { label: 'Cancel' },
      ],
    });
  }

  statsDialog() {
    const body = document.createElement('div');
    const sel = `<select class="select" name="rules" aria-label="Game rules">
      ${[1, 2, 4]
        .flatMap((s) => [true, false].map((strict) => ({ s, strict })))
        .map(
          ({ s, strict }) =>
            `<option value="${s}-${strict}" ${s === this.game.rules.suits && strict === this.game.rules.strictDeal ? 'selected' : ''}>${s} suit${s > 1 ? 's' : ''}, ${strict ? 'Windows 7 dealing' : 'deal any time'}</option>`,
        )
        .join('')}
      </select><table class="stats-table"></table>`;
    body.innerHTML = sel;
    const select = body.querySelector('select') as HTMLSelectElement;
    const rules = (): Rules => {
      const [s, strict] = select.value.split('-');
      return { suits: Number(s) as 1 | 2 | 4, strictDeal: strict === 'true' };
    };
    const fill = () => {
      const st = store.getStats(rules());
      const pct = st.played ? Math.round((st.won / st.played) * 100) : 0;
      const cur = st.current > 0 ? `${st.current} win${st.current > 1 ? 's' : ''}` : st.current < 0 ? `${-st.current} loss${st.current < -1 ? 'es' : ''}` : '0';
      (body.querySelector('table') as HTMLElement).innerHTML = `
        <tr><th>Games played</th><td>${st.played}</td></tr>
        <tr><th>Games won</th><td>${st.won}</td></tr>
        <tr><th>Win percentage</th><td>${pct}%</td></tr>
        <tr><th>High score</th><td>${st.highScore}</td></tr>
        <tr><th>Longest winning streak</th><td>${st.longestWin}</td></tr>
        <tr><th>Longest losing streak</th><td>${st.longestLoss}</td></tr>
        <tr><th>Current streak</th><td>${cur}</td></tr>`;
    };
    select.addEventListener('change', fill);
    fill();
    showDialog({
      title: 'Statistics',
      body,
      buttons: [
        { label: 'Close', primary: true },
        {
          label: 'Reset',
          onClick: () => {
            store.resetStats(rules());
            fill();
            return false;
          },
        },
      ],
    });
  }

  optionsDialog() {
    const s = this.settings;
    const box = (name: keyof Settings, label: string, sub = '') => switchRow(name, !!s[name], label, sub);
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="group"><div class="group-label">Play</div>
        ${box('twoTapSelect', 'Two-tap moves', 'Tap a card to select it, then tap where it goes')}
        ${box('twoFingerUndo', 'Two-finger tap to undo')}
        ${box('tips', 'Show tips')}
      </div>
      <div class="group"><div class="group-label">Effects</div>
        ${box('animations', 'Animations')}
        ${box('sounds', 'Sounds')}
      </div>
      <div class="group"><div class="group-label">Saving</div>
        ${box('saveOnExit', 'Save game when leaving')}
        ${box('autoContinue', 'Continue saved game automatically')}
      </div>`;
    showDialog({
      title: 'Options',
      body,
      buttons: [
        {
          label: 'Save',
          primary: true,
          onClick: () => {
            body.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((i) => {
              (s as unknown as Record<string, boolean>)[i.name] = i.checked;
            });
            store.saveSettings(s);
            this.selected = null;
            this.save();
            this.render(false);
          },
        },
        { label: 'Cancel' },
      ],
    });
  }

  appearanceDialog() {
    const s = this.settings;
    const body = document.createElement('div');
    const backs: store.CardBack[] = ['blue', 'red', 'green', 'purple'];
    const felts: store.Felt[] = ['green', 'blue', 'red', 'purple'];
    body.innerHTML = `
      <div class="group"><div class="group-label">Card back</div><div class="swatches">
        ${backs.map((b) => `<label class="swatch"><input type="radio" name="back" value="${b}" ${s.cardBack === b ? 'checked' : ''}><span class="sw-back back-${b}"></span></label>`).join('')}
      </div></div>
      <div class="group"><div class="group-label">Table</div><div class="swatches">
        ${felts.map((f) => `<label class="swatch"><input type="radio" name="felt" value="${f}" ${s.felt === f ? 'checked' : ''}><span class="sw-felt felt-${f}"></span></label>`).join('')}
      </div></div>
      <div class="group">
        ${switchRow('fourColor', s.fourColor, 'Four-colour suits', 'Diamonds blue, clubs green')}
      </div>`;
    showDialog({
      title: 'Appearance',
      body,
      buttons: [
        {
          label: 'Save',
          primary: true,
          onClick: () => {
            s.cardBack = (body.querySelector('input[name=back]:checked') as HTMLInputElement).value as store.CardBack;
            s.felt = (body.querySelector('input[name=felt]:checked') as HTMLInputElement).value as store.Felt;
            s.fourColor = (body.querySelector('input[name=fourColor]') as HTMLInputElement).checked;
            store.saveSettings(s);
            this.applyAppearance();
          },
        },
        { label: 'Cancel' },
      ],
    });
  }

  private applyAppearance() {
    const b = document.body;
    b.className = b.className.replace(/\b(felt|back)-\w+/g, '').trim();
    b.classList.add(`felt-${this.settings.felt}`, `back-${this.settings.cardBack}`);
    b.classList.toggle('four-color', this.settings.fourColor);
    b.classList.toggle('touch-ui', this.touchUI);
    b.classList.toggle('desktop-ui', !this.touchUI);
  }

  helpDialog() {
    const touch = this.touchUI;
    showDialog({
      title: 'How to play',
      className: 'wide',
      body: `
        <p><b>Goal:</b> build runs from King down to Ace in one suit. A finished run is removed automatically. Remove all 8 to win.</p>
        <ul>
          <li>Put any card on a card one rank higher, of any suit.</li>
          <li>A group of cards moves together only if it is in order <i>and</i> all one suit.</li>
          <li>Any card or group can go into an empty column.</li>
          <li>${touch ? 'Tap' : 'Click'} the stock (bottom right) to deal a new card onto every column. With the Windows 7 rule, every column must have a card first.</li>
        </ul>
        <p><b>Scoring:</b> you start with 500 points. Every move (including undo) costs 1 point; every completed run earns 100.</p>
        <p><b>Controls:</b> drag cards, or ${touch ? 'tap' : 'click'} a card to move it to the best spot (${touch ? 'tap' : 'click'} again to try the next spot).
        ${touch ? 'Undo is always at the bottom right; hold it to undo repeatedly, or tap the board with two fingers.' : ''}</p>
        <table class="keys">
          <tr><td><kbd>F2</kbd></td><td>New game</td><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd></td><td>Undo / Redo</td></tr>
          <tr><td><kbd>H</kbd></td><td>Hint</td><td><kbd>D</kbd></td><td>Deal</td></tr>
          <tr><td><kbd>F3</kbd></td><td>Statistics</td><td><kbd>F4</kbd> / <kbd>F5</kbd></td><td>Appearance / Options</td></tr>
          <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Choose column</td><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Choose how many cards</td></tr>
          <tr><td><kbd>Enter</kbd></td><td>Pick up / drop</td><td><kbd>Esc</kbd></td><td>Cancel</td></tr>
        </table>`,
    });
  }

  aboutDialog() {
    showDialog({
      title: 'About',
      body: `<p><b>Spider Solitaire</b> for the web, inspired by the classic Windows 7 game.</p>
        <p>All card art, sounds and graphics are original. Not affiliated with or endorsed by Microsoft.</p>`,
    });
  }

  private winDialog() {
    const g = this.game;
    const st = store.getStats(g.rules);
    showDialog({
      title: 'You won!',
      body: `<p class="big">Congratulations — all eight runs are complete.</p>
        <table class="stats-table">
          <tr><th>Score</th><td>${g.score}</td></tr>
          <tr><th>Moves</th><td>${g.moves}</td></tr>
          <tr><th>Time</th><td>${fmtTime(g.elapsedMs)}</td></tr>
          <tr><th>High score</th><td>${st.highScore}</td></tr>
          <tr><th>Games won</th><td>${st.won} of ${st.played}</td></tr>
        </table>`,
      buttons: [{ label: 'Close' }, { label: 'Play again', primary: true, onClick: () => this.newGame() }],
      onClose: () => this.fw?.stop(),
    });
  }

  private noMovesDialog() {
    if (dialogOpen() || this.game.won) return;
    showDialog({
      title: 'No more moves',
      body: '<p>There are no moves left and no cards to deal. What would you like to do?</p>',
      buttons: [
        { label: 'Restart', onClick: () => this.restartGame() },
        { label: 'New game', onClick: () => this.newGame() },
        { label: 'Undo', primary: true, onClick: () => this.doUndo() },
      ],
    });
  }

  // =========================================================== feedback

  private toastTimer = 0;
  toast(msg: string, ms = 2600) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  private announce(msg: string) {
    const el = $('#live');
    el.textContent = '';
    setTimeout(() => (el.textContent = msg), 30);
  }

  private announceQuiet(msg: string) {
    $('#live').textContent = msg;
  }

  private showFirstTips() {
    if (!this.settings.tips) return;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem('spider.tips');
      localStorage.setItem('spider.tips', '1');
    } catch {
      /* ignore */
    }
    if (seen) return;
    setTimeout(
      () =>
        this.toast(
          this.touchUI
            ? 'Tip: tap a card to move it. Undo is at the bottom right — hold it, or tap with two fingers.'
            : 'Tip: drag cards, or click one to move it to the best spot. Press H for a hint.',
          5500,
        ),
      1200,
    );
  }
}

function switchRow(name: string, on: boolean, label: string, sub = ''): string {
  return `<label class="switch-row"><span class="sr-text">${label}${sub ? `<small>${sub}</small>` : ''}</span><input type="checkbox" class="switch" name="${name}" ${on ? 'checked' : ''}></label>`;
}

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

function detectTouchUI(): boolean {
  const q = new URLSearchParams(location.search).get('ui');
  if (q === 'touch') return true;
  if (q === 'desktop') return false;
  return matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 500;
}

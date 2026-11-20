import { DEFAULT_RULES, Rules } from '../engine/cards';
import type { SavedGame } from '../engine/game';
import { isStandalone } from './pwa';

const KEY_GAME = 'spider.game.v1';
const KEY_SETTINGS = 'spider.settings.v1';
const KEY_STATS = 'spider.stats.v1';

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: ignore */
  }
}

// ---------- settings ----------

export type CardBack = 'blue' | 'red' | 'green' | 'purple';
export type Felt = 'green' | 'blue' | 'red' | 'purple';

export interface Settings {
  rules: Rules;
  animations: boolean;
  sounds: boolean;
  tips: boolean;
  autoContinue: boolean;
  saveOnExit: boolean;
  twoFingerUndo: boolean;
  twoTapSelect: boolean;
  fourColor: boolean;
  cardBack: CardBack;
  felt: Felt;
}

export function defaultSettings(touch: boolean): Settings {
  return {
    rules: { ...DEFAULT_RULES },
    animations: true,
    sounds: !touch || isStandalone(), // on for desktop and the installed app
    tips: true,
    autoContinue: true,
    saveOnExit: true,
    twoFingerUndo: true,
    twoTapSelect: false,
    fourColor: false,
    cardBack: 'blue',
    felt: 'green',
  };
}

export function loadSettings(touch: boolean): Settings {
  const d = defaultSettings(touch);
  const s = read<Partial<Settings>>(KEY_SETTINGS);
  return s ? { ...d, ...s, rules: { ...d.rules, ...(s.rules ?? {}) } } : d;
}

export function saveSettings(s: Settings) {
  write(KEY_SETTINGS, s);
}

// ---------- saved game ----------

export function loadGame(): SavedGame | null {
  return read<SavedGame>(KEY_GAME);
}

export function saveGame(g: SavedGame | null) {
  write(KEY_GAME, g);
}

// ---------- statistics ----------

export interface Stats {
  played: number;
  won: number;
  highScore: number;
  longestWin: number;
  longestLoss: number;
  /** >0 = current win streak, <0 = current losing streak */
  current: number;
}

export function rulesKey(r: Rules): string {
  return `${r.suits}-${r.strictDeal ? 'strict' : 'free'}`;
}

export function emptyStats(): Stats {
  return { played: 0, won: 0, highScore: 0, longestWin: 0, longestLoss: 0, current: 0 };
}

export function loadAllStats(): Record<string, Stats> {
  return read<Record<string, Stats>>(KEY_STATS) ?? {};
}

export function getStats(r: Rules): Stats {
  return { ...emptyStats(), ...(loadAllStats()[rulesKey(r)] ?? {}) };
}

export function recordResult(r: Rules, won: boolean, score: number) {
  const all = loadAllStats();
  const s = { ...emptyStats(), ...(all[rulesKey(r)] ?? {}) };
  s.played++;
  if (won) {
    s.won++;
    s.highScore = Math.max(s.highScore, score);
    s.current = s.current > 0 ? s.current + 1 : 1;
    s.longestWin = Math.max(s.longestWin, s.current);
  } else {
    s.current = s.current < 0 ? s.current - 1 : -1;
    s.longestLoss = Math.max(s.longestLoss, -s.current);
  }
  all[rulesKey(r)] = s;
  write(KEY_STATS, all);
}

export function resetStats(r: Rules) {
  const all = loadAllStats();
  delete all[rulesKey(r)];
  write(KEY_STATS, all);
}

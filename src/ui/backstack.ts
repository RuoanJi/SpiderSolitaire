import { isFramed } from '../services/pwa';

/**
 * Makes the Android back button (and browser Back) close the top dialog, sheet
 * or menu instead of leaving the game. While anything is open we keep one extra
 * history entry; Back pops it and we close the top layer.
 */
const stack: (() => void)[] = [];
const enabled = !isFramed();
let pushed = false;
let ignorePop = false;

function push() {
  if (!enabled || pushed) return;
  try {
    history.pushState({ spiderLayer: true }, '');
    pushed = true;
  } catch {
    /* ignore */
  }
}

if (enabled) {
  window.addEventListener('popstate', () => {
    if (ignorePop) {
      ignorePop = false;
      return;
    }
    if (!pushed) return;
    pushed = false;
    stack[stack.length - 1]?.();
    if (stack.length) push(); // more layers underneath: keep catching Back
  });
}

/** Register an open layer. Returns the function to call when it closes. */
export function pushLayer(close: () => void): () => void {
  stack.push(close);
  push();
  return () => {
    const i = stack.lastIndexOf(close);
    if (i >= 0) stack.splice(i, 1);
    // Wait a moment: closing one dialog often opens another straight away.
    setTimeout(() => {
      if (stack.length === 0 && pushed) {
        pushed = false;
        ignorePop = true;
        history.back();
      }
    }, 80);
  };
}

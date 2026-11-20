import { pushLayer } from './backstack';

export interface DialogButton {
  label: string;
  primary?: boolean;
  /** Return false to keep the dialog open. */
  onClick?: () => void | boolean;
}

export interface DialogOptions {
  title: string;
  body: string | HTMLElement;
  buttons?: DialogButton[];
  onClose?: () => void;
  className?: string;
}

let openCount = 0;
export const dialogOpen = () => openCount > 0;

/** Modal dialog (a bottom sheet on touch devices). Returns a function that closes it. */
export function showDialog(opts: DialogOptions): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'dlg-overlay';
  const win = document.createElement('div');
  win.className = `dlg ${opts.className ?? ''}`;
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-modal', 'true');
  win.setAttribute('aria-label', opts.title);
  win.innerHTML = `<div class="dlg-head"><h2>${opts.title}</h2><button class="dlg-x" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="dlg-body"></div><div class="dlg-buttons"></div>`;
  const body = win.querySelector('.dlg-body') as HTMLElement;
  if (typeof opts.body === 'string') body.innerHTML = opts.body;
  else body.appendChild(opts.body);
  const btns = win.querySelector('.dlg-buttons') as HTMLElement;
  const prevFocus = document.activeElement as HTMLElement | null;

  let closed = false;
  let removeLayer = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    openCount--;
    removeLayer();
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    prevFocus?.focus?.();
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      // keep focus inside the dialog
      const f = Array.from(win.querySelectorAll<HTMLElement>('button, input, select, [tabindex]:not([tabindex="-1"])')).filter(
        (el) => !(el as HTMLInputElement).disabled,
      );
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    } else {
      e.stopPropagation(); // don't trigger game shortcuts behind the dialog
    }
  };

  let primary: HTMLButtonElement | null = null;
  const list = (opts.buttons ?? [{ label: 'OK', primary: true }]).slice();
  // Secondary actions on the left, the primary action last (right).
  list.sort((a, b) => Number(!!a.primary) - Number(!!b.primary));
  if (!list.length) btns.remove();
  for (const b of list) {
    const el = document.createElement('button');
    el.className = `btn${b.primary ? ' primary' : ''}`;
    el.textContent = b.label;
    el.addEventListener('click', () => {
      if (b.onClick?.() === false) return;
      close();
    });
    btns.appendChild(el);
    if (b.primary && !primary) primary = el;
  }
  win.querySelector('.dlg-x')!.addEventListener('click', close);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });
  overlay.appendChild(win);
  document.body.appendChild(overlay);
  openCount++;
  removeLayer = pushLayer(close);
  document.addEventListener('keydown', onKey, true);
  (primary ?? (win.querySelector('.dlg-buttons button, .dlg-body button, .dlg-x') as HTMLElement | null))?.focus();
  return close;
}

/**
 * Keeps `[data-tip]` tooltips on screen.
 *
 * The tooltips are CSS `::after` boxes, centred on (or aligned to) their element, so one on a
 * button near the window's edge would hang off it. When the pointer or focus reaches an element
 * with a tip, this measures where the tip would land and, if it would cross the edge, sets
 * `--tip-dx` on the element, which the stylesheet adds to the tip as a `translate`.
 *
 * It also keeps a tip from popping up when focus lands on a button without the user tabbing
 * there - e.g. when a dialog or menu closes and hands focus back to the button that opened it.
 * Such an element gets `tip-quiet` until it loses focus.
 */

const MARGIN = 8;

function place(el: HTMLElement) {
  el.style.removeProperty('--tip-dx');
  const tip = getComputedStyle(el, '::after');
  if (tip.content === 'none' || tip.position !== 'absolute') return;

  const box = el.getBoundingClientRect();
  // Cards on the canvas are scaled with the zoom; the tip is too.
  const scale = el.offsetWidth ? box.width / el.offsetWidth : 1;
  const left = parseFloat(tip.left);
  const width = parseFloat(tip.width);
  if (!Number.isFinite(left) || !Number.isFinite(width)) return;
  const tx = tip.transform && tip.transform !== 'none' ? new DOMMatrixReadOnly(tip.transform).m41 : 0;

  const x = box.left + (el.clientLeft + left + tx) * scale;
  const right = x + width * scale;
  let dx = 0;
  if (right > innerWidth - MARGIN) dx = innerWidth - MARGIN - right;
  if (x + dx < MARGIN) dx = MARGIN - x;
  if (Math.abs(dx) >= 1) el.style.setProperty('--tip-dx', `${Math.round(dx / scale)}px`);
}

let tabbing = false;

function onEnter(e: Event) {
  const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]');
  if (!el) return;
  place(el);
  if (e.type === 'focusin' && e.target === el && !tabbing) {
    el.classList.add('tip-quiet');
    el.addEventListener('blur', () => el.classList.remove('tip-quiet'), { once: true });
  }
}

export function installTipPlacement() {
  document.addEventListener('keydown', (e) => (tabbing = e.key === 'Tab'), true);
  document.addEventListener('pointerdown', () => (tabbing = false), true);
  document.addEventListener('pointerover', onEnter, { passive: true });
  document.addEventListener('focusin', onEnter);
}

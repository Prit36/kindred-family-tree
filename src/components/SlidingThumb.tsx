import { useLayoutEffect, type RefObject } from 'react';

/**
 * A segmented control's chosen option marked by one pill that slides between options,
 * rather than each option lighting up on its own. The control holds a `.seg-thumb` span;
 * this keeps it over the chosen button (`aria-checked` or `aria-selected`).
 */
export function useSlidingThumb(ref: RefObject<HTMLElement | null>, value: unknown) {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const thumb = box.querySelector<HTMLElement>(':scope > .seg-thumb');
    if (!thumb) return;
    box.classList.add('has-thumb');
    const place = (animate: boolean) => {
      const on = box.querySelector<HTMLElement>('button[aria-checked="true"], button[aria-selected="true"]');
      if (!on) {
        thumb.style.opacity = '0';
        return;
      }
      if (!animate) thumb.style.transition = 'none';
      thumb.style.opacity = '1';
      thumb.style.width = `${on.offsetWidth}px`;
      thumb.style.height = `${on.offsetHeight}px`;
      thumb.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
      if (!animate) {
        void thumb.offsetWidth;
        thumb.style.transition = '';
      }
    };
    const first = !thumb.dataset.placed;
    thumb.dataset.placed = '1';
    place(!first);
    // Labels hide on narrow screens, which changes the buttons' widths.
    const ro = new ResizeObserver(() => place(false));
    ro.observe(box);
    return () => ro.disconnect();
  }, [ref, value]);
}

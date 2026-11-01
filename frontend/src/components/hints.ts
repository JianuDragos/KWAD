// Logica explicațiilor la hover, fără React, ca să poată fi testată în Node (hints.test.ts).
// Textul vine din atributul title: la primul hover îl mutăm în data-hint, ca browserul să nu mai afișeze și el
// tooltip-ul lui, și îl păstrăm pentru cititoarele de ecran în aria-description.

export interface Hint {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

/** Cât stă pointerul pe element până apare explicația. Din tastatură (focus vizibil) apare imediat. */
export const HOVER_DELAY_MS = 5000;
/** Distanța minimă față de marginile ferestrei (jumătate din lățimea maximă a tooltip-ului + spațiu). */
const EDGE_PX = 150;

type HintEvents = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/** Ascultă hover și focus pe tot documentul; întoarce funcția de oprire. */
export function attachHints(doc: HintEvents, win: HintEvents & { innerWidth: number }, onHint: (h: Hint | null) => void): () => void {
  let current: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    current = null;
    onHint(null);
  };
  const reveal = (el: Element) => {
    const text = el.getAttribute('data-hint');
    if (!text || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 90; // lângă marginea de sus nu e loc deasupra
    const x = Math.min(Math.max(r.left + r.width / 2, EDGE_PX), win.innerWidth - EDGE_PX);
    onHint({ text, x, y: below ? r.bottom + 8 : r.top - 8, below });
  };
  const arm = (el: Element, delayMs: number) => {
    const title = el.getAttribute('title');
    if (title) {
      el.setAttribute('data-hint', title);
      el.removeAttribute('title');
      el.setAttribute('aria-description', title);
    }
    if (!el.getAttribute('data-hint')) return hide();
    clearTimeout(timer);
    onHint(null);
    current = el;
    if (delayMs === 0) reveal(el);
    else timer = setTimeout(() => current === el && reveal(el), delayMs);
  };
  const target = (e: Event) => (e.target as Element | null)?.closest?.('[title], [data-hint]') ?? null;
  const onOver = (e: Event) => {
    const el = target(e);
    if (!el) return hide();
    if (el !== current) arm(el, HOVER_DELAY_MS);
  };
  // Un click mută și el focusul pe buton; doar focusul din tastatură (:focus-visible) arată explicația imediat.
  const onFocus = (e: Event) => {
    const el = target(e);
    if (el && (e.target as Element).matches(':focus-visible')) arm(el, 0);
  };
  const onOut = (e: Event) => {
    const next = (e as MouseEvent).relatedTarget as Node | null;
    if (current && !(next && current.contains(next))) hide();
  };
  doc.addEventListener('mouseover', onOver);
  doc.addEventListener('mouseout', onOut);
  doc.addEventListener('focusin', onFocus);
  doc.addEventListener('focusout', hide);
  doc.addEventListener('pointerdown', hide);
  doc.addEventListener('keydown', hide);
  win.addEventListener('scroll', hide, true);
  return () => {
    clearTimeout(timer);
    doc.removeEventListener('mouseover', onOver);
    doc.removeEventListener('mouseout', onOut);
    doc.removeEventListener('focusin', onFocus);
    doc.removeEventListener('focusout', hide);
    doc.removeEventListener('pointerdown', hide);
    doc.removeEventListener('keydown', hide);
    win.removeEventListener('scroll', hide, true);
  };
}

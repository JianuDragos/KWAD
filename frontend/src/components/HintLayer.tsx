// Explicațiile la hover, în stilul aplicației, în locul tooltip-ului nativ. Apar doar după ce pointerul stă
// 5 secunde pe element, ca să nu deranjeze în timpul prezentării; din tastatură (focus) apar imediat.
// Textul vine din atributul title: la primul hover îl mutăm în data-hint, ca browserul să nu mai afișeze și el
// tooltip-ul lui, și îl păstrăm pentru cititoarele de ecran în aria-description.
import { useEffect, useState } from 'react';

interface Hint {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

export const HOVER_DELAY_MS = 5000;
/** Distanța minimă față de marginile ferestrei (jumătate din lățimea maximă a tooltip-ului + spațiu). */
const EDGE_PX = 150;

export function HintLayer() {
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    let current: Element | null = null;
    let timer = 0;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setHint(null);
    };
    const reveal = (el: Element) => {
      const text = el.getAttribute('data-hint');
      if (!text || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      const below = r.top < 90; // lângă marginea de sus nu e loc deasupra
      const x = Math.min(Math.max(r.left + r.width / 2, EDGE_PX), window.innerWidth - EDGE_PX);
      setHint({ text, x, y: below ? r.bottom + 8 : r.top - 8, below });
    };
    const arm = (el: Element, delayMs: number) => {
      const title = el.getAttribute('title');
      if (title) {
        el.setAttribute('data-hint', title);
        el.removeAttribute('title');
        el.setAttribute('aria-description', title);
      }
      if (!el.getAttribute('data-hint')) return hide();
      window.clearTimeout(timer);
      setHint(null);
      current = el;
      if (delayMs === 0) reveal(el);
      else timer = window.setTimeout(() => current === el && reveal(el), delayMs);
    };
    const target = (e: Event) => (e.target instanceof Element ? e.target.closest('[title], [data-hint]') : null);
    const onOver = (e: Event) => {
      const el = target(e);
      if (!el) return hide();
      if (el !== current) arm(el, HOVER_DELAY_MS);
    };
    const onFocus = (e: Event) => {
      const el = target(e);
      if (el) arm(el, 0);
    };
    const onOut = (e: MouseEvent) => {
      if (current && !(e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) hide();
    };
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('keydown', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  if (!hint) return null;
  return (
    <div className={`hint ${hint.below ? 'hint--below' : ''}`} role="tooltip" style={{ left: hint.x, top: hint.y }}>
      {hint.text}
    </div>
  );
}

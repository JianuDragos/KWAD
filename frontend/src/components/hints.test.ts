import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOVER_DELAY_MS, attachHints, type Hint } from './hints';

// Testele rulează în Node, fără DOM: un element minim, cu atribute, poziție și :focus-visible controlabil.
class FakeElement {
  attrs = new Map<string, string>();
  isConnected = true;
  focusVisible = false;
  constructor(title?: string) {
    if (title) this.attrs.set('title', title);
  }
  getAttribute = (k: string) => this.attrs.get(k) ?? null;
  setAttribute = (k: string, v: string) => void this.attrs.set(k, v);
  removeAttribute = (k: string) => void this.attrs.delete(k);
  closest = () => (this.attrs.has('title') || this.attrs.has('data-hint') ? this : null);
  matches = (sel: string) => sel === ':focus-visible' && this.focusVisible;
  contains = (n: unknown) => n === this;
  getBoundingClientRect = () => ({ left: 400, top: 300, width: 40, bottom: 320 });
}

const doc = new EventTarget();
const win = Object.assign(new EventTarget(), { innerWidth: 1280 });
const fire = (type: string, target: unknown, extra: Record<string, unknown> = {}) => {
  const e = new Event(type);
  Object.defineProperty(e, 'target', { value: target });
  for (const [k, v] of Object.entries(extra)) Object.defineProperty(e, k, { value: v });
  doc.dispatchEvent(e);
};

let shown: (Hint | null)[] = [];
let stop: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  shown = [];
  stop = attachHints(doc as unknown as Window, win as unknown as Window, (h) => shown.push(h));
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});
const last = () => shown[shown.length - 1] ?? null;

describe('attachHints', () => {
  it('arată explicația abia după 2,5 secunde de hover și mută title în data-hint', () => {
    const el = new FakeElement('Pista în folosință');
    fire('mouseover', el);
    expect(el.getAttribute('title')).toBeNull();
    expect(el.getAttribute('aria-description')).toBe('Pista în folosință');
    vi.advanceTimersByTime(HOVER_DELAY_MS - 1);
    expect(last()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(last()?.text).toBe('Pista în folosință');
  });

  it('nu mai apare dacă pointerul pleacă înainte de 2,5 secunde', () => {
    const el = new FakeElement('QNH');
    fire('mouseover', el);
    vi.advanceTimersByTime(2000);
    fire('mouseout', el, { relatedTarget: null });
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(last()).toBeNull();
  });

  it('la focus din click nu apare imediat; la focus din tastatură apare imediat', () => {
    const el = new FakeElement('Regiune');
    fire('focusin', el);
    expect(last()).toBeNull();
    el.focusVisible = true;
    fire('focusin', el);
    expect(last()?.text).toBe('Regiune');
  });
});

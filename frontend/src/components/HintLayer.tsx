// Explicațiile la hover, în stilul aplicației, în locul tooltip-ului nativ. Logica e în hints.ts.
import { useEffect, useState } from 'react';
import { attachHints, type Hint } from './hints';

export function HintLayer() {
  const [hint, setHint] = useState<Hint | null>(null);
  useEffect(() => attachHints(document, window, setHint), []);

  if (!hint) return null;
  return (
    <div className={`hint ${hint.below ? 'hint--below' : ''}`} role="tooltip" style={{ left: hint.x, top: hint.y }}>
      {hint.text}
    </div>
  );
}

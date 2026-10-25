import type { ScenarioId, SkillName } from '../types';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown>;

/** Tiny element builder. Text children are always set as text, never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k === 'html') {
        el.innerHTML = String(v);
      } else if (k === 'value') {
        (el as HTMLInputElement).value = String(v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

// ---- Typewriter -----------------------------------------------------------

let finishTyping: (() => void) | null = null;

export const isTyping = () => finishTyping !== null;
export const skipTyping = () => finishTyping?.();

/** Reveals text a few characters at a time. Tap or press Enter/Space to finish early. */
export function typeText(el: HTMLElement, text: string, instant: boolean): Promise<void> {
  finishTyping?.();
  if (instant) {
    el.textContent = text;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let i = 0;
    el.textContent = '';
    el.classList.add('typing');
    const timer = window.setInterval(() => {
      i += 2;
      el.textContent = text.slice(0, i);
      if (i >= text.length) done();
    }, 26);
    const done = () => {
      window.clearInterval(timer);
      el.textContent = text;
      el.classList.remove('typing');
      if (finishTyping === done) finishTyping = null;
      resolve();
    };
    finishTyping = done;
  });
}

// ---- Glyphs ---------------------------------------------------------------

/** Each skill has a shape as well as a colour, so it never relies on colour alone. */
const SKILL_SHAPES: Record<SkillName, string> = {
  Research: '<circle cx="6" cy="6" r="4.5"/>',
  Communication: '<path d="M6 1.2 L10.8 10.2 L1.2 10.2 Z"/>',
  Organisation: '<rect x="1.8" y="1.8" width="8.4" height="8.4" rx="1"/>',
  Analysis: '<path d="M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z"/>',
};

export const skillClass = (s: string) => `skill-${s.toLowerCase()}`;

export function skillGlyph(skill: SkillName): SVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="glyph" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">${SKILL_SHAPES[skill]}</svg>`;
  return wrap.firstElementChild as SVGElement;
}

export function skillChip(skill: SkillName, note?: string): HTMLElement {
  return h('span', { class: `chip ${skillClass(skill)}` }, skillGlyph(skill), skill, note ? h('span', { class: 'chip-note' }, note) : null);
}

/** Small building silhouettes used in buttons, the HUD and the career map. */
const BUILDING_ICONS: Record<ScenarioId, string> = {
  // Resort tower with a rooftop canopy, beside the water
  resort: '<path d="M8 20V6h7v14M7 6h9M8 4h7M10 9h3M10 12h3M10 15h3M3 21c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0"/>',
  // Civic building with solar panels and a small wind turbine
  policy: '<path d="M3 10l7-5 7 5M4 10h12M6 10v8M10 10v8M14 10v8M3 20h14M20 20V8M20 8l-2.5-3M20 8l3 1M20 8l-.5 3.5"/>',
  // Shophouse row with an awning and bunting
  foundation: '<path d="M3 21V9h18v12M3 9l9-5 9 5M3 14h18M5 14l1.5 2 1.5-2 1.5 2 1.5-2 1.5 2 1.5-2 1.5 2 1.5-2 1.5 2M10 21v-3h4v3"/>',
  // Round glass tower with a ticker band and halo
  workforce: '<path d="M7 21V7h10v14M7 11h10M7 15h10M9 4h6M12 2v2M10 21v-3h4v3"/>',
};

export function buildingIcon(id: ScenarioId): SVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="bicon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${BUILDING_ICONS[id]}</svg>`;
  return wrap.firstElementChild as SVGElement;
}

/** Five dots showing a self-rating average, with a text alternative. */
export function ratingDots(value: number, label: string): HTMLElement {
  const rounded = Math.round(value * 2) / 2;
  const dots = [1, 2, 3, 4, 5].map((i) =>
    h('span', { class: `dot ${rounded >= i ? 'full' : rounded >= i - 0.5 ? 'half' : ''}` }),
  );
  return h('span', { class: 'dots', role: 'img', 'aria-label': label }, dots);
}

export function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

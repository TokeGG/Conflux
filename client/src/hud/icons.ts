// Icons for elements, skill shapes, statuses and room kinds: inline SVG (24 x 24, drawn with currentColor), so they take the
// colour of whatever holds them and need no files. Ten element colours are listed so the new elements already have a look.

/** The colour of each element; an unknown element gets a stone grey. */
export const ELEMENT_COLOUR: Record<string, string> = {
  fire: '#ff7a30',
  water: '#4aa8ff',
  earth: '#b08a5a',
  wind: '#b8f0e0',
  lightning: '#ffe14a',
  light: '#fff0a8',
  dark: '#a070e0',
  metal: '#b4bccb',
  poison: '#8bd84a',
  time: '#e883d8',
};
export const elementColour = (el: string | null | undefined): string => (el && ELEMENT_COLOUR[el]) || '#6d6a62';

const FILL = 'fill="currentColor"';
const LINE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const svg = (body: string, mode: string = FILL): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" ${mode}>${body}</svg>`;

const ELEMENT_ART: Record<string, string> = {
  fire: svg('<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-4.5 3-7 1 1 1.5 2 2 2.5C11.5 7 11 4.5 12 2z"/>'),
  water: svg('<path d="M12 2.5C8 8 5.5 11 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 11 16 8 12 2.5z"/>'),
  earth: svg('<path d="M2 20 9 6l4 7 3-4 6 11z"/>'),
  wind: svg('<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>', LINE),
  lightning: svg('<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>'),
  light: svg('<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>', LINE),
  dark: svg('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5z"/>'),
  metal: svg('<path fill-rule="evenodd" d="M12 2 21 7v10l-9 5-9-5V7zM12 7l-4 2.3v5.4l4 2.3 4-2.3V9.3z"/>'),
  poison: svg('<path d="M9 2h6v2l-1 1v4l5 9a2 2 0 0 1-2 3H7a2 2 0 0 1-2-3l5-9V5L9 4z"/>'),
  time: svg('<path d="M6 2h12M6 22h12M7 2c0 6 5 7 5 10s-5 4-5 10M17 2c0 6-5 7-5 10s5 4 5 10"/>', LINE),
};
const FALLBACK = svg('<circle cx="12" cy="12" r="8"/>', LINE);
export const elementIcon = (el: string | null | undefined): string => (el && ELEMENT_ART[el]) || FALLBACK;

const SHAPE_ART: Record<string, string> = {
  projectile: svg('<circle cx="17" cy="12" r="3.5" fill="currentColor"/><path d="M2 12h8M4 8h5M4 16h5"/>', LINE),
  cone: svg('<path d="M3 12 21 4v16z"/>'),
  stream: svg('<path d="M2 8c4-3 6 3 10 0s6-3 10 0M2 14c4-3 6 3 10 0s6-3 10 0M2 20c4-3 6 3 10 0s6-3 10 0"/>', LINE),
  zone: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>', LINE),
  wall: svg('<path d="M3 20V8l3-2 3 2 3-2 3 2 3-2 3 2v12z"/>'),
  self: svg('<circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>', LINE),
  dash: svg('<path d="m4 6 7 6-7 6M12 6l7 6-7 6"/>', LINE),
};
export const shapeIcon = (shape: string | undefined): string => (shape && SHAPE_ART[shape]) || FALLBACK;

const STATUS_ART: Record<string, string> = {
  burning: ELEMENT_ART.fire,
  soaked: ELEMENT_ART.water,
  rocked: ELEMENT_ART.earth,
  gusted: ELEMENT_ART.wind,
  shocked: ELEMENT_ART.lightning,
  exposed: ELEMENT_ART.light,
  cursed: ELEMENT_ART.dark,
  rent: ELEMENT_ART.metal,
  poisoned: ELEMENT_ART.poison,
  slowed_in_time: ELEMENT_ART.time,
  blind: svg('<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12zM4 4l16 16"/>', LINE),
  rooted: svg('<path d="M12 3v10M12 13c-3 0-5 2-5 5M12 13c3 0 5 2 5 5M12 8c-2 0-4-1-4-3M12 8c2 0 4-1 4-3"/>', LINE),
  slowed: svg('<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>', LINE),
  brittle: svg('<path d="m12 2 3 7 7 1-5 5 2 7-7-4-7 4 2-7-5-5 7-1z"/>', LINE),
  stunned: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/>', LINE),
  airborne: svg('<path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 10 1 3.5 3.5 0 0 1 0 7z"/>', LINE),
};
export const statusArt = (id: string): string => STATUS_ART[id] ?? FALLBACK;

const ROOM_ART: Record<string, string> = {
  fight: svg('<path d="m4 20 10-10M14 6l4 4M13 3l8 8M20 20 10 10"/>', LINE),
  elite: svg('<path d="m3 8 4 3 5-7 5 7 4-3-2 11H5z"/>'),
  boss: svg('<path d="M12 3C7 3 4 7 4 11c0 3 2 4 2 6v3h12v-3c0-2 2-3 2-6 0-4-3-8-8-8zM9 11h.01M15 11h.01"/>', LINE),
  shop: svg('<path d="M4 8h16l-1.5 12h-13zM8 8V6a4 4 0 0 1 8 0v2"/>', LINE),
  shrine: svg('<path d="M12 2v6M8 6h8M5 22V12l7-4 7 4v10M10 22v-5h4v5"/>', LINE),
  rest: svg('<path d="M3 20h18M5 20v-8h14v8M5 12V8h6v4"/>', LINE),
  augment: svg('<path d="M12 2 21 9l-9 13L3 9zM3 9h18M12 2l-4 7 4 13 4-13z"/>', LINE),
  heal: svg('<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>'),
  souls: svg('<path d="M12 2c4 0 6 3 6 7v9l-3-2-3 2-3-2-3 2V9c0-4 2-7 6-7zM10 9h.01M14 9h.01"/>', LINE),
  depth: svg('<path d="M4 20h4v-4h4v-4h4V8h4"/>', LINE),
};
export const roomIcon = (kind: string): string => ROOM_ART[kind] ?? ROOM_ART.fight;

/** A span holding an icon, for putting in the DOM. */
export function iconEl(markup: string, colour?: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'ico-svg';
  if (colour) s.style.color = colour;
  s.innerHTML = markup;
  return s;
}

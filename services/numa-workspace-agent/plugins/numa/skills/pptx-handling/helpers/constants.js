// constants.js — valid PptxGenJS shape names + the Numa palette.
//
// GENERIC HELPER (pptx-handling skill). PptxGenJS rejects guessed shape
// constants (ROUNDED_RECT, OVAL, CIRCLE, RECTANGLE...) and the retry loop that
// follows was the single biggest source of wasted turns in deck benchmarks.
// Import the correct names from here instead of guessing.
//
//   const { SHAPES, PALETTE, shape } = require('/app/plugins/numa/skills/pptx-handling/helpers/constants.js');
//   slide.addShape(SHAPES.roundRect, { x:1, y:1, w:3, h:1, fill:{ color: PALETTE.primary } });
//   // or normalise a guessed name:
//   slide.addShape(shape('ROUNDED_RECT'), {...});   // -> 'roundRect'

// The shape names PptxGenJS actually accepts (string values of pptx.ShapeType).
// These are the ones decks need 99% of the time — full list at
// https://gitbrent.github.io/PptxGenJS/docs/api-shapes/
const SHAPES = {
  rect: 'rect',
  roundRect: 'roundRect', // NOT 'ROUNDED_RECT' / 'ROUND_RECT' / 'RECTANGLE'
  ellipse: 'ellipse', // NOT 'OVAL' / 'CIRCLE'
  triangle: 'triangle',
  rtTriangle: 'rtTriangle',
  diamond: 'diamond',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  octagon: 'octagon',
  line: 'line',
  chevron: 'chevron',
  rightArrow: 'rightArrow',
  leftArrow: 'leftArrow',
  upArrow: 'upArrow',
  downArrow: 'downArrow',
  pie: 'pie',
  donut: 'donut',
  cloud: 'cloud',
  star5: 'star5',
  plus: 'plus',
  can: 'can',
  cube: 'cube',
};

// Common wrong → right, so a guessed name still works via shape().
const ALIASES = {
  rounded_rect: 'roundRect',
  round_rect: 'roundRect',
  rectangle: 'rect',
  square: 'rect',
  oval: 'ellipse',
  circle: 'ellipse',
  arrow: 'rightArrow',
  rounded_rectangle: 'roundRect',
  right_arrow: 'rightArrow',
};

/** Normalise a (possibly guessed) shape name to a valid PptxGenJS one. */
function shape(name) {
  if (!name) return SHAPES.rect;
  const key = String(name).trim();
  if (SHAPES[key]) return SHAPES[key]; // exact valid
  const norm = key.replace(/[\s-]+/g, '_').toLowerCase();
  if (ALIASES[norm]) return ALIASES[norm]; // known alias
  const camel = Object.keys(SHAPES).find((k) => k.toLowerCase() === key.toLowerCase());
  return camel ? SHAPES[camel] : SHAPES.rect; // case-insensitive, else rect
}

// Numa palette — dev-notes/notes/asknuma-design-palette.md.
const PALETTE = {
  primary: '9949AC', // Numa purple
  lavender: 'DFBDE7', // soft lavender (tints/badges)
  teal: '1F4B5E', // deep teal (dark sections)
  charcoal: '1F1F1F', // dark backgrounds
  bodyText: '323232', // body text
  warmWhite: 'F7F5F1', // card/section backgrounds
  white: 'FFFFFF',
  black: '000000',
  success: '22C55E',
  error: 'EF4444',
  // Ordered series colours for charts/accents.
  series: ['9949AC', '1F4B5E', 'DFBDE7', '22C55E', '323232', 'EF4444'],
};

// Type scale (pt) and fonts, matching the palette doc.
const TYPE = {
  fontHead: 'Figtree', // falls back to a sans the container has
  fontBody: 'Calibri',
  titleSize: 40,
  sectionSize: 24,
  headingSize: 20,
  bodySize: 14,
  captionSize: 11,
};

module.exports = { SHAPES, ALIASES, shape, PALETTE, TYPE };

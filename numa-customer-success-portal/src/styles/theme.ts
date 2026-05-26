/**
 * Numa Portal — JS-side design tokens.
 *
 * The single source of truth for colors used in TS / JS (Chart.js datasets,
 * inline styles, JS-generated SVG, etc.). CSS-side tokens live in
 * src/styles/arcanum-theme.css under :root and stay in sync by name.
 *
 * Palette derived from asknuma.ai. See dev-notes/notes/asknuma-design-palette.md
 * for the design rationale.
 */

export const ND_COLORS = {
  // Surfaces
  bg: '#F7F5F1',
  panel: '#FFFFFF',
  panel2: '#F7F5F1',
  panel3: '#EFEAE2',
  border: 'rgba(31, 31, 31, 0.10)',

  // Text
  text: '#1F1F1F',
  textDim: '#323232',
  textFaint: '#6b6b6b',

  // Brand
  accent: '#9949AC',
  accentLight: '#DFBDE7',
  accentDark: '#7D3490',
  accent2: '#1F4B5E',

  // States
  warn: '#d97706',
  bad: '#EF4444',
  good: '#22C55E',
  info: '#1F4B5E',
} as const;

/**
 * Chart series palette — leads with Numa purple, then varied accents
 * tuned for readability on the warm-off-white card background.
 */
export const ND_CHART_PAL: string[] = [
  '#9949AC', // Numa purple
  '#1F4B5E', // Deep teal
  '#DFBDE7', // Soft lavender
  '#d97706', // Warm amber
  '#22C55E', // Success green
  '#7D3490', // Dark purple
  '#EF4444', // Error red
  '#0EA5E9', // Sky blue
  '#84cc16', // Lime
  '#f97316', // Orange
  '#06b6d4', // Cyan
  '#a855f7', // Violet
  '#facc15', // Yellow
  '#fb7185', // Rose
  '#94a3b8', // Slate
];

/**
 * Soft fill versions of the brand colors for area / fill backgrounds.
 */
export const ND_FILL = {
  accent: 'rgba(153, 73, 172, 0.10)',
  accentStrong: 'rgba(153, 73, 172, 0.55)',
  accent2: 'rgba(31, 75, 94, 0.10)',
  good: 'rgba(34, 197, 94, 0.18)',
  warn: 'rgba(217, 119, 6, 0.18)',
} as const;

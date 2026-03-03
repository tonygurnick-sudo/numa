import type { TicketPriority, StatusType } from '../../../types/ops';

/**
 * 12 visually distinct colors for board/work-centre color pickers.
 */
export const BOARD_COLORS: string[] = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan / light blue
  '#f97316', // orange
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#a855f7', // purple
  '#84cc16', // lime
  '#0ea5e9', // sky
  '#f43f5e', // rose
  '#10b981', // emerald
  '#64748b', // slate
  '#6c757d', // neutral grey
  '#343a40', // dark grey
  '#adb5bd', // light grey
];

/**
 * Maps a 1-10 position to a color on a green-to-red gradient.
 * Position 1 = green (#22c55e), position 10 = red (#ef4444),
 * with smooth interpolation through yellow/orange in between.
 */
export function getColorForPosition(position: number, reverse = false): string {
  const clamped = Math.max(1, Math.min(10, position));
  let t = (clamped - 1) / 9; // 0..1
  if (reverse) t = 1 - t; // Flips 0..1 to 1..0, making 1 red and 10 green

  // Gradient stops: green -> yellow -> orange -> red
  const stops = [
    { pos: 0, r: 0x22, g: 0xc5, b: 0x5e }, // #22c55e  green
    { pos: 0.33, r: 0xea, g: 0xb3, b: 0x08 }, // #eab308  yellow
    { pos: 0.66, r: 0xf9, g: 0x73, b: 0x16 }, // #f97316  orange
    { pos: 1, r: 0xef, g: 0x44, b: 0x44 }, // #ef4444  red
  ];

  // Find the two stops surrounding t
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].pos && t <= stops[i + 1].pos) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }

  const range = upper.pos - lower.pos;
  const ratio = range === 0 ? 0 : (t - lower.pos) / range;

  const r = Math.round(lower.r + (upper.r - lower.r) * ratio);
  const g = Math.round(lower.g + (upper.g - lower.g) * ratio);
  const b = Math.round(lower.b + (upper.b - lower.b) * ratio);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Calculate auto-assigned positions for N items
 * Distributes items evenly across the 10-point scale
 *
 * Mapping table:
 * | Count | Positions |
 * |-------|-----------|
 * | 1     | [6]       |
 * | 2     | [1, 10]   |
 * | 3     | [1, 6, 10] |
 * | 4     | [1, 4, 7, 10] |
 * | 5     | [1, 3, 6, 8, 10] |
 * | 6     | [1, 2, 4, 6, 8, 10] |
 * | 7     | [1, 2, 4, 6, 7, 9, 10] |
 * | 8+    | Distribute evenly |
 */
export function calculateAutoColorPositions(itemCount: number): number[] {
  if (itemCount <= 0) return [];
  if (itemCount === 1) return [6]; // Single item gets "Normal"
  if (itemCount >= 10) {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  }

  const predefinedMappings: Record<number, number[]> = {
    2: [1, 10],
    3: [1, 6, 10],
    4: [1, 4, 7, 10],
    5: [1, 3, 6, 8, 10],
    6: [1, 2, 4, 6, 8, 10],
    7: [1, 2, 4, 6, 7, 9, 10],
  };

  if (predefinedMappings[itemCount]) {
    return predefinedMappings[itemCount];
  }

  const positions: number[] = [];
  for (let i = 0; i < itemCount; i++) {
    positions.push(Math.round(1 + (i * 9) / (itemCount - 1)));
  }
  return positions;
}

/**
 * Returns '#000' or '#fff' depending on which has better contrast
 * against the given hex background color (based on relative luminance).
 */
export function getContrastTextColor(bgColor: string): string {
  const hex = bgColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  // sRGB to linear
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

  return luminance > 0.179 ? '#000' : '#fff';
}

/**
 * Maps ticket priority to a Bootstrap-style color.
 *   highest / high  = red (#dc3545)
 *   medium          = orange (#fd7e14)
 *   low             = green (#28a745)
 *   lowest          = blue (#0d6efd)
 */
export function getPriorityColor(priority: TicketPriority): string {
  switch (priority) {
    case 'highest':
    case 'high':
      return '#dc3545';
    case 'medium':
      return '#fd7e14';
    case 'low':
      return '#28a745';
    case 'lowest':
      return '#0d6efd';
    default:
      return '#6c757d';
  }
}

/**
 * Maps a status type to a color used in badges and boards.
 */
export function getStatusTypeColor(statusType: StatusType): string {
  switch (statusType) {
    case 'backlog':
      return '#6c757d';
    case 'scoped':
      return '#0dcaf0';
    case 'queued':
      return '#ffc107';
    case 'active':
      return '#0d6efd';
    case 'completed':
      return '#198754';
    case 'ended':
      return '#6c757d';
    case 'deleted':
      return '#dc3545';
    default:
      return '#6c757d';
  }
}

/**
 * Derives a light background, the original color as border, and
 * a suitable text color from a base hex color. Used for board/card styling.
 */
export function getBoardColor(color: string): { border: string; bg: string; text: string } {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Light background: blend the color towards white at ~10% opacity
  const bgR = Math.round(r + (255 - r) * 0.9);
  const bgG = Math.round(g + (255 - g) * 0.9);
  const bgB = Math.round(b + (255 - b) * 0.9);

  const bg = `#${bgR.toString(16).padStart(2, '0')}${bgG.toString(16).padStart(2, '0')}${bgB.toString(16).padStart(2, '0')}`;

  return {
    border: color,
    bg,
    text: getContrastTextColor(bg),
  };
}
// trailing ws fix

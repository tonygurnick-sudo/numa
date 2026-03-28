/**
 * Shared Color Scale Utility
 * v171a-color-utils.js
 *
 * 10-point color gradient scale for use across the application:
 * - CRM Lifecycle Stages (Phase 1)
 * - Priority Colors (UX-001)
 * - Any future configurable color-coded fields
 *
 * @version v171a
 * @date 2026-01-17
 *
 * v171a Changes:
 * - BUG-170-002 FIX: getColorForPosition now converts position to integer
 *   to handle string/number type mismatch (e.g., "6" vs 6)
 * - Added console.log for debugging/load confirmation
 */

/**
 * 10-point color gradient scale
 * Position 1 = most urgent/critical (red)
 * Position 10 = least urgent/minimal (grey)
 */
const COLOR_SCALE = [
  { position: 1, hex: '#E53935', name: 'Critical' },
  { position: 2, hex: '#F4511E', name: 'Very High' },
  { position: 3, hex: '#FB8C00', name: 'High' },
  { position: 4, hex: '#FFB300', name: 'Medium-High' },
  { position: 5, hex: '#FFF176', name: 'Above Normal' },
  { position: 6, hex: '#43A047', name: 'Normal' },
  { position: 7, hex: '#90CAF9', name: 'Below Normal' },
  { position: 8, hex: '#64B5F6', name: 'Low' },
  { position: 9, hex: '#3F85C4', name: 'Very Low' },
  { position: 10, hex: '#616161', name: 'Minimal' },
];

/**
 * Get hex color for a position (1-10)
 * v171a: Now converts position to integer to handle string/number mismatch
 * @param {number|string} position - Position in scale (1-10)
 * @returns {string} Hex color code, or grey if out of range
 */
function getColorForPosition(position) {
  // v171a: Convert to integer to handle "6" vs 6 type mismatch
  const posInt = parseInt(position, 10);
  const entry = COLOR_SCALE.find((c) => c.position === posInt);
  return entry ? entry.hex : '#616161'; // Default to grey if not found
}

/**
 * Get full color entry for a position (1-10)
 * @param {number|string} position - Position in scale (1-10)
 * @returns {object|null} { position, hex, name } or null if not found
 */
function getColorEntryForPosition(position) {
  // v171a: Convert to integer to handle string/number mismatch
  const posInt = parseInt(position, 10);
  return COLOR_SCALE.find((c) => c.position === posInt) || null;
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
 *
 * @param {number} itemCount - Number of items to distribute (1-10+)
 * @returns {number[]} Array of positions (1-10)
 */
function calculateAutoColorPositions(itemCount) {
  if (itemCount <= 0) return [];
  if (itemCount === 1) return [6]; // Single item gets "Normal" (green)
  if (itemCount >= 10) {
    // Return all 10 positions
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  }

  // Predefined optimal distributions for 2-7 items
  const predefinedMappings = {
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

  // For 8-9 items, distribute evenly
  const positions = [];
  for (let i = 0; i < itemCount; i++) {
    // Map index to position 1-10
    const position = Math.round(1 + (i * 9) / (itemCount - 1));
    positions.push(position);
  }
  return positions;
}

/**
 * Get contrasting text color (black/white) for a background color
 * Uses relative luminance formula for accessibility
 *
 * @param {string} hexColor - Background color in hex format (#RRGGBB or #RGB)
 * @returns {string} '#000000' for light backgrounds, '#FFFFFF' for dark backgrounds
 */
function getContrastTextColor(hexColor) {
  // Handle both #RGB and #RRGGBB formats
  let hex = hexColor.replace('#', '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  // Parse RGB values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Calculate relative luminance using sRGB coefficients
  // Formula: https://www.w3.org/TR/WCAG20/#relativeluminancedef
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black for light backgrounds, white for dark
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

/**
 * Apply colors to an array of items based on their order
 * Utility function for applying auto-colors to lifecycle stages, priorities, etc.
 *
 * @param {array} items - Array of items with 'order' property
 * @param {boolean} useAutoColors - Whether to auto-assign colors
 * @returns {array} Items with 'colorPosition' and 'colorHex' added
 */
function applyAutoColors(items, useAutoColors = true) {
  if (!items || items.length === 0) return [];

  // Sort by order
  const sorted = [...items].sort((a, b) => (a.order || 0) - (b.order || 0));

  if (!useAutoColors) {
    // Return items with their existing colorPosition, just add hex
    return sorted.map((item) => ({
      ...item,
      colorHex: item.colorPosition ? getColorForPosition(item.colorPosition) : '#616161',
    }));
  }

  // Calculate positions for this count
  const positions = calculateAutoColorPositions(sorted.length);

  // Apply positions to sorted items
  return sorted.map((item, index) => ({
    ...item,
    colorPosition: positions[index],
    colorHex: getColorForPosition(positions[index]),
  }));
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ColorUtils = {
    COLOR_SCALE,
    getColorForPosition,
    getColorEntryForPosition,
    calculateAutoColorPositions,
    getContrastTextColor,
    applyAutoColors,
  };

  // v171a: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['color-utils'] = 'v171a';

  console.log('[color-utils.js] ColorUtils loaded (v171a)');
}

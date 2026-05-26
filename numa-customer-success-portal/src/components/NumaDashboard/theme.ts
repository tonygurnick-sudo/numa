/**
 * Re-export shim. Tokens live in src/styles/theme.ts — the portal-wide
 * source of truth. This file exists so existing `../theme` imports in
 * dashboard tabs keep working without a sweep.
 */
export { ND_COLORS, ND_CHART_PAL, ND_FILL } from '@/styles/theme';

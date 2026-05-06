/**
 * Per-app extractor registry.
 *
 * Adding a new app means appending a row here + writing the extractor file.
 * Everything else (dispatcher dispatch, runner interpolation) is generic.
 */

import { slackExtractor } from './slack';
import type { PipedreamEventExtractor } from './types';

export type { ExtractedEvent, PipedreamEventExtractor } from './types';

const EXTRACTORS: Record<string, PipedreamEventExtractor> = {
  slack: slackExtractor,
};

/**
 * Look up the extractor for a given app slug. Returns undefined for apps that
 * Numa hasn't curated a per-app extractor for — the dispatcher then falls back
 * to a passthrough that surfaces only the raw payload (a usable but minimal
 * `{{ event.raw.* }}` template surface).
 */
export const getExtractorForApp = (appSlug: string): PipedreamEventExtractor | undefined => EXTRACTORS[appSlug];

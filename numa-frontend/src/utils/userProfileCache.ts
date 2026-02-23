/**
 * localStorage cache for user profile metadata (name, profileImage ref, etc.).
 *
 * Implements a stale-while-revalidate pattern: the Nav reads the cached profile
 * instantly on mount, then a background API fetch updates it only when the
 * server version differs.  This eliminates the 2-5 second "User" fallback flash
 * on every page refresh.
 */
import type { UserProfile } from '../Services/ChatSettingsService';
import { getSwrCache, setSwrCache, clearSwrCache } from './swrCache';

const CACHE_NAME = 'userProfile';

/** Read the cached profile from localStorage (returns null if absent/corrupt). */
export function getCachedUserProfile(): UserProfile | null {
  return getSwrCache<UserProfile>(CACHE_NAME);
}

/** Write a profile to the localStorage cache. */
export function setCachedUserProfile(profile: UserProfile): void {
  setSwrCache(CACHE_NAME, profile);
}

/** Clear the cached profile (e.g. on logout). */
export function clearCachedUserProfile(): void {
  clearSwrCache(CACHE_NAME);
}

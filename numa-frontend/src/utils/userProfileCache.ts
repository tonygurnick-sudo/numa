/**
 * localStorage cache for user profile metadata (name, profileImage ref, etc.).
 *
 * Implements a stale-while-revalidate pattern: the Nav reads the cached profile
 * instantly on mount, then a background API fetch updates it only when the
 * server version differs.  This eliminates the 2-5 second "User" fallback flash
 * on every page refresh.
 */
import type { UserProfile } from '../Services/ChatSettingsService';

const STORAGE_KEY = 'numaUserProfileCache';

/** Read the cached profile from localStorage (returns null if absent/corrupt). */
export function getCachedUserProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

/** Write a profile to the localStorage cache. */
export function setCachedUserProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage full or unavailable — non-critical, silently ignore.
  }
}

/** Clear the cached profile (e.g. on logout). */
export function clearCachedUserProfile(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-critical.
  }
}

// FEAT-127 — exposes the signed-in user's persona/industry "audience" and
// helpers to filter resource lists by it. Used by the agents catalogue, the
// in-chat agent picker, the Ops board switcher, and the chat KB picker.
//
// Renders immediately from the cached profile, then refreshes in the
// background. A module-level in-flight promise dedupes the fetch when several
// surfaces mount at once; it is cleared once settled so a later mount (e.g.
// after the user edits their profile) picks up fresh state.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { ChatSettingsService } from '../Services/ChatSettingsService';
import { getCachedUserProfile } from '../utils/userProfileCache';
import {
  EMPTY_AUDIENCE,
  audienceMatches,
  isAudienceActive,
  type AudienceTaggable,
  type ResourceAudience,
} from '../utils/resourceAudience';

let inFlight: Promise<ResourceAudience> | null = null;

function audienceFromProfile(profile: { personas?: string[]; industries?: string[] } | null): ResourceAudience {
  if (!profile) return EMPTY_AUDIENCE;
  return { personas: profile.personas ?? [], industries: profile.industries ?? [] };
}

export function useResourceAudience(): {
  audience: ResourceAudience;
  isFiltering: boolean;
  matches: (resource: AudienceTaggable) => boolean;
  filter: <T extends AudienceTaggable>(list: T[]) => T[];
} {
  const { numaGet } = useNumaRequest();
  const [audience, setAudience] = useState<ResourceAudience>(() => audienceFromProfile(getCachedUserProfile()));

  useEffect(() => {
    let cancelled = false;
    if (!inFlight) {
      inFlight = ChatSettingsService.getUserProfile(numaGet)
        .then((profile) => audienceFromProfile(profile))
        .catch(() => audienceFromProfile(getCachedUserProfile()))
        .finally(() => {
          inFlight = null;
        });
    }
    inFlight.then((next) => {
      if (!cancelled) setAudience(next);
    });
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  const isFiltering = useMemo(() => isAudienceActive(audience), [audience]);

  const matches = useCallback((resource: AudienceTaggable) => audienceMatches(resource, audience), [audience]);

  const filter = useCallback(
    <T extends AudienceTaggable>(list: T[]): T[] =>
      isFiltering ? list.filter((resource) => audienceMatches(resource, audience)) : list,
    [audience, isFiltering]
  );

  return { audience, isFiltering, matches, filter };
}

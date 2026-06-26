import { describe, it, expect, beforeEach } from 'vitest';
import { getFlag } from '../../utils/featureFlags';

describe('getFlag', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  // BUG-393: restricted features (Voice) must FAIL CLOSED. The permissive default
  // used to leak Voice during the async config.json load window (and visibly on a
  // V2.3 rollout). These must resolve to hidden until DEPLOY_<flag> === 'true'.
  describe('hidden-by-default (fail-closed) flags', () => {
    it('hides NUMA_VOICE while the flag has not loaded yet (absent → false)', () => {
      expect(getFlag('NUMA_VOICE')).toBe(false);
    });

    it('hides NUMA_VOICE when explicitly disabled for the client', () => {
      window.sessionStorage.setItem('DEPLOY_NUMA_VOICE', 'false');
      expect(getFlag('NUMA_VOICE')).toBe(false);
    });

    it('shows NUMA_VOICE only when DEPLOY_NUMA_VOICE is explicitly "true"', () => {
      window.sessionStorage.setItem('DEPLOY_NUMA_VOICE', 'true');
      expect(getFlag('NUMA_VOICE')).toBe(true);
    });

    it('respects the admin toggle for a voice-enabled tenant', () => {
      window.sessionStorage.setItem('DEPLOY_NUMA_VOICE', 'true');
      window.sessionStorage.setItem('NUMA_VOICE', 'false');
      expect(getFlag('NUMA_VOICE')).toBe(false);
    });

    it('also fails closed for VOICE_ANALYTICS when absent', () => {
      expect(getFlag('VOICE_ANALYTICS')).toBe(false);
    });
  });

  describe('normal (permissive-default) flags', () => {
    it('defaults an absent flag to true', () => {
      expect(getFlag('NUMA_OPS')).toBe(true);
    });

    it('hard-denies when DEPLOY_<flag> is false', () => {
      window.sessionStorage.setItem('DEPLOY_NUMA_OPS', 'false');
      expect(getFlag('NUMA_OPS')).toBe(false);
    });

    it('honours an admin toggle-off', () => {
      window.sessionStorage.setItem('DEPLOY_NUMA_OPS', 'true');
      window.sessionStorage.setItem('NUMA_OPS', 'false');
      expect(getFlag('NUMA_OPS')).toBe(false);
    });
  });
});

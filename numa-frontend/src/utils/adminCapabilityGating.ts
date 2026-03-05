/**
 * Admin Capability Gating — sessionStorage bridge
 *
 * After authentication, this utility fetches admin capability overrides from
 * the dedicated capabilities DynamoDB table and applies them to sessionStorage:
 *
 *   effective = deployment_flag AND admin_toggle
 *
 * Deployment flags (DEPLOY_<FLAG>) are written by ConfigSetup.tsx when it
 * processes boolean properties from config.json.  This module only reads them.
 *
 * It overwrites the live <FLAG> key to 'false' when an admin has disabled the
 * capability, then dispatches a 'numa-capabilities-changed' event so Nav.tsx
 * can re-render without a full page reload.
 */

import { CapabilitiesService } from '../Services/CapabilitiesService';

export const CAPABILITIES_CHANGED_EVENT = 'numa-capabilities-changed';

/**
 * Fetch admin capability overrides and apply gating to sessionStorage.
 *
 * For each entry in the capabilities table:
 *   - If admin has set status = 'disabled', overwrite the live flag to 'false'
 *   - If admin has set status = 'enabled', restore the live flag to 'true'
 *   - Hard deploy denials (DEPLOY_FLAG = 'false') are never overridden
 *
 * @param numaGet — authenticated GET function from NumaRequestContext
 */
export async function loadAdminCapabilityGating(
  numaGet: (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>
): Promise<void> {
  try {
    const settings = await CapabilitiesService.list(numaGet);

    for (const [flagName, setting] of Object.entries(settings)) {
      const deployValue = sessionStorage.getItem(`DEPLOY_${flagName}`);

      // Hard deploy denial — admin cannot override
      if (deployValue === 'false') continue;

      if (setting.status === 'disabled') {
        sessionStorage.setItem(flagName, 'false');
      } else if (setting.status === 'enabled') {
        sessionStorage.setItem(flagName, 'true');
      }
    }

    sessionStorage.setItem('ADMIN_CAPABILITIES_LOADED', 'true');
  } catch (err) {
    console.warn('[AdminCapabilityGating] Failed to load capabilities, using deployment flags:', err);
  }

  // Always dispatch event so Nav re-renders (even on error — deployment flags are fine)
  window.dispatchEvent(new CustomEvent(CAPABILITIES_CHANGED_EVENT));
}

/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { FocusCallCard } from '../../../Components/Voice/FocusCallCard';
import type { Prospect } from '../../../types/voice';

// FocusCallCard statically imports PostCallWrapUpPanel (rendered at phase 'acw'),
// which calls useAuth() at render — mock it so the import chain is render-safe.
vi.mock('../../../Providers/AuthProvider', () => ({
  useAuth: () => ({ getCredentials: vi.fn().mockResolvedValue(null) }),
}));

const prospect: Prospect = {
  company_name: 'Arcanum',
  contact_name: 'Nathan',
  contact_title: '',
  phone: '+61422946076',
  industry: 'general',
  company_description: '',
  pain_hypothesis: '',
};

describe('FocusCallCard — resilience to a missing prospect', () => {
  // Regression: a call-lifecycle event (connecting/connected) used to arrive
  // without prospect context, FocusCallCard did `const p = prospect as Prospect`
  // then read `p.phone`, threw, and the whole focus card VANISHED mid-call.
  it('does not throw when a non-idle phase arrives with no prospect', () => {
    for (const phase of ['connecting', 'connected'] as const) {
      expect(() => render(<FocusCallCard phase={phase} prospect={undefined} />)).not.toThrow();
    }
  });

  it('falls back to the calm "all done" state (not an empty/crashed card) when prospect is missing', () => {
    const { container } = render(<FocusCallCard phase="connected" prospect={undefined} />);
    // The all-done state renders a check-circle icon — i18n-independent assertion.
    expect(container.querySelector('.bi-check-circle-fill')).toBeTruthy();
  });

  it('renders the dial CTA when a prospect is present (idle prep)', () => {
    const { container } = render(<FocusCallCard phase="idle" prospect={prospect} />);
    expect(container.querySelector('.bi-telephone-outbound-fill')).toBeTruthy();
  });
});

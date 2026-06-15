/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { FocusCallCard } from '../../../Components/Voice/FocusCallCard';
import { VOICE_CCP_STATUS_EVENT } from '../../../hooks/useConnectCcp';
import type { CcpStatus } from '../../../hooks/useConnectCcp';
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

  it('shows "all done" only when genuinely idle with no prospect', () => {
    const { container } = render(<FocusCallCard phase="idle" prospect={undefined} />);
    // The all-done celebration renders a check-circle icon — i18n-independent.
    expect(container.querySelector('.bi-check-circle-fill')).toBeTruthy();
  });

  it('shows a neutral "call in progress" (NOT the all-done celebration) during a live call with no prospect', () => {
    const { container } = render(<FocusCallCard phase="connected" prospect={undefined} />);
    // Must not lie that the day is done while a call is connected.
    expect(container.querySelector('.bi-check-circle-fill')).toBeFalsy();
    expect(container.querySelector('.bi-telephone-fill')).toBeTruthy();
  });

  it('renders the dial CTA when a prospect is present (idle prep)', () => {
    const { container } = render(<FocusCallCard phase="idle" prospect={prospect} />);
    expect(container.querySelector('.bi-telephone-outbound-fill')).toBeTruthy();
  });
});

function setCcpStatus(status: CcpStatus): void {
  act(() => {
    window.dispatchEvent(new CustomEvent(VOICE_CCP_STATUS_EVENT, { detail: { status } }));
  });
}

describe('FocusCallCard — softphone-status-aware CTA (review [5])', () => {
  it('disables dial and says "connect your phone first" when the softphone needs login', () => {
    const { container, getByText } = render(<FocusCallCard phase="idle" prospect={prospect} />);
    setCcpStatus('needs_login');
    expect(container.querySelector('button')).toBeDisabled();
    expect(getByText(/connect your phone first/i)).toBeInTheDocument();
  });

  it('shows "softphone is ready" and enables dial only when status is ready', () => {
    const { container, getByText } = render(<FocusCallCard phase="idle" prospect={prospect} />);
    setCcpStatus('ready');
    expect(container.querySelector('button')).not.toBeDisabled();
    expect(getByText(/softphone is ready|ready/i)).toBeInTheDocument();
  });

  it('does not falsely claim ready before any status signal (shows connecting)', () => {
    const { getByText } = render(<FocusCallCard phase="idle" prospect={prospect} />);
    expect(getByText(/connecting your phone/i)).toBeInTheDocument();
  });
});

describe('FocusCallCard — wrap-up panel seeded from props at ACW (review [3])', () => {
  it('renders the wrap-up form at phase=acw using the contactId prop (not the missed event)', () => {
    const { getByRole } = render(
      <FocusCallCard phase="acw" prospect={prospect} contactId="contact-xyz" durationSeconds={42} />
    );
    // The wrap-up form's outcome buttons prove the panel seeded itself from props
    // — without the prop path it would render null (the bug this guards).
    expect(getByRole('button', { name: 'Interested' })).toBeInTheDocument();
  });
});

/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import PostCallWrapUpPanel from '../../../Components/Voice/PostCallWrapUpPanel';

// getCredentials is never reached in these tests (no submit), but the component
// calls useAuth() at render, so it must be mocked.
vi.mock('../../../Providers/AuthProvider', () => ({
  useAuth: () => ({ getCredentials: vi.fn().mockResolvedValue(null) }),
}));

/** Fire the softphone's call-lifecycle event the panel listens for. */
function fireAcw(detail: Record<string, unknown>): void {
  act(() => {
    window.dispatchEvent(new CustomEvent('numa-voice-contact', { detail }));
  });
}

describe('PostCallWrapUpPanel — prospect_phone guard', () => {
  it('renders nothing until a call enters ACW', () => {
    const { container } = render(<PostCallWrapUpPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('warns (cannot save) when the ACW call has no prospect phone', () => {
    render(<PostCallWrapUpPanel />);
    fireAcw({ phase: 'acw', contactId: 'c1', prospect: { company_name: 'Kauri', industry: 'Healthcare' } });
    // prospect_phone is the join key — without it the outcome is unmatchable.
    expect(screen.getByText(/cannot be matched to a prospect/i)).toBeInTheDocument();
  });

  it('does not warn when the prospect has a phone', () => {
    render(<PostCallWrapUpPanel />);
    fireAcw({
      phase: 'acw',
      contactId: 'c2',
      prospect: { company_name: 'Kauri', phone: '+6421677460', industry: 'Healthcare' },
    });
    expect(screen.queryByText(/cannot be matched to a prospect/i)).not.toBeInTheDocument();
  });
});

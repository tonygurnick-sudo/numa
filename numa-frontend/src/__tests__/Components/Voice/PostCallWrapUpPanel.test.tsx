/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
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

  it('warns (cannot save) when the ACW call has no prospect phone — after an outcome is picked', () => {
    render(<PostCallWrapUpPanel />);
    fireAcw({ phase: 'acw', contactId: 'c1', prospect: { company_name: 'Kauri', industry: 'Healthcare' } });
    // The no-phone note is now advisory and only surfaces once the SDR picks an
    // outcome (i.e. is about to try to save) — softer than the previous always-on
    // yellow Alert. prospect_phone is still the join key, so submit stays blocked.
    expect(screen.queryByText(/cannot be matched to a prospect/i)).not.toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Interested' }));
    });
    expect(screen.getByText(/cannot be matched to a prospect/i)).toBeInTheDocument();
  });

  it('does not warn when the prospect has a phone', () => {
    render(<PostCallWrapUpPanel />);
    fireAcw({
      phase: 'acw',
      contactId: 'c2',
      prospect: { company_name: 'Kauri', phone: '+6421677460', industry: 'Healthcare' },
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Interested' }));
    });
    expect(screen.queryByText(/cannot be matched to a prospect/i)).not.toBeInTheDocument();
  });
});

describe('PostCallWrapUpPanel — dismiss nudge (unsaved outcome)', () => {
  it('asks for confirmation before closing an unsaved wrap-up, and keeps the form on "Keep logging"', () => {
    const onDismissed = vi.fn();
    render(<PostCallWrapUpPanel onDismissed={onDismissed} />);
    fireAcw({
      phase: 'acw',
      contactId: 'c4',
      prospect: { company_name: 'Kauri', phone: '+6421677460', industry: 'Healthcare' },
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    });
    // First click does NOT dismiss — it surfaces the inline confirm.
    expect(onDismissed).not.toHaveBeenCalled();
    expect(screen.getByText(/no outcome has been logged/i)).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /keep logging/i }));
    });
    expect(screen.queryByText(/no outcome has been logged/i)).not.toBeInTheDocument();
    expect(onDismissed).not.toHaveBeenCalled();
    // Form is still alive.
    expect(screen.getByRole('button', { name: 'Interested' })).toBeInTheDocument();
  });

  it('dismisses (and informs the page) when the SDR confirms closing without logging', () => {
    const onDismissed = vi.fn();
    render(<PostCallWrapUpPanel onDismissed={onDismissed} />);
    fireAcw({
      phase: 'acw',
      contactId: 'c5',
      prospect: { company_name: 'Kauri', phone: '+6421677460', industry: 'Healthcare' },
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /close without logging/i }));
    });
    expect(onDismissed).toHaveBeenCalledTimes(1);
  });
});

describe('PostCallWrapUpPanel — recording-consent attestation (audit)', () => {
  it('shows a recording-disclosure attestation, checked by default, that can be toggled', () => {
    render(<PostCallWrapUpPanel />);
    fireAcw({
      phase: 'acw',
      contactId: 'c3',
      prospect: { company_name: 'Kauri', phone: '+6421677460', industry: 'Healthcare' },
    });
    const checkbox = screen.getByRole('checkbox', { name: /told the prospect this call was being recorded/i });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toBeChecked();
    act(() => {
      fireEvent.click(checkbox);
    });
    expect(checkbox).not.toBeChecked();
  });
});

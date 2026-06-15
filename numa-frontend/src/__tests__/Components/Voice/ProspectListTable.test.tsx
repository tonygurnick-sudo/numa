/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { ProspectListTable } from '../../../Components/Voice/ProspectListTable';
import { VOICE_CALL_STATE_EVENT } from '../../../hooks/useConnectCcp';
import type { Prospect } from '../../../types/voice';

const base: Prospect = {
  company_name: 'Arcanum',
  contact_name: 'Nathan',
  contact_title: 'CTO',
  phone: '+61422946076',
  industry: 'general',
  company_description: '',
  pain_hypothesis: '',
};

/** A called prospect carrying the FEAT-165 structured post-call outputs. */
const calledWithDetail: Prospect = {
  ...base,
  call_outcome: 'interested',
  call_summary: 'Strong call — prospect wants a pilot next quarter.',
  objections: ['Already using a competitor', 'Budget locked until Q3'],
  next_steps: ['Send pilot proposal'],
  call_quality_rating: 4,
  call_quality_justification: 'Clear next step agreed.',
  follow_up_talking_points: ['ROI case study', 'Integration timeline'],
};

describe('ProspectListTable — structured post-call detail (FEAT-165)', () => {
  it('shows a call-notes disclosure on a called row that has structured detail', () => {
    const { container } = render(<ProspectListTable prospects={[calledWithDetail]} filter="done" />);
    // The disclosure is keyed by the journal icon (i18n-independent).
    expect(container.querySelector('.bi-journal-text')).toBeTruthy();
    // Summary + a structured bullet are rendered (collapsed children stay mounted).
    expect(screen.getByText('Strong call — prospect wants a pilot next quarter.')).toBeInTheDocument();
    expect(screen.getByText('Already using a competitor')).toBeInTheDocument();
    expect(screen.getByText('Send pilot proposal')).toBeInTheDocument();
    expect(screen.getByText('ROI case study')).toBeInTheDocument();
    // Rating renders as 4 filled stars out of 5.
    expect(container.querySelectorAll('.bi-star-fill').length).toBeGreaterThanOrEqual(4);
  });

  it('toggles aria-expanded when the disclosure is clicked', () => {
    const { container } = render(<ProspectListTable prospects={[calledWithDetail]} filter="done" />);
    const toggle = container.querySelector('.bi-journal-text')?.closest('button');
    expect(toggle).toBeTruthy();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle as HTMLButtonElement);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('does NOT show a disclosure when a called row has no structured detail', () => {
    const calledNoDetail: Prospect = { ...base, call_outcome: 'no_answer' };
    const { container } = render(<ProspectListTable prospects={[calledNoDetail]} filter="done" />);
    expect(container.querySelector('.bi-journal-text')).toBeNull();
  });

  it('does NOT show a disclosure on an un-called queue row', () => {
    const { container } = render(<ProspectListTable prospects={[base]} filter="todo" />);
    expect(container.querySelector('.bi-journal-text')).toBeNull();
  });

  // Bug A: a Done prospect must never get stuck showing "On call" / a green dial
  // button, even if a stray 'connected' CCP event arrives for its phone (a missed
  // idle event). The data invariant (call_outcome ⇒ not on call) is the backstop.
  it('never enters the on-call state on a Done prospect even as the active prospect with a connected page phase', () => {
    // Force the worst case the invariant guards: this Done prospect is BOTH the page's
    // active prospect AND the page phase is stuck 'connected' (a missed CCP idle). The
    // activePhone self-heal doesn't touch this clause — only the call_outcome invariant
    // suppresses it. Also fire a stray connected event for its phone for good measure.
    const { container } = render(
      <ProspectListTable
        prospects={[calledWithDetail]}
        activeProspect={calledWithDetail}
        phase="connected"
        filter="done"
      />
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent(VOICE_CALL_STATE_EVENT, {
          detail: { state: 'connected', phone: calledWithDetail.phone },
        })
      );
    });
    // A Done row must never render ANY on-call affordance: not the success-variant Dial
    // button (keyed off isOnCall), and not the "On call" pill or green active-edge (keyed
    // off isActiveProspect — the path that regressed once because it bypassed the invariant).
    expect(container.querySelector('.btn-success')).toBeNull();
    expect(container.querySelector('.bi-record-circle-fill')).toBeNull(); // "On call" pill icon
    expect(container.querySelector('.border-success')).toBeNull(); // green active-edge
  });
});

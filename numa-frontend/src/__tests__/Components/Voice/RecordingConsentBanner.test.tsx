/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { RecordingConsentBanner } from '../../../Components/Voice/RecordingConsentBanner';

describe('RecordingConsentBanner', () => {
  it('renders a persistent recording-disclosure notice', () => {
    render(<RecordingConsentBanner />);
    expect(screen.getByText(/Calls are recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/tell the prospect the call is being recorded/i)).toBeInTheDocument();
  });
});

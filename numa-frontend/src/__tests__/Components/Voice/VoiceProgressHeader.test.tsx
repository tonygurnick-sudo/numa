/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { VoiceProgressHeader } from '../../../Components/Voice/VoiceProgressHeader';
import { isListStale } from '../../../utils/voiceFormat';

// The header embeds ProspectUploadButton, which reads useAuth() at render.
vi.mock('../../../Providers/AuthProvider', () => ({
  useAuth: () => ({ getCredentials: vi.fn().mockResolvedValue(null) }),
}));

const COUNTS = { total: 10, done: 3, interested: 1, callback: 1, qualified: 1 };

function renderHeader(listGeneratedAt?: string): void {
  render(
    <MemoryRouter>
      <VoiceProgressHeader
        counts={COUNTS}
        onRefresh={vi.fn()}
        refreshing={false}
        isAdmin={false}
        filter="all"
        onFilterChange={vi.fn()}
        listGeneratedAt={listGeneratedAt}
      />
    </MemoryRouter>
  );
}

describe('isListStale — FEAT-164 freshness', () => {
  const now = new Date(2026, 5, 10, 9, 0, 0); // local 2026-06-10 09:00

  it('is fresh when generated earlier the same local day', () => {
    expect(isListStale(new Date(2026, 5, 10, 7, 30).toISOString(), now)).toBe(false);
  });

  it('is stale when generated yesterday', () => {
    expect(isListStale(new Date(2026, 5, 9, 7, 30).toISOString(), now)).toBe(true);
  });

  it('is not stale (no chip at all) when missing or unparseable', () => {
    expect(isListStale(undefined, now)).toBe(false);
    expect(isListStale('not-a-date', now)).toBe(false);
  });
});

describe('VoiceProgressHeader — list freshness chip', () => {
  it('shows the prepared-time chip for a fresh list', () => {
    renderHeader(new Date().toISOString());
    expect(screen.getByText(/list prepared/i)).toBeInTheDocument();
  });

  it('warns when the list was generated before today', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    renderHeader(yesterday);
    expect(screen.getByText(/has not been prepared yet/i)).toBeInTheDocument();
  });

  it('renders no chip when today_calls.json carries no generated_at', () => {
    renderHeader(undefined);
    expect(screen.queryByText(/list prepared/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/has not been prepared yet/i)).not.toBeInTheDocument();
  });
});

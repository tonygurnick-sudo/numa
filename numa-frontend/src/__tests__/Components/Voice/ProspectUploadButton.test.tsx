/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { ProspectUploadButton } from '../../../Components/Voice/ProspectUploadButton';

const uploadMock = vi.fn();
vi.mock('../../../Services/voiceData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../Services/voiceData')>();
  return {
    ...actual,
    uploadProspectSpreadsheet: (...args: unknown[]) => uploadMock(...args),
  };
});

vi.mock('../../../Providers/AuthProvider', () => ({
  useAuth: () => ({ getCredentials: vi.fn().mockResolvedValue({ accessKeyId: 'a', secretAccessKey: 'b' }) }),
}));

function pickFile(name: string): void {
  const input = screen.getByTestId('prospect-upload-input');
  const file = new File(['x'], name, { type: 'application/octet-stream' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ProspectUploadButton (FEAT-167 intake upload)', () => {
  beforeEach(() => {
    uploadMock.mockReset();
    window.sessionStorage.setItem('VOICE_INTAKE_BUCKET', 'numa-test-prospect-intake');
  });

  it('renders nothing when no intake bucket is configured (voice off / old deploy)', () => {
    window.sessionStorage.removeItem('VOICE_INTAKE_BUCKET');
    const { container } = render(<ProspectUploadButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uploads a spreadsheet and confirms that ingest will follow', async () => {
    uploadMock.mockResolvedValue(undefined);
    render(<ProspectUploadButton />);
    pickFile('prospects.xlsx');
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/prospects will appear after ingest/i)).toBeInTheDocument();
  });

  it('rejects non-spreadsheet files client-side without calling S3', async () => {
    render(<ProspectUploadButton />);
    pickFile('prospects.csv');
    expect(await screen.findByText(/only .* files can be ingested/i)).toBeInTheDocument();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('shows a retryable error when the upload fails', async () => {
    uploadMock.mockRejectedValue(new Error('boom'));
    render(<ProspectUploadButton />);
    pickFile('prospects.xls');
    expect(await screen.findByText(/upload failed/i)).toBeInTheDocument();
  });
});

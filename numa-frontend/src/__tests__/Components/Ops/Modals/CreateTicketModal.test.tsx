/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { CreateTicketModal } from '../../../../Components/Ops/Modals/CreateTicketModal';
import { useAuth } from '../../../../Providers/AuthProvider';
import { useOps } from '../../../../Components/Ops/OpsContext';

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../../Providers/NumaRequestContext', () => ({
  useNumaRequest: () => ({ numaPost: vi.fn(), numaGet: vi.fn() }),
}));
vi.mock('../../../../Components/Ops/OpsContext', () => ({
  useOps: vi.fn(),
}));
vi.mock('../../../../Providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../../../../Providers/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('../../../../Services/OpsService', () => ({
  listCustomers: vi.fn().mockResolvedValue([]),
  listSuppliers: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../../Components/Ops/Shared/RichTextEditor', () => ({
  RichTextEditor: () => <div data-testid="rich-text-editor"></div>,
}));
vi.mock('../../../../Components/Ops/Shared/DynamicField', () => ({
  DynamicField: () => <div data-testid="dynamic-field"></div>,
}));

describe('CreateTicketModal (FEAT-108 validation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const mockConfig = {
      staff: [
        { id: 'user-sub-123', name: 'Frontend Dev', email: 'dev@test.com', isActive: true },
        { id: 'other-user', name: 'Other User', email: 'other@test.com', isActive: true },
      ],
      ticketTypes: [
        {
          id: 'tt-1',
          name: 'Bug',
          prefix: 'BUG',
          color: '#ff0000',
          icon: 'bug',
          // Post-FEAT-171 the sidebar is driven entirely by the ticket type's
          // defaultFields list — the reporter row only renders when it's in
          // here (or in the board's addedFields snapshot).
          defaultFields: ['field-reporter'],
          order: 1,
        },
      ],
      fields: [
        {
          id: 'field-reporter',
          name: 'Reporter',
          fieldType: 'user',
          category: 'Common',
          isSystem: true,
          order: 1,
        },
      ],
      projects: [],
    };

    const mockBoardData = {
      board: {
        id: 'board-1',
        allowedTicketTypes: ['tt-1'],
        preset: 'software',
      },
      stages: [],
      zones: [],
    };

    (useOps as any).mockReturnValue({
      config: mockConfig,
      boardData: mockBoardData,
      workUnits: [],
      refreshTickets: vi.fn(),
      refreshCrmData: vi.fn(),
    });

    (useAuth as any).mockReturnValue({
      user: {
        decoded_tokens: {
          idToken: {
            sub: 'user-sub-123',
          },
        },
      },
    });
  });

  it('verifies field-reporter defaults to the authenticated user ID (FEAT-108)', async () => {
    // Mount the modal in a hidden state first (which triggers the form reset and populates default fields)
    const { rerender } = render(<CreateTicketModal show={false} onHide={vi.fn()} onSuccess={vi.fn()} />);

    // Rerender it exactly as it would open in the real app
    rerender(<CreateTicketModal show={true} onHide={vi.fn()} onSuccess={vi.fn()} />);

    // First screen is "Type Selection", we must click a type to see the modal body
    const typeButton = screen.getByText('Bug');
    typeButton.click();

    // Now the modal opens to Phase 2 (the full form).
    // Reporter uses a SidebarDropdown (custom component with buttons, not native <select>).
    // The trigger button renders a StaffAvatar + name for the selected reporter.
    // Verify the authenticated user's name appears as the reporter value.
    const reporterName = await screen.findByText('Frontend Dev');
    expect(reporterName).toBeInTheDocument();
  });
});

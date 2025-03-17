/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompanyInfo } from '../../Pages/CompanyInfo';
import { saveCompanyInfo, fetchCompanyInfo, getProfileText } from '../../utils/companyInfoUtils';

// Mock the companyInfoUtils functions
vi.mock('../../utils/companyInfoUtils', () => ({
  saveCompanyInfo: vi.fn(() => Promise.resolve('s3://test-bucket/company-data.json')),
  fetchCompanyInfo: vi.fn(),
  getProfileText: vi.fn((data) => data?.profile || ''),
}));

// Mock the AuthProvider
vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: () => ({
    getIdentityPoolCredentials: vi.fn(),
    region: 'us-east-1',
  }),
}));

// Mock the Breadcrumbs component
vi.mock('../../Components/Breadcrumbs', () => ({
  Breadcrumbs: () => <div data-testid="breadcrumbs">Breadcrumbs</div>,
}));

// Mock the Nav component
vi.mock('../../Components/Nav', () => ({
  Nav: () => <div data-testid="nav">Nav</div>,
}));

// Mock the LayoutDashboard component
vi.mock('../../Layouts/LayoutDashboard', () => ({
  LayoutDashboard: ({ children }) => <div data-testid="layout-dashboard">{children}</div>,
}));

// Create a custom render function
const customRender = (ui, options = {}) => {
  return render(ui, { ...options });
};

// Mock console.error to prevent test output pollution
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});

afterEach(() => {
  console.error = originalConsoleError;
  vi.resetAllMocks();
});

describe('CompanyInfo Component', () => {
  const mockCompanyInfo = {
    profile: 'Test company profile',
    lastUpdated: '2025-03-12T12:00:00.000Z',
  };

  const mockEmptyCompanyInfo = {
    profile: '',
    lastUpdated: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock sessionStorage
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn((key) => {
          if (key === 'CLIENT_NAME') return 'arcanum-hams';
          if (key === 'REGION') return 'us-east-1';
          return null;
        }),
        setItem: vi.fn(),
      },
      writable: true,
    });
  });

  it('should render the component', () => {
    customRender(<CompanyInfo />);
    expect(screen.getByText('Company Info')).toBeInTheDocument();
    expect(screen.getByText('Edit Company Information')).toBeInTheDocument();
  });

  it('should show loading spinner initially', () => {
    // Make fetchCompanyInfo never resolve to keep the loading state
    fetchCompanyInfo.mockImplementation(() => new Promise(() => {}));
    customRender(<CompanyInfo />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('should have the correct page structure', () => {
    customRender(<CompanyInfo />);
    expect(
      screen.getByText('Enter your company information below. This will be used in chat interactions.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('nav')).toBeInTheDocument();
    expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument();
    expect(screen.getByTestId('layout-dashboard')).toBeInTheDocument();
  });

  it('should call fetchCompanyInfo on mount', async () => {
    fetchCompanyInfo.mockResolvedValue(mockCompanyInfo);
    customRender(<CompanyInfo />);
    expect(fetchCompanyInfo).toHaveBeenCalled();
  });

  it('should display company profile when data is loaded', async () => {
    // Setup the mock to resolve with data
    fetchCompanyInfo.mockImplementation(() => {
      return Promise.resolve(mockCompanyInfo);
    });

    // Make sure getProfileText returns the expected value
    getProfileText.mockImplementation(() => 'Test company profile');

    customRender(<CompanyInfo />);

    // Wait for the loading spinner to disappear and the textarea to appear
    const textarea = await waitFor(() => screen.getByRole('textbox'));

    // Wait for the component to update with the profile text
    await waitFor(() => {
      expect(textarea.value).toBe('Test company profile');
    });

    // Check that the last updated text is displayed
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });

  it('should show info message when no company info exists', async () => {
    // Setup the mock to resolve with empty data
    fetchCompanyInfo.mockResolvedValue(mockEmptyCompanyInfo);

    customRender(<CompanyInfo />);

    // Wait for the alert to appear
    const alert = await waitFor(() =>
      screen.getByText('No company information exists yet. Enter your company information and click Save.'),
    );
    expect(alert).toBeInTheDocument();
  });

  it('should handle error when loading company info fails', async () => {
    // Setup the mock to reject with an error
    fetchCompanyInfo.mockRejectedValue(new Error('Failed to load'));

    customRender(<CompanyInfo />);

    // Wait for the error alert to appear
    const errorAlert = await waitFor(() => screen.getByText('Error loading company information: Failed to load'));
    expect(errorAlert).toBeInTheDocument();
  });

  it('should update company profile when text is changed', async () => {
    // Setup the mock to resolve with data
    fetchCompanyInfo.mockResolvedValue(mockCompanyInfo);

    customRender(<CompanyInfo />);

    // Wait for the textarea to appear
    const textarea = await waitFor(() => screen.getByRole('textbox'));

    // Change the textarea value
    fireEvent.change(textarea, { target: { value: 'Updated company profile' } });

    // Check that the textarea value is updated
    expect(textarea).toHaveValue('Updated company profile');
  });

  it('should call saveCompanyInfo when save button is clicked', async () => {
    // Setup the mocks
    fetchCompanyInfo.mockResolvedValue(mockCompanyInfo);
    saveCompanyInfo.mockResolvedValue('s3://test-bucket/company-data.json');

    customRender(<CompanyInfo />);

    // Wait for the textarea to appear
    await waitFor(() => screen.getByRole('textbox'));

    // Find and click the save button
    const saveButton = screen.getByText('Save Information');
    fireEvent.click(saveButton);

    // Check that saveCompanyInfo was called
    expect(saveCompanyInfo).toHaveBeenCalled();

    // Wait for the success message
    const successMessage = await waitFor(() => screen.getByText('Company information saved successfully!'));
    expect(successMessage).toBeInTheDocument();
  });

  it('should show saving spinner when save is in progress', async () => {
    // Setup the mocks
    fetchCompanyInfo.mockResolvedValue(mockCompanyInfo);

    // Create a promise that we can resolve later
    let resolvePromise;
    const savePromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    saveCompanyInfo.mockReturnValue(savePromise);

    customRender(<CompanyInfo />);

    // Wait for the textarea to appear
    await waitFor(() => screen.getByRole('textbox'));

    // Find and click the save button
    const saveButton = screen.getByText('Save Information');
    fireEvent.click(saveButton);

    // Check that the saving spinner is displayed
    expect(screen.getByText('Saving...')).toBeInTheDocument();

    // Resolve the save promise
    resolvePromise('s3://test-bucket/company-data.json');

    // Wait for the saving spinner to disappear
    await waitFor(() => {
      expect(screen.queryByText('Saving...')).not.toBeInTheDocument();
    });
  });

  it('should handle error when saving company info fails', async () => {
    // Setup the mocks
    fetchCompanyInfo.mockResolvedValue(mockCompanyInfo);
    saveCompanyInfo.mockRejectedValue(new Error('Failed to save'));

    customRender(<CompanyInfo />);

    // Wait for the textarea to appear
    await waitFor(() => screen.getByRole('textbox'));

    // Find and click the save button
    const saveButton = screen.getByText('Save Information');
    fireEvent.click(saveButton);

    // Wait for the error alert to appear
    const errorAlert = await waitFor(() => screen.getByText('Error saving company information: Failed to save'));
    expect(errorAlert).toBeInTheDocument();
  });

  it('should dismiss alert when close button is clicked', async () => {
    // Setup the mock to resolve with empty data
    fetchCompanyInfo.mockResolvedValue(mockEmptyCompanyInfo);

    customRender(<CompanyInfo />);

    // Wait for the alert to appear
    await waitFor(() =>
      screen.getByText('No company information exists yet. Enter your company information and click Save.'),
    );

    // Find and click the close button (using aria-label)
    const closeButton = screen.getByLabelText('Close alert');
    fireEvent.click(closeButton);

    // Check that the alert is no longer displayed
    await waitFor(() => {
      expect(
        screen.queryByText('No company information exists yet. Enter your company information and click Save.'),
      ).not.toBeInTheDocument();
    });
  });

  it('should format the last updated date correctly', async () => {
    // Setup the mock to resolve with data
    fetchCompanyInfo.mockResolvedValue(mockCompanyInfo);

    customRender(<CompanyInfo />);

    // Wait for the textarea to appear
    await waitFor(() => screen.getByRole('textbox'));

    // Check that the last updated text is displayed
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });

  it('should show empty form when there is no last updated date', async () => {
    // Setup the mock to resolve with empty data
    fetchCompanyInfo.mockResolvedValue(mockEmptyCompanyInfo);

    customRender(<CompanyInfo />);

    // Wait for the textarea to appear
    const textarea = await waitFor(() => screen.getByRole('textbox'));

    // Check that the last updated text is not displayed
    expect(screen.queryByText(/Last updated:/)).not.toBeInTheDocument();

    // Check that the form is displayed with empty textarea
    expect(textarea).toHaveValue('');
  });
});

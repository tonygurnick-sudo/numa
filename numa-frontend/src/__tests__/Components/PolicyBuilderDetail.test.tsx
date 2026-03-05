/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../Mocks/ProviderWrapper';
import { PolicyBuilderDetail } from '../../Components/Policy/PolicyBuilderDetail';
import axios from 'axios';

// Mock axios directly
vi.mock('axios');

describe('PolicyBuilderDetail Component', () => {
  // Mock the AWS SDK modules
  vi.mock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({}),
    })),
    GetObjectCommand: vi.fn(),
  }));

  vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: vi.fn().mockResolvedValue('https://example.com/signed-url'),
  }));

  // Default auth context values
  const authContextValues = {
    loading: false,
    isAuthenticated: true,
    getCredentials: vi.fn().mockResolvedValue({
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    }),
  };

  // Default numa request context values
  const numaRequestContextValues = {
    numaPost: vi.fn().mockResolvedValue({ jobId: 'test-job-id' }),
    numaPut: vi.fn().mockResolvedValue({}),
    numaGet: vi.fn().mockResolvedValue({
      items: [
        {
          jobId: 'test-job-id',
          type: 'POLICY_GENERATION',
          status: 'SUCCESS',
          dateTime: '2023-01-01T12:00:00Z',
          inputs: {
            schoolName: 'Test School',
          },
          stepFunctionJobId: 'test-step-function-id',
        },
      ],
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.innerWidth = 1024; // Default to desktop view

    // Mock global fetch for config.json
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url === '/config.json') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              API_ENDPOINT: 'https://api.example.com',
              CLIENT_NAME: 'test-client',
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled fetch request: ${url}`));
    });

    // Mock axios get method
    axios.get.mockImplementation((url) => {
      if (url.includes('/policy-builder/jobs')) {
        return Promise.resolve({
          data: {
            items: [
              {
                jobId: 'test-job-id',
                type: 'POLICY_GENERATION',
                status: 'SUCCESS',
                dateTime: '2023-01-01T12:00:00Z',
                inputs: {
                  schoolName: 'Test School',
                },
                stepFunctionJobId: 'test-step-function-id',
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    // Mock other axios methods if needed
    axios.post.mockResolvedValue({ data: {} });
    axios.put.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    global.fetch.mockRestore();
  });

  it('should render the component with policies tab active', async () => {
    renderWithProviders(<PolicyBuilderDetail />, {
      authContext: authContextValues,
      numaRequestContext: numaRequestContextValues,
    });

    await waitFor(() => {
      expect(screen.getByText('School Policies')).toBeInTheDocument();
      expect(screen.getByText('Create New Policy')).toBeInTheDocument();
    });

    // Policies tab should be active by default
    const policiesTab = screen.getByRole('tab', { name: /School Policies/i });
    expect(policiesTab).toHaveAttribute('aria-selected', 'true');
  });

  it('should switch between tabs when clicked', async () => {
    renderWithProviders(<PolicyBuilderDetail />, {
      authContext: authContextValues,
      numaRequestContext: numaRequestContextValues,
    });

    await waitFor(() => {
      expect(screen.getByText('School Policies')).toBeInTheDocument();
    });

    // Click on the Create New Policy tab
    const createTab = screen.getByRole('tab', { name: /Create New Policy/i });
    fireEvent.click(createTab);

    // Create New Policy tab should now be active
    await waitFor(() => {
      expect(createTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Create New School Policy')).toBeInTheDocument();
    });
  });

  it('should fetch policies on component mount', async () => {
    renderWithProviders(<PolicyBuilderDetail />, {
      authContext: authContextValues,
      numaRequestContext: numaRequestContextValues,
    });

    // Wait for the component to finish rendering
    await waitFor(() => {
      expect(screen.getByText('School Policies')).toBeInTheDocument();
    });

    // Verify fetch was called for config
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/config.json');
    });

    // Verify axios.get was called with the correct URL
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/policy-builder/jobs'), expect.anything());
    });

    // Verify policy is displayed in the table
    await waitFor(() => {
      expect(screen.getByText('Test School')).toBeInTheDocument();
      // Look for SUCCESS instead of Success
      expect(screen.getByText('SUCCESS')).toBeInTheDocument();
    });
  });

  it('should show policy templates in the generate tab', async () => {
    renderWithProviders(<PolicyBuilderDetail />, {
      authContext: authContextValues,
      numaRequestContext: numaRequestContextValues,
    });

    // Click on the Create New Policy tab
    const createTab = screen.getByRole('tab', { name: /Create New Policy/i });
    fireEvent.click(createTab);

    // Verify templates are displayed
    await waitFor(() => {
      expect(screen.getByText('Catholic School Policies')).toBeInTheDocument();
      expect(screen.getByText('Green School Policies')).toBeInTheDocument();
      expect(screen.getByText('Public School Policies')).toBeInTheDocument();
      expect(screen.getByText('Kura Kaupapa Māori Policies')).toBeInTheDocument();
    });
  });

  it('should open modal when a template is selected', async () => {
    renderWithProviders(<PolicyBuilderDetail />, {
      authContext: authContextValues,
      numaRequestContext: numaRequestContextValues,
    });

    // Click on the Create New Policy tab
    const createTab = screen.getByRole('tab', { name: /Create New Policy/i });
    fireEvent.click(createTab);

    await waitFor(() => {
      expect(screen.getByText('Catholic School Policies')).toBeInTheDocument();
    });

    // Click on a template
    const templateCard = screen.getByText('Catholic School Policies').closest('.card');
    fireEvent.click(templateCard);

    // Verify modal is displayed - look for the specific text that includes the template name
    await waitFor(() => {
      // Look for the text that includes the template name in the modal title
      expect(screen.getByText(/Using Catholic School Policies Scenario/i)).toBeInTheDocument();

      // Look for the form field label text directly
      expect(screen.getByText('School Name')).toBeInTheDocument();

      // Check for the Generate Policy button which should be in the modal
      expect(screen.getByText('Generate Policy')).toBeInTheDocument();
    });
  });

  it('should handle blank scenario button click', async () => {
    renderWithProviders(<PolicyBuilderDetail />, {
      authContext: authContextValues,
      numaRequestContext: numaRequestContextValues,
    });

    // Click on the Create New Policy tab
    const createTab = screen.getByRole('tab', { name: /Create New Policy/i });
    fireEvent.click(createTab);

    await waitFor(() => {
      expect(screen.getByText('Blank Scenario')).toBeInTheDocument();
    });

    // Click on the Blank Scenario button
    const blankScenarioButton = screen.getByText('Blank Scenario');
    fireEvent.click(blankScenarioButton);

    // Verify modal is displayed
    await waitFor(() => {
      // Look for the modal title
      const modalTitles = screen.getAllByText('Create New Policy');
      // The second one should be the modal title (first is the tab)
      expect(modalTitles.length).toBeGreaterThan(1);

      // Check for the School Name field in the form
      expect(screen.getByText('School Name')).toBeInTheDocument();
    });
  });

  it('should handle policy generation', async () => {
    // Mock the step function response
    numaRequestContextValues.numaPost.mockImplementation((url) => {
      if (url.includes('/policy-builder/main')) {
        return Promise.resolve({ job_id: 'test-step-function-id' });
      }
      return Promise.resolve({ jobId: 'test-job-id' });
    });

    // Mock the job update
    numaRequestContextValues.numaPut.mockResolvedValue({});

    // Mock the job polling
    numaRequestContextValues.numaGet.mockImplementation((url) => {
      if (url.includes('/policy-builder/main?job_id=test-step-function-id')) {
        return Promise.resolve({ status: 'SUCCESS' });
      }
      return Promise.resolve({
        items: [
          {
            jobId: 'test-job-id',
            type: 'POLICY_GENERATION',
            status: 'SUCCESS',
            dateTime: '2023-01-01T12:00:00Z',
            inputs: {
              schoolName: 'Test School',
            },
            stepFunctionJobId: 'test-step-function-id',
          },
        ],
      });
    });

    renderWithProviders(<PolicyBuilderDetail />, {
      authContext: authContextValues,
      numaRequestContext: numaRequestContextValues,
    });

    // Click on the Create New Policy tab
    const createTab = screen.getByRole('tab', { name: /Create New Policy/i });
    fireEvent.click(createTab);

    await waitFor(() => {
      expect(screen.getByText('Blank Scenario')).toBeInTheDocument();
    });

    // Click on the Blank Scenario button
    const blankScenarioButton = screen.getByTestId('blank-scenario-button');
    fireEvent.click(blankScenarioButton);

    // Wait for the modal to appear
    await waitFor(() => {
      expect(screen.getByText('Generate Policy')).toBeInTheDocument();
    });

    // Fill in the school name field
    const schoolNameInput = screen.getByPlaceholderText("e.g., St Theresa's School (Plimmerton)");
    fireEvent.change(schoolNameInput, { target: { value: 'Test School' } });

    // Fill in the school context field
    const schoolContextInput = screen.getByPlaceholderText(
      "Describe your school's characteristics, values, and community..."
    );
    fireEvent.change(schoolContextInput, { target: { value: 'This is a test school context.' } });

    // Click the Generate Policy button
    const generateButton = screen.getByText('Generate Policy');
    fireEvent.click(generateButton);

    // Verify we switch back to policies tab
    await waitFor(() => {
      const policiesTab = screen.getByRole('tab', { name: /School Policies/i });
      expect(policiesTab).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('should handle mobile view', async () => {
    // Set window width to mobile size
    window.innerWidth = 500;
    // Trigger resize event
    fireEvent(window, new Event('resize'));

    renderWithProviders(<PolicyBuilderDetail />, {
      authContext: authContextValues,
      numaRequestContext: numaRequestContextValues,
    });

    await waitFor(() => {
      expect(screen.getByText('Test School')).toBeInTheDocument();
    });

    // In mobile view, the download button should be an icon without text
    const downloadButtons = screen.getAllByRole('button');
    const downloadIconButton = downloadButtons.find(
      (button) => !button.textContent.includes('Download...') && button.closest('.dropdown')
    );

    expect(downloadIconButton).toBeDefined();
  });

  it('should display empty state when no policies exist', async () => {
    // Mock empty policies response
    numaRequestContextValues.numaGet.mockResolvedValue({ items: [] });

    // Also mock axios.get to return empty items
    axios.get.mockImplementation((url) => {
      if (url.includes('/policy-builder/jobs')) {
        return Promise.resolve({
          data: { items: [] },
        });
      }
      return Promise.resolve({ data: {} });
    });

    renderWithProviders(<PolicyBuilderDetail />, {
      authContext: authContextValues,
      numaRequestContext: numaRequestContextValues,
    });

    // Verify empty state message
    await waitFor(() => {
      expect(screen.getByText('No policies found. Create a new policy to get started.')).toBeInTheDocument();
    });
  });

  it('should display loading state when fetching policies', async () => {
    // Delay the response to show loading state
    numaRequestContextValues.numaGet.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ items: [] }), 100))
    );

    renderWithProviders(<PolicyBuilderDetail />, {
      authContext: authContextValues,
      numaRequestContext: numaRequestContextValues,
    });

    // Verify loading spinner is displayed
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should display processing policies correctly and start polling', async () => {
    // Mock a processing policy
    const processingPolicy = {
      jobId: 'processing-job-id',
      type: 'POLICY_GENERATION',
      status: 'PROCESSING',
      dateTime: '2023-01-01T12:00:00Z',
      inputs: {
        schoolName: 'Processing School',
      },
      stepFunctionJobId: 'processing-step-function-id',
    };

    // Mock axios get to return the processing policy
    axios.get.mockImplementation((url) => {
      if (url.includes('/policy-builder/jobs')) {
        return Promise.resolve({
          data: {
            items: [processingPolicy],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    // Mock numaGet to return the processing policy
    numaRequestContextValues.numaGet.mockImplementation((url) => {
      if (url.includes('/policy-builder/jobs')) {
        return Promise.resolve({
          items: [processingPolicy],
        });
      }
      // Mock the step function status check
      if (url.includes('/policy-builder/main')) {
        return Promise.resolve({ status: 'SUCCESS' });
      }
      return Promise.resolve({});
    });

    // Spy on setInterval to detect polling
    const originalSetInterval = global.setInterval;
    const setIntervalSpy = vi.fn().mockImplementation((callback) => {
      // Call the callback once to simulate polling
      setTimeout(callback, 0);
      return 123; // Return a dummy interval ID
    });
    global.setInterval = setIntervalSpy;

    // Spy on clearInterval
    const originalClearInterval = global.clearInterval;
    global.clearInterval = vi.fn();

    renderWithProviders(<PolicyBuilderDetail />, {
      authContext: authContextValues,
      numaRequestContext: numaRequestContextValues,
    });

    // Wait for the processing policy to be displayed
    await waitFor(() => {
      const policyNameElement = screen.getByTestId('policy-name-processing-job-id');
      expect(policyNameElement).toHaveTextContent('Processing School');

      const policyStatusElement = screen.getByTestId('policy-status-processing-job-id');
      expect(policyStatusElement).toHaveTextContent('PROCESSING');
    });

    // Verify the status has the correct styling
    const statusBadge = screen.getByTestId('policy-status-processing-job-id');
    expect(statusBadge).toHaveClass('bg-info');

    // Verify that setInterval was called (indicating polling was started)
    await waitFor(() => {
      expect(setIntervalSpy).toHaveBeenCalled();
    });

    // Restore original timer functions
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  });
});

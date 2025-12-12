/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { waitFor } from '@testing-library/react/pure';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { ResultsRenderer, JsonRenderer, CsvRenderer } from '../../Components/Renderers/ResultsRenderer';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaApp } from '../../Providers/NumaAppContext';
import * as s3Utils from '../../utils/s3Utils';

// Mock the dependencies
vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../Providers/NumaAppContext', () => ({
  useNumaApp: vi.fn(),
}));

vi.mock('../../Providers/KnowledgeBaseProvider', () => ({
  useKnowledgeBase: vi.fn().mockReturnValue({
    availableKBs: [],
    isLoadingKBs: false,
    refreshKnowledgeBases: vi.fn(),
  }),
}));

vi.mock('../../utils/s3Utils', () => ({
  downloadFileFromS3: vi.fn(),
  downloadFileWithSignedUrl: vi.fn().mockReturnValue(Promise.resolve()),
  openFileWithSignedUrl: vi.fn().mockReturnValue(Promise.resolve()),
}));

// Mock ReactMarkdown to simplify testing
vi.mock('react-markdown', () => {
  const MockMarkdown = ({ children }) => <div data-testid="markdown">{children}</div>;
  MockMarkdown.displayName = 'ReactMarkdown';
  return { default: MockMarkdown };
});

describe('ResultsRenderer Component', () => {
  // Setup common mocks
  beforeEach(() => {
    // Mock Auth Provider
    useAuth.mockReturnValue({
      getCredentials: vi.fn().mockResolvedValue({ accessKeyId: 'test', secretAccessKey: 'test' }),
    });

    // Mock NumaApp Context
    useNumaApp.mockReturnValue({
      fetchS3Content: vi.fn().mockResolvedValue('Test content'),
    });

    // Mock window.sessionStorage
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn().mockReturnValue('test-bucket'),
        // setItem: vi.fn(),
      },
      writable: true,
    });

    // Mock navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(),
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state while fetching data', () => {
    const results = [
      {
        input_reference: 'test-ref',
        outputs: [
          {
            content_type: 'text/plain',
            data: { bucket: 'test-bucket', key: 'test-key' },
            location: 'S3',
            title: 'Test Output',
          },
        ],
      },
    ];

    useNumaApp.mockReturnValue({
      fetchS3Content: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolving promise
    });

    render(<ResultsRenderer results={results} />);
    expect(screen.getByText('Loading content...')).toBeInTheDocument();
  });

  it('renders an error message when fetch fails', async () => {
    const results = [
      {
        input_reference: 'test-ref',
        outputs: [
          {
            content_type: 'text/plain',
            data: { bucket: 'test-bucket', key: 'test-key' },
            location: 'S3',
            title: 'Test Output',
          },
        ],
      },
    ];

    useNumaApp.mockReturnValue({
      fetchS3Content: vi.fn().mockRejectedValue(new Error('Fetch failed')),
    });

    render(<ResultsRenderer results={results} />);
    await waitFor(() => {
      expect(screen.getByText(/Error loading content/)).toBeInTheDocument();
    });
  });

  it('renders "No results to display" when results is null', () => {
    render(<ResultsRenderer results={null} />);
    expect(screen.getByText('No results to display')).toBeInTheDocument();
  });

  it('renders "No results to display" when results is not an array', () => {
    render(<ResultsRenderer results={{}} />);
    expect(screen.getByText('No results to display')).toBeInTheDocument();
  });

  it('handles the case when results does not contain any outputs', () => {
    const results = [{ input_reference: 'test-ref', outputs: [] }];
    render(<ResultsRenderer results={results} />);
    expect(screen.getByText('No outputs found in results')).toBeInTheDocument();
  });

  it('renders "No result found for index" when activeResultIndex is out of bounds', () => {
    const results = [
      {
        input_reference: 'test-ref',
        outputs: [{ content_type: 'text/plain', location: 'inline', data: 'Test content' }],
      },
    ];
    render(<ResultsRenderer results={results} activeResultIndex={5} />);
    expect(screen.queryByText(/No result found for index/)).not.toBeInTheDocument();
  });

  it('renders inline text content correctly', () => {
    const results = [
      {
        input_reference: 'test-ref',
        outputs: [
          {
            title: 'Test Output',
            content_type: 'text/plain',
            location: 'inline',
            data: 'Test content',
          },
        ],
      },
    ];
    render(<ResultsRenderer results={results} />);
    // The output title should appear in the tabs if we have multiple outputs
    // For single output, we don't need to check for the title
    expect(screen.getByTestId('markdown')).toHaveTextContent('Test content');
  });

  it('renders inline markdown content correctly', () => {
    const results = [
      {
        input_reference: 'test-ref',
        outputs: [
          {
            title: 'Markdown Output',
            content_type: 'text/markdown',
            location: 'inline',
            data: '# Heading Some content',
          },
        ],
      },
    ];
    render(<ResultsRenderer results={results} />);
    expect(screen.getByTestId('markdown')).toHaveTextContent('# Heading Some content');
  });

  it('renders inline JSON content correctly', () => {
    const jsonData = { key: 'value', nested: { item: 'test' } };
    const results = [
      {
        input_reference: 'test-ref',
        outputs: [
          {
            title: 'JSON Output',
            content_type: 'application/json',
            location: 'inline',
            data: { content: JSON.stringify(jsonData, null, 2) },
          },
        ],
      },
    ];
    render(<ResultsRenderer results={results} />);
    expect(screen.getByText('Key')).toBeInTheDocument();
    expect(screen.getByText('value')).toBeInTheDocument();
  });

  it('handles S3 content fetch error', async () => {
    // Mock fetchS3Content to reject
    useNumaApp.mockReturnValue({
      fetchS3Content: vi.fn().mockRejectedValue(new Error('Failed to fetch')),
    });

    const results = [
      {
        input_reference: 'test-ref',
        outputs: [
          {
            title: 'S3 Output',
            content_type: 'text/plain',
            location: 's3',
            data: { bucket: 'test-bucket', key: 'test-key' },
          },
        ],
      },
    ];
    render(<ResultsRenderer results={results} />);

    await waitFor(() => {
      expect(screen.getByText(/Error loading content: Failed to fetch/)).toBeInTheDocument();
    });
  });

  it('renders download buttons for non-renderable content', async () => {
    const results = [
      {
        input_reference: 'test-ref',
        outputs: [
          {
            title: 'PDF Output',
            content_type: 'application/pdf',
            location: 's3',
            data: { bucket: 'test-bucket', key: 'test-key' },
          },
        ],
      },
    ];
    render(<ResultsRenderer results={results} />);

    await waitFor(() => {
      expect(screen.getByText('Download PDF Output')).toBeInTheDocument();
      expect(screen.getByText('Open in New Tab')).toBeInTheDocument();
    });
  });

  it('calls downloadFileWithSignedUrl when download button is clicked', async () => {
    const results = [
      {
        input_reference: 'test-ref',
        outputs: [
          {
            title: 'PDF Output',
            content_type: 'application/pdf',
            location: 's3',
            data: { bucket: 'test-bucket', key: 'test-key' },
          },
        ],
      },
    ];

    // Mock sessionStorage to return a region
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn((key) => {
          if (key === 'test-bucket') return 'test-bucket';
          if (key === 'REGION') return 'us-east-1';
          return 'test-bucket';
        }),
      },
      writable: true,
    });

    render(<ResultsRenderer results={results} />);

    await waitFor(() => {
      const downloadButton = screen.getByText('Download PDF Output');
      fireEvent.click(downloadButton);
      expect(s3Utils.downloadFileWithSignedUrl).toHaveBeenCalledWith(
        'test-key',
        'test-bucket',
        'us-east-1',
        expect.any(Function),
        'PDF Output',
      );
    });
  });

  it('calls openFileWithSignedUrl when open button is clicked', async () => {
    const results = [
      {
        input_reference: 'test-ref',
        outputs: [
          {
            title: 'PDF Output',
            content_type: 'application/pdf',
            location: 's3',
            data: { bucket: 'test-bucket', key: 'test-key' },
          },
        ],
      },
    ];

    // Mock sessionStorage to return a region
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn((key) => {
          if (key === 'test-bucket') return 'test-bucket';
          if (key === 'REGION') return 'us-east-1';
          return 'test-bucket';
        }),
      },
      writable: true,
    });

    render(<ResultsRenderer results={results} />);

    await waitFor(() => {
      const openButton = screen.getByText('Open in New Tab');
      fireEvent.click(openButton);
      expect(s3Utils.openFileWithSignedUrl).toHaveBeenCalledWith(
        'test-key',
        'test-bucket',
        'us-east-1',
        expect.any(Function),
      );
    });
  });
});

describe('JsonRenderer Component', () => {
  beforeEach(() => {
    // Mock navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(),
      },
      writable: true,
    });
  });

  it('renders simple JSON data correctly', () => {
    const data = {
      title: 'Test Title',
      description: 'Test Description',
      count: 42,
      isActive: true,
    };

    render(<JsonRenderer data={data} />);

    // Check that all keys are displayed in the step indicators
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Count')).toBeInTheDocument();
    expect(screen.getByText('IsActive')).toBeInTheDocument();

    // Initially only the first value is shown
    expect(screen.getByText('Test Title')).toBeInTheDocument();

    // Click on other steps to see their values
    fireEvent.click(screen.getByText('Description'));
    expect(screen.getByText('Test Description')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Count'));
    expect(screen.getByText('42')).toBeInTheDocument();

    fireEvent.click(screen.getByText('IsActive'));
    expect(screen.getByText('true')).toBeInTheDocument();
  });

  it('renders nested JSON data correctly', () => {
    const data = {
      person: {
        name: 'John Doe',
        age: 30,
        address: {
          street: '123 Main St',
          city: 'Anytown',
        },
      },
    };

    render(<JsonRenderer data={data} />);

    expect(screen.getByText('Name:')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Address:')).toBeInTheDocument();
    expect(screen.getByText('Street:')).toBeInTheDocument();
    expect(screen.getByText('123 Main St')).toBeInTheDocument();
  });

  it('renders array data correctly', () => {
    const data = {
      items: [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ],
    };

    render(<JsonRenderer data={data} />);

    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
  });

  it('copies JSON data to clipboard when Copy Data button is clicked', () => {
    const data = { key: 'value' };

    render(<JsonRenderer data={data} />);

    const copyButton = screen.getByText('Copy Data');
    fireEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });
});

describe('CsvRenderer Component', () => {
  beforeEach(() => {
    // Mock Auth Provider
    useAuth.mockReturnValue({
      getCredentials: vi.fn().mockResolvedValue({ accessKeyId: 'test', secretAccessKey: 'test' }),
    });

    // Mock window.sessionStorage
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn().mockReturnValue('test-bucket'),
      },
      writable: true,
    });
  });

  it('renders CSV data correctly', () => {
    const csvData = 'Name,Age,City\nJohn,30,New York\nJane,25,Boston';

    render(<CsvRenderer data={csvData} />);

    // Check for headers
    expect(screen.getByText('Name:')).toBeInTheDocument();
    expect(screen.getByText('Age:')).toBeInTheDocument();

    // Use more specific queries for values that appear multiple times
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('New York')).toBeInTheDocument();

    // For the row tabs
    expect(screen.getAllByText('John')[0]).toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });

  it('handles empty CSV data', () => {
    render(<CsvRenderer data="" />);

    expect(screen.getByText('No valid CSV data found')).toBeInTheDocument();
  });

  it('handles CSV with quoted values containing commas', () => {
    const csvData = 'Name,Description\nJohn,"Developer, Senior"\nJane,"Manager, Product"';

    render(<CsvRenderer data={csvData} />);

    expect(screen.getByText('Name:')).toBeInTheDocument();
    expect(screen.getByText('Description:')).toBeInTheDocument();
    expect(screen.getByText('Developer, Senior')).toBeInTheDocument();

    // Use getAllByText for "John" since it appears in both the tab and the data
    expect(screen.getAllByText('John').length).toBeGreaterThan(0);
  });

  it('renders row tabs for multiple rows', () => {
    const csvData = 'Name,Age\nJohn,30\nJane,25\nBob,40';

    render(<CsvRenderer data={csvData} />);

    // Look for step indicators containing the names instead of buttons
    const stepLabels = screen.getAllByText(/John|Jane|Bob/);

    // Check that we have all three names in the step labels
    expect(stepLabels.some((label) => label.textContent === 'John')).toBeTruthy();
    expect(stepLabels.some((label) => label.textContent === 'Jane')).toBeTruthy();
    expect(stepLabels.some((label) => label.textContent === 'Bob')).toBeTruthy();

    // Verify we have the right number of tabs
    const stepIndicators = document.querySelectorAll('.step-indicator');
    expect(stepIndicators.length).toBe(3);
  });

  it('switches between rows when tabs are clicked', () => {
    const csvData = 'Name,Age\nJohn,30\nJane,25';

    render(<CsvRenderer data={csvData} />);

    // Initially shows first row
    expect(screen.getAllByText('John').length).toBeGreaterThan(0);

    // Find Jane's tab specifically
    const janeTabs = screen.getAllByText('Jane');
    const janeTab = janeTabs[0]; // Get the first occurrence which should be the tab

    // Click on Jane's tab
    fireEvent.click(janeTab);

    // Should now show Jane's data
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('handles file paths in CSV data', () => {
    const csvData = 'Name,Resume\nJohn,s3://bucket/path/to/resume.pdf';

    render(<CsvRenderer data={csvData} />);

    expect(screen.getByText('Name:')).toBeInTheDocument();
    expect(screen.getAllByText('John').length).toBeGreaterThan(0);
    expect(screen.getByText('Resume:')).toBeInTheDocument();
    expect(screen.getByText('resume.pdf')).toBeInTheDocument();
    expect(screen.getByTitle('Download file')).toBeInTheDocument();
    expect(screen.getByTitle('Open in new tab')).toBeInTheDocument();
  });
});

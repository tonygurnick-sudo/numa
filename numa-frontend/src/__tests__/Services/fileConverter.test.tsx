/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDocxBlob } from '../../Services/fileConverter';
import * as docx from 'docx';

// Mock the docx module's components and functions
vi.mock('docx', () => {
  // Create mock classes and functions with spy functionality
  const HeadingLevel = {
    HEADING_1: 'heading1',
    HEADING_2: 'heading2',
    HEADING_3: 'heading3',
    HEADING_4: 'heading4',
    HEADING_5: 'heading5',
    HEADING_6: 'heading6',
  };

  const BorderStyle = {
    SINGLE: 'single',
  };

  const AlignmentType = {
    CENTER: 'center',
    START: 'start',
  };

  const WidthType = {
    PERCENTAGE: 'percentage',
  };

  const Document = vi.fn().mockImplementation(() => ({}));
  const Paragraph = vi.fn().mockImplementation((args) => args || {});
  const TextRun = vi.fn().mockImplementation((args) => args || {});
  const Table = vi.fn().mockImplementation(() => ({}));
  const TableRow = vi.fn().mockImplementation((args) => args || {});
  const TableCell = vi.fn().mockImplementation(() => ({}));
  const ExternalHyperlink = vi.fn().mockImplementation((args) => args || {});
  const Footer = vi.fn().mockImplementation(() => ({}));

  const PageNumber = {
    CURRENT: { children: ['CURRENT'] },
    TOTAL_PAGES: { children: ['TOTAL'] },
  };

  return {
    Document,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    BorderStyle,
    AlignmentType,
    ExternalHyperlink,
    WidthType,
    Footer,
    PageNumber,
    Packer: {
      toBlob: vi.fn().mockResolvedValue(
        new Blob(['mock-docx-content'], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ),
    },
  };
});

describe('fileConverter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createDocxBlob', () => {
    it('should create a document with title', async () => {
      const markdownString = '# Heading\nSome content';
      const docTitle = 'Test Document';

      const docxBlob = await createDocxBlob(markdownString, docTitle);

      // Check document creation
      expect(docx.Document).toHaveBeenCalled();
      expect(docx.Packer.toBlob).toHaveBeenCalled();

      // Verify blob was created
      expect(docxBlob).toBeInstanceOf(Blob);
    });

    it('should include proper sections and title in the document', async () => {
      const markdownString = 'Test content';
      const docTitle = 'Test Document';

      await createDocxBlob(markdownString, docTitle);

      // Verify Document was constructed with appropriate structure
      const documentArgs = docx.Document.mock.calls[0][0];

      // Check sections exist
      expect(documentArgs.sections).toBeDefined();
      expect(documentArgs.sections.length).toBeGreaterThan(0);

      // Check that title is included as heading
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          text: docTitle,
          bold: true,
          size: 36,
        }),
      );

      // Check proper heading level for title
      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          heading: docx.HeadingLevel.HEADING_1,
        }),
      );
    });

    it('should create a document with footer and page numbers', async () => {
      const markdownString = 'Some content';
      const docTitle = 'Document With Footer';

      await createDocxBlob(markdownString, docTitle);

      // Check that Footer was created
      expect(docx.Footer).toHaveBeenCalled();

      // Check for page number elements
      expect(docx.TextRun).toHaveBeenCalledWith({
        children: [docx.PageNumber.CURRENT],
      });

      expect(docx.TextRun).toHaveBeenCalledWith({
        children: [docx.PageNumber.TOTAL_PAGES],
      });
    });
  });

  describe('Markdown conversion', () => {
    it('should handle text formatting (bold, italic, code)', async () => {
      const markdown = 'Normal **bold** *italic* `code` text';

      await createDocxBlob(markdown, 'Text Formatting Test');

      // Check that TextRun was called with appropriate formatting
      // Bold formatting
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          bold: true,
        }),
      );

      // Italic formatting
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          italic: true,
        }),
      );

      // Code formatting (highlighted text)
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          highlight: 'lightGray',
          font: 'Courier New',
        }),
      );
    });

    it('should handle alternative bold/italic syntax', async () => {
      const markdown = 'Use __underscore bold__ and _underscore italic_';

      await createDocxBlob(markdown, 'Alternative Format Test');

      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          bold: true,
          text: 'underscore bold',
        }),
      );

      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          italic: true,
          text: 'underscore italic',
        }),
      );
    });

    it('should handle nested formatting correctly', async () => {
      const markdown = 'This is **bold with *nested italic* text**';

      await createDocxBlob(markdown, 'Nested Format Test');

      // Check for bold with italic nested inside
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          bold: true,
          italic: true,
          text: 'nested italic',
        }),
      );
    });

    it('should handle headings with proper levels', async () => {
      const markdown = '# Heading 1\n## Heading 2\n### Heading 3';

      await createDocxBlob(markdown, 'Headings Test');

      // Check for heading levels
      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          heading: docx.HeadingLevel.HEADING_1,
        }),
      );

      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          heading: docx.HeadingLevel.HEADING_2,
        }),
      );

      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          heading: docx.HeadingLevel.HEADING_3,
        }),
      );
    });

    it('should convert bullet lists correctly', async () => {
      const markdown = '- Item 1\n- Item 2\n  - Nested item';

      await createDocxBlob(markdown, 'Bullet List Test');

      // Check for bullet formatting in paragraphs
      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          bullet: expect.anything(),
        }),
      );

      // Check for first level indent
      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          indent: expect.objectContaining({ left: 240 }),
        }),
      );

      // Check for nested level indent
      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          indent: expect.objectContaining({ left: 480 }),
        }),
      );
    });

    it('should handle both dash and asterisk for bullet points', async () => {
      const markdown = '- Item with dash\n* Item with asterisk';

      await createDocxBlob(markdown, 'Mixed Bullet List Test');

      // Both types should be formatted as bullet points
      const paragraphCalls = docx.Paragraph.mock.calls.map((call) => call[0]);
      const bulletPoints = paragraphCalls.filter((arg) => arg.bullet);

      expect(bulletPoints.length).toBe(2);
    });

    it('should convert numbered lists correctly', async () => {
      const markdown = '1. First item\n2. Second item\n   1. Nested item';

      await createDocxBlob(markdown, 'Numbered List Test');

      // Check for numbering in paragraphs
      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          numbering: expect.objectContaining({
            reference: 'custom-numbering',
            level: 0,
          }),
        }),
      );

      // Check for nested level
      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          numbering: expect.objectContaining({
            reference: 'custom-numbering',
            level: 1,
          }),
        }),
      );
    });

    it('should handle lettered lists correctly', async () => {
      const markdown = 'a) First lettered item\nb) Second lettered item';

      await createDocxBlob(markdown, 'Lettered List Test');

      // Check that TextRun was called with letter prefixes
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'a) ',
        }),
      );

      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'b) ',
        }),
      );

      // Check for proper hanging indent
      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          indent: expect.objectContaining({
            left: 240,
            hanging: 240,
          }),
        }),
      );
    });

    it('should handle horizontal rules', async () => {
      const markdown = 'Text\n---\nMore text';

      await createDocxBlob(markdown, 'Horizontal Rule Test');

      // Check for paragraph with bottom border (horizontal rule)
      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          border: expect.objectContaining({
            bottom: expect.objectContaining({
              style: docx.BorderStyle.SINGLE,
            }),
          }),
        }),
      );
    });

    it('should handle alternate horizontal rule syntax', async () => {
      const markdown = 'Text\n***\nMore text\n___\nEven more text';

      await createDocxBlob(markdown, 'Alt Horizontal Rule Test');

      // Check that multiple horizontal rules are created with different syntax
      const paragraphCalls = docx.Paragraph.mock.calls.map((call) => call[0]);
      const horizontalRules = paragraphCalls.filter(
        (arg) => arg.border && arg.border.bottom && arg.border.bottom.style === docx.BorderStyle.SINGLE,
      );

      expect(horizontalRules.length).toBe(2);
    });

    it('should handle blockquotes', async () => {
      const markdown = '> This is a blockquote\n> With multiple lines';

      await createDocxBlob(markdown, 'Blockquote Test');

      // Check for blockquote formatting (left border)
      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          border: expect.objectContaining({
            left: expect.objectContaining({
              style: docx.BorderStyle.SINGLE,
            }),
          }),
          indent: expect.objectContaining({ left: 240 }),
        }),
      );
    });

    it('should handle blockquotes with formatting', async () => {
      const markdown = '> This is a **bold** blockquote with *italic* text';

      await createDocxBlob(markdown, 'Formatted Blockquote Test');

      // Find a TextRun that's bold in the context of a blockquote paragraph
      const paragraphCalls = docx.Paragraph.mock.calls.map((call) => call[0]);
      const blockquotes = paragraphCalls.filter((arg) => arg.border && arg.border.left);

      expect(blockquotes.length).toBeGreaterThan(0);

      // Check for bold and italic formatting in TextRun calls
      expect(docx.TextRun).toHaveBeenCalledWith(expect.objectContaining({ bold: true }));
      expect(docx.TextRun).toHaveBeenCalledWith(expect.objectContaining({ italic: true }));
    });

    it('should handle code blocks', async () => {
      const markdown = 'Text\n```\nconst x = 1;\nconsole.log(x);\n```\nMore text';

      await createDocxBlob(markdown, 'Code Block Test');

      // Check for code block formatting
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          font: 'Courier New',
          size: 20,
          text: expect.stringContaining('const x = 1;'),
        }),
      );

      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          border: expect.objectContaining({
            top: expect.anything(),
            bottom: expect.anything(),
            left: expect.anything(),
            right: expect.anything(),
          }),
        }),
      );
    });

    it('should handle code blocks with syntax highlighting annotation', async () => {
      const markdown = 'Text\n```javascript\nconst x = 1;\nconsole.log(x);\n```\nMore text';

      await createDocxBlob(markdown, 'Syntax Highlighted Code Test');

      // Should still format as code block even with language annotation
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          font: 'Courier New',
          text: expect.stringContaining('const x = 1;'),
        }),
      );

      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          border: expect.objectContaining({
            top: expect.anything(),
          }),
          shading: expect.objectContaining({
            fill: 'F8F8F8',
          }),
        }),
      );
    });

    it('should handle tables', async () => {
      const markdown = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |';

      await createDocxBlob(markdown, 'Table Test');

      // Check Table was created
      expect(docx.Table).toHaveBeenCalled();

      // Check table rows and cells
      expect(docx.TableRow).toHaveBeenCalled();
      expect(docx.TableCell).toHaveBeenCalled();

      // Check for header row
      expect(docx.TableRow).toHaveBeenCalledWith(
        expect.objectContaining({
          tableHeader: true,
        }),
      );
    });

    it('should handle tables with formatting in cells', async () => {
      const markdown = '| Header 1 | **Bold Header** |\n|----------|----------|\n| *Italic* | `code` |';

      await createDocxBlob(markdown, 'Formatted Table Test');

      // Check for formatting in table cells
      expect(docx.TextRun).toHaveBeenCalledWith(expect.objectContaining({ bold: true }));
      expect(docx.TextRun).toHaveBeenCalledWith(expect.objectContaining({ italic: true }));
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          highlight: 'lightGray',
          font: 'Courier New',
        }),
      );
    });

    it('should handle references section with special formatting', async () => {
      const markdown = 'Some content\n\nReferences:\n1. First reference\n2. Second reference';

      await createDocxBlob(markdown, 'References Test');

      // Check for references heading
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'References:',
          bold: true,
        }),
      );

      // Check for indentation in references
      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          indent: expect.objectContaining({
            left: 240,
            hanging: 240,
          }),
        }),
      );
    });

    it('should handle bracketed references section format', async () => {
      const markdown = 'Some content\n\nReferences:\n[1] First reference\n[2] Second reference';

      await createDocxBlob(markdown, 'Bracketed References Test');

      // Check for proper reference formatting
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '1. ',
          bold: false,
        }),
      );

      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '2. ',
          bold: false,
        }),
      );

      // Check paragraph formatting is consistent
      expect(docx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          indent: expect.objectContaining({
            left: 240,
            hanging: 240,
          }),
        }),
      );
    });

    it('should handle complex nested formatting combinations', async () => {
      const markdown = '**Bold text with `code` inside** and *italic with **bold***';

      await createDocxBlob(markdown, 'Nested Format Test');

      // Code inside bold should be properly handled
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          highlight: 'lightGray',
          font: 'Courier New',
        }),
      );

      // Bold inside italic should be properly handled
      expect(docx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          bold: true,
          italic: true,
        }),
      );
    });

    it('should handle empty paragraphs for line spacing', async () => {
      const markdown = 'First paragraph\n\nSecond paragraph';

      await createDocxBlob(markdown, 'Paragraph Spacing Test');

      // Three paragraphs: First, empty spacing, second
      const paragraphCount = docx.Paragraph.mock.calls.length;

      // At least 3 paragraphs should be created (first, empty, second)
      // Plus 1 for the title paragraph
      expect(paragraphCount).toBeGreaterThanOrEqual(4);
    });

    it('should handle multiple styled elements in combination', async () => {
      const markdown =
        '# Main Title\n\nParagraph with **bold** and *italic* text.\n\n- List item 1\n- List item 2\n\n> Blockquote text\n\nNormal paragraph.';

      await createDocxBlob(markdown, 'Combined Elements Test');

      // Check document gets created with all elements
      expect(docx.Document).toHaveBeenCalled();
      expect(docx.TextRun).toHaveBeenCalled();
      expect(docx.Paragraph).toHaveBeenCalled();

      const documentArgs = docx.Document.mock.calls[0][0];
      expect(documentArgs.sections[0].children.length).toBeGreaterThan(5);
    });
  });
});

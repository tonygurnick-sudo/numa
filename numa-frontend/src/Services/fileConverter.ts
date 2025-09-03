/**
 * Markdown to DOCX Converter
 * This module handles conversion from markdown content to properly styled DOCX documents.
 *
 * Supported Markdown Features:
 * 1. Text Formatting:
 *    - Bold text: **bold** or __bold__
 *    - Italic text: *italic* or _italic_
 *    - Inline code: `code`
 *    - Links: [text](url)
 *
 * 2. Block Elements:
 *    - Headings: # H1, ## H2, ... ###### H6
 *    - Paragraphs
 *    - Horizontal rules: --- or *** or ___
 *    - Block quotes: > text
 *    - Code blocks: ```code```
 *
 * 3. Lists:
 *    - Unordered lists: - item or * item (with nesting)
 *    - Numbered lists: 1. item (with nesting)
 *    - Lettered lists: a) item, b) item
 *
 * 4. Tables:
 *    - Standard markdown tables with header rows
 *
 * 5. Special Sections:
 *    - References section with special formatting for documents with references
 *
 */
import {
  Document,
  Packer,
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
} from 'docx';

// Helper function to parse inline markdown styling
const parseInlineMarkdown = (text) => {
  if (!text) return [new TextRun('')];

  const segments = [];
  let currentText = '';
  let isBold = false;
  let isItalic = false;
  let isCode = false;
  let linkText = null;
  let linkUrl = null;

  // Parse character by character
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    const prevChar = text[i - 1];

    // Bold: **text** or __text__
    if ((char === '*' && nextChar === '*') || (char === '_' && nextChar === '_')) {
      if (!isBold && (prevChar === ' ' || prevChar === undefined || prevChar === '\n' || prevChar === '\r')) {
        // Start bold
        if (currentText) {
          segments.push(new TextRun({ text: currentText, bold: isItalic, italic: isItalic }));
          currentText = '';
        }
        isBold = true;
        i++; // Skip the next asterisk/underscore
      } else if (isBold) {
        // End bold
        segments.push(new TextRun({ text: currentText, bold: true, italic: isItalic }));
        currentText = '';
        isBold = false;
        i++; // Skip the next asterisk/underscore
      } else {
        currentText += char;
      }
    }
    // Italic: *text* or _text_
    else if ((char === '*' || char === '_') && !isCode && nextChar !== char) {
      if (!isItalic && (prevChar === ' ' || prevChar === undefined || prevChar === '\n' || prevChar === '\r')) {
        // Start italic
        if (currentText) {
          segments.push(new TextRun({ text: currentText, bold: isBold, italic: isItalic }));
          currentText = '';
        }
        isItalic = true;
      } else if (isItalic) {
        // End italic
        segments.push(new TextRun({ text: currentText, bold: isBold, italic: true }));
        currentText = '';
        isItalic = false;
      } else {
        currentText += char;
      }
    }
    // Inline code: `code`
    else if (char === '`' && !isCode) {
      if (currentText) {
        segments.push(new TextRun({ text: currentText, bold: isBold, italic: isItalic }));
        currentText = '';
      }
      isCode = true;
    } else if (char === '`' && isCode) {
      segments.push(
        new TextRun({
          text: currentText,
          highlight: 'lightGray',
          font: 'Courier New',
        }),
      );
      currentText = '';
      isCode = false;
    }
    // Links: [text](url)
    else if (char === '[' && !isCode && !linkText) {
      if (currentText) {
        segments.push(new TextRun({ text: currentText, bold: isBold, italic: isItalic }));
        currentText = '';
      }
      linkText = '';
    } else if (char === ']' && !isCode && linkText !== null && linkUrl === null && nextChar === '(') {
      // Found closing bracket of link text
    } else if (char === '(' && !isCode && linkText !== null && linkUrl === null && prevChar === ']') {
      // Start of link URL
      linkUrl = '';
    } else if (char === ')' && !isCode && linkText !== null && linkUrl !== null) {
      // End of link URL, create hyperlink
      segments.push(
        new ExternalHyperlink({
          children: [new TextRun({ text: linkText, style: 'Hyperlink' })],
          link: linkUrl,
        }),
      );
      linkText = null;
      linkUrl = null;
    } else if (linkText !== null && linkUrl === null && prevChar !== '[') {
      linkText += char;
    } else if (linkUrl !== null && prevChar !== '(') {
      linkUrl += char;
    } else {
      currentText += char;
    }
  }

  // Add any remaining text
  if (currentText) {
    segments.push(new TextRun({ text: currentText, bold: isBold, italic: isItalic }));
  }

  return segments;
};

// Table parsing function
const parseMarkdownTable = (tableLines) => {
  // Extract header and rows
  const headerRow = tableLines[0]
    .trim()
    .split('|')
    .filter((cell) => cell.trim() !== '');

  // Skip separator line
  const rows = tableLines.slice(2).map((row) =>
    row
      .trim()
      .split('|')
      .filter((cell) => cell.trim() !== ''),
  );

  // Create table
  const table = new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
    },
    rows: [
      // Header row
      new TableRow({
        tableHeader: true,
        children: headerRow.map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: parseInlineMarkdown(cell.trim()),
                  alignment: AlignmentType.CENTER,
                }),
              ],
              shading: {
                fill: 'EEEEEE',
              },
            }),
        ),
      }),
      // Data rows
      ...rows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (cell) =>
                new TableCell({
                  children: [new Paragraph({ children: parseInlineMarkdown(cell.trim()) })],
                }),
            ),
          }),
      ),
    ],
  });

  return table;
};

// Process a block of code
const createCodeBlock = (codeContent) => {
  return new Paragraph({
    children: [
      new TextRun({
        text: codeContent,
        font: 'Courier New',
        size: 20,
      }),
    ],
    spacing: { before: 200, after: 200 },
    border: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' },
    },
    shading: {
      fill: 'F8F8F8',
    },
  });
};

/**
 * Special handling for references sections in policy documents (e.g. NZSBA)
 *
 * Supports both numbered formats:
 * 1. Reference text...
 * 2. Another reference...
 *
 * And bracketed formats:
 * [1] Reference text...
 * [2] Another reference...
 */
const handleReferencesSection = (lines, startIndex) => {
  const elements = [];
  let i = startIndex;
  let referenceCounter = 1;

  // Add the "References:" header
  elements.push(
    new Paragraph({
      children: [new TextRun({ text: 'References:', bold: true })],
      spacing: { before: 400, after: 200 },
    }),
  );

  i++; // Move past the "References:" line

  // Process each reference line
  while (i < lines.length) {
    const line = lines[i].trim();

    // Stop when we hit an empty line or a heading
    if (!line || /^#{1,6}\s+/.test(line)) {
      break;
    }

    // Check if this is a reference line (numbered or bracketed)
    const isNumberedReference = /^\d+\.\s+/.test(line);
    const isBracketedReference = /^\[\d+\]\s+/.test(line);

    if (isNumberedReference || isBracketedReference) {
      // Extract the reference text without the numbering
      let referenceText = line;
      if (isNumberedReference) {
        referenceText = referenceText.replace(/^\d+\.\s+/, '');
      } else {
        referenceText = referenceText.replace(/^\[\d+\]\s+/, '');
      }

      // Add as a consistently formatted reference
      elements.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${referenceCounter}. `, bold: false }),
            ...parseInlineMarkdown(referenceText),
          ],
          indent: { left: 240, hanging: 240 },
          spacing: { after: 80 },
        }),
      );

      referenceCounter++;
    } else {
      // If it doesn't match our reference patterns, add it as a normal paragraph
      elements.push(
        new Paragraph({
          children: parseInlineMarkdown(line),
          indent: { left: 240 },
        }),
      );
    }

    i++;
  }

  return {
    elements,
    newIndex: i,
  };
};

// Detect if we're in a references section
const isReferencesSection = (line) => {
  return line.trim().toLowerCase() === 'references:' || /^references\s*$/i.test(line.trim());
};

// Main conversion function
const convertMarkdownToDocxElements = (markdown) => {
  const elements = [];
  const lines = markdown.split('\n');

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines but add a paragraph for spacing
    if (!trimmed) {
      elements.push(new Paragraph(''));
      i++;
      continue;
    }

    // Handle reference sections with special formatting
    if (isReferencesSection(trimmed)) {
      const { elements: referenceElements, newIndex } = handleReferencesSection(lines, i);
      elements.push(...referenceElements);
      i = newIndex;
      continue;
    }

    // Calculate indent level for lists
    const indentMatch = line.match(/^(\s+)/);
    const indentLevel = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;

    // Headings (# Heading)
    if (/^#{1,6}\s+/.test(trimmed)) {
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
      if (headingMatch) {
        const level = Math.min(headingMatch[1].length, 6);
        const headingText = headingMatch[2];

        let heading;
        switch (level) {
          case 1:
            heading = HeadingLevel.HEADING_1;
            break;
          case 2:
            heading = HeadingLevel.HEADING_2;
            break;
          case 3:
            heading = HeadingLevel.HEADING_3;
            break;
          case 4:
            heading = HeadingLevel.HEADING_4;
            break;
          case 5:
            heading = HeadingLevel.HEADING_5;
            break;
          case 6:
            heading = HeadingLevel.HEADING_6;
            break;
        }

        elements.push(
          new Paragraph({
            children: parseInlineMarkdown(headingText),
            heading,
          }),
        );
      }
      i++;
      continue;
    }

    // Horizontal rule (--- or ___ or ***)
    if (/^[-*_]{3,}$/.test(trimmed)) {
      elements.push(
        new Paragraph({
          children: [new TextRun('')],
          border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: '000000' } },
        }),
      );
      i++;
      continue;
    }

    // Unordered lists (- item or * item) with proper indentation
    if (/^[-*]\s+/.test(trimmed)) {
      elements.push(
        new Paragraph({
          children: parseInlineMarkdown(trimmed.substring(2).trim()),
          bullet: { level: indentLevel },
          indent: { left: (indentLevel + 1) * 240 }, // Enhanced indentation for nested bullet points
        }),
      );
      i++;
      continue;
    }

    // Lettered lists (a), b), etc.)
    const letteredListMatch = trimmed.match(/^([a-z])\)\s+(.*)$/i);
    if (letteredListMatch) {
      const letter = letteredListMatch[1];
      const content = letteredListMatch[2];

      elements.push(
        new Paragraph({
          children: [new TextRun({ text: `${letter}) `, bold: false }), ...parseInlineMarkdown(content)],
          indent: { left: (indentLevel + 1) * 240, hanging: 240 },
        }),
      );
      i++;
      continue;
    }

    // Numbered lists (1. item)
    if (/^\d+\.\s+/.test(trimmed)) {
      const numberMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (numberMatch) {
        const content = numberMatch[2];

        elements.push(
          new Paragraph({
            children: parseInlineMarkdown(content),
            numbering: {
              reference: 'custom-numbering',
              level: indentLevel,
            },
            indent: { left: (indentLevel + 1) * 240, hanging: 240 },
          }),
        );
      }
      i++;
      continue;
    }

    // Blockquotes (> quote)
    if (/^>\s+/.test(trimmed)) {
      const quoteContent = trimmed.substring(2).trim();
      elements.push(
        new Paragraph({
          children: parseInlineMarkdown(quoteContent),
          border: {
            left: { style: BorderStyle.SINGLE, size: 3, color: 'CCCCCC' },
          },
          indent: { left: 240 },
          spacing: { before: 120, after: 120 },
        }),
      );
      i++;
      continue;
    }

    // Tables
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // Make sure we have at least 3 lines for a table header, separator, and data
      if (
        i + 2 < lines.length &&
        lines[i + 1].trim().startsWith('|') &&
        lines[i + 1].trim().endsWith('|') &&
        lines[i + 1].includes('-')
      ) {
        // Collect table lines
        const tableLines = [];
        let j = i;
        while (j < lines.length && lines[j].trim().startsWith('|') && lines[j].trim().endsWith('|')) {
          tableLines.push(lines[j]);
          j++;
        }

        // Create and add table
        elements.push(parseMarkdownTable(tableLines));
        i = j;
        continue;
      }
    }

    // Code blocks
    if (trimmed === '```' || trimmed.startsWith('```')) {
      // Collect code block content
      const codeLines = [];
      let j = i + 1;

      while (j < lines.length && !lines[j].trim().startsWith('```')) {
        codeLines.push(lines[j]);
        j++;
      }

      // Only add code block if we found the end marker
      if (j < lines.length) {
        elements.push(createCodeBlock(codeLines.join('\n')));
        i = j + 1;
        continue;
      }
    }

    // Regular paragraph
    elements.push(
      new Paragraph({
        children: parseInlineMarkdown(trimmed),
        lineSpacing: 240,
      }),
    );
    i++;
  }

  return elements;
};

export const createDocxBlob = async (markdownString, docTitle) => {
  // Create title element with consistent styling
  const titleParagraph = new Paragraph({
    children: [new TextRun({ text: docTitle, bold: true, size: 36 })],
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 400 },
  });

  // Convert markdown to document elements
  const contentElements = convertMarkdownToDocxElements(markdownString);

  // Create a professional footer with page numbers
  const footer = new Footer({
    children: [
      new Paragraph({
        children: [
          new TextRun('Page '),
          new TextRun({
            children: [PageNumber.CURRENT],
          }),
          new TextRun(' of '),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 100 },
      }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [titleParagraph, ...contentElements],
        footers: {
          default: footer,
        },
      },
    ],
    numbering: {
      config: [
        {
          reference: 'custom-numbering',
          levels: [
            { level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START },
            { level: 1, format: 'decimal', text: '%1.%2.', alignment: AlignmentType.START },
            { level: 2, format: 'decimal', text: '%1.%2.%3.', alignment: AlignmentType.START },
            { level: 3, format: 'decimal', text: '%1.%2.%3.%4.', alignment: AlignmentType.START },
            { level: 4, format: 'decimal', text: '%1.%2.%3.%4.%5.', alignment: AlignmentType.START },
          ],
        },
        {
          reference: 'lettered-list',
          levels: [
            { level: 0, format: 'lowerLetter', text: '%1)', alignment: AlignmentType.START },
            { level: 1, format: 'lowerLetter', text: '%2)', alignment: AlignmentType.START },
            { level: 2, format: 'lowerLetter', text: '%3)', alignment: AlignmentType.START },
          ],
        },
      ],
    },
  });

  const docxBlob = await Packer.toBlob(doc);
  return docxBlob;
};

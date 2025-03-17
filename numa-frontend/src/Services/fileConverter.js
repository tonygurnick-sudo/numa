import { Document, Packer, Paragraph, HeadingLevel } from 'docx';

const convertMarkdownToDocxParagraphs = (markdown) => {
  const paragraphs = [];
  const lines = markdown.split('\n');
  lines.forEach((line) => {
    if (/^[-*]{3,}$/.test(line.trim())) {
      paragraphs.push(
        new Paragraph({
          text: '',
          border: { bottom: { style: 'single', size: 2, color: '000000' } },
        }),
      );
      return;
    }
    const indentMatch = line.match(/^(\s+)/);
    const indentLevel = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;
    const trimmed = line.trim();
    if (!trimmed) {
      paragraphs.push(new Paragraph(''));
    } else if (/^#{1,6}\s+/.test(trimmed)) {
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
      if (headingMatch) {
        const level = Math.min(headingMatch[1].length, 3);
        const heading =
          level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
        paragraphs.push(new Paragraph({ text: headingMatch[2], heading }));
      }
    } else if (/^[-*]\s+/.test(trimmed)) {
      paragraphs.push(
        new Paragraph({
          text: trimmed.substring(2).trim(),
          bullet: { level: indentLevel },
        }),
      );
    } else if (/^\d+\.\s+/.test(trimmed)) {
      paragraphs.push(
        new Paragraph({
          text: trimmed.replace(/^\d+\.\s+/, '').trim(),
          bullet: { level: indentLevel },
        }),
      );
    } else {
      paragraphs.push(new Paragraph({ text: trimmed }));
    }
  });
  return paragraphs;
};

export const createDocxBlob = async (markdownString, docTitle) => {
  const paragraphs = [
    new Paragraph({ text: docTitle, heading: HeadingLevel.HEADING_1 }),
    ...convertMarkdownToDocxParagraphs(markdownString),
    new Paragraph({
      text: `Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`,
    }),
  ];
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const docxBlob = await Packer.toBlob(doc);
  return docxBlob;
};

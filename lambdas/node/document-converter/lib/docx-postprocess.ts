/**
 * Post-process Pandoc-generated DOCX to fix table column widths.
 *
 * Pandoc distributes GFM pipe table columns evenly regardless of content,
 * producing unreadable narrow columns in wide tables. This module modifies
 * the DOCX XML to enable auto-fit layout so Word/LibreOffice can size
 * columns based on content.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip') as typeof import('adm-zip');

/**
 * Post-process a DOCX buffer to enable auto-fit table layout.
 *
 * Modifies word/document.xml to:
 * 1. Add <w:tblLayout w:type="autofit"/> to every table
 * 2. Set table width to 100% page width (pct/5000)
 *
 * This lets Word/LibreOffice distribute column widths based on cell content
 * rather than Pandoc's equal-width default.
 */
export function postProcessDocxTables(docxBuffer: Buffer): Buffer {
  const zip = new AdmZip(docxBuffer);
  const docEntry = zip.getEntry('word/document.xml');

  if (!docEntry) {
    console.warn('[docx-postprocess] No word/document.xml found, skipping');
    return docxBuffer;
  }

  let xml = docEntry.getData().toString('utf-8');

  // Add autofit layout to every table that doesn't already have one.
  // Match <w:tblPr> blocks and inject <w:tblLayout> if missing.
  // Pandoc output uses the w: namespace prefix declared on the root element,
  // so injected elements must use the same prefix without redeclaring xmlns.
  xml = xml.replace(
    /(<w:tblPr\b[^>]*>)([\s\S]*?)(<\/w:tblPr>)/g,
    (match, open: string, inner: string, close: string) => {
      if (inner.includes('w:tblLayout')) return match;

      // Set table width to 100% page width (pct/5000) instead of auto/0
      let modifiedInner = inner.replace(/<w:tblW[^/]*w:type="auto"[^/]*\/>/, '<w:tblW w:w="5000" w:type="pct" />');

      return `${open}${modifiedInner}<w:tblLayout w:type="autofit" />${close}`;
    }
  );

  zip.updateFile('word/document.xml', Buffer.from(xml, 'utf-8'));
  return zip.toBuffer();
}

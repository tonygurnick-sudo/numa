import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Reference doc is bundled alongside the compiled JS in the Lambda zip
const NOLIA_REFERENCE_DOC_SOURCE = join(__dirname, 'nolia-reference.docx');
const NOLIA_REFERENCE_DOC_TMP = '/tmp/nolia-reference.docx';

/**
 * Copy the bundled reference doc to /tmp/ (Lambda writable dir) if not already there.
 * Pandoc reads from this path during conversion.
 */
export function getNoliaReferenceDoc(): string {
  if (!existsSync(NOLIA_REFERENCE_DOC_TMP)) {
    copyFileSync(NOLIA_REFERENCE_DOC_SOURCE, NOLIA_REFERENCE_DOC_TMP);
  }
  return NOLIA_REFERENCE_DOC_TMP;
}

/**
 * Preprocess markdown for Nolia-styled output:
 * 1. Strip horizontal rules (heading styles provide visual separation)
 * 2. Force hard line breaks between consecutive bold-label lines (metadata blocks)
 * 3. Insert subtitle after the H1 title
 */
export function preprocessNoliaMarkdown(markdown: string): string {
  // Strip horizontal rules (---) — heading styles provide enough visual separation
  let processed = markdown.replace(/^\s*---\s*$/gm, '');

  // GFM treats single newlines as soft breaks — consecutive **Label:** lines
  // get merged into one paragraph. Add trailing two-spaces for hard line breaks.
  processed = processed.replace(/(\*\*[^*]+:\*\*[^\n]*)\n(?=\*\*[^*]+:\*\*)/g, '$1  \n');

  // Insert subtitle after the first H1
  const lines = processed.split('\n');
  const h1Index = lines.findIndex((l) => /^# /.test(l));

  if (h1Index !== -1) {
    lines.splice(h1Index + 1, 0, '', 'Nolia Document Validation Assessment', '');
  }

  return lines.join('\n');
}

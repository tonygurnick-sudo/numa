import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';

// v3.x of @shelf/aws-lambda-libreoffice and node-pandoc are CommonJS packages
// Note: `require` is provided by esbuild banner via createRequire (see package.json build script)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { convertTo } = require('@shelf/aws-lambda-libreoffice') as {
  convertTo: (filename: string, format: string) => Promise<string>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePandoc = require('node-pandoc') as (
  src: string,
  args: string,
  callback: (err: Error | null, result: string | boolean) => void,
) => void;

/**
 * Promisified wrapper around node-pandoc
 */
function runPandoc(src: string, args: string): Promise<string | boolean> {
  return new Promise((resolve, reject) => {
    nodePandoc(src, args, (err: Error | null, result: string | boolean) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Convert GitHub-flavored markdown to DOCX using Pandoc
 */
export async function convertMdToDocx(markdown: string): Promise<Buffer> {
  const inputPath = '/tmp/input.md';
  const outputPath = '/tmp/output.docx';

  try {
    // Write markdown to temp file
    writeFileSync(inputPath, markdown, 'utf-8');

    // Convert using Pandoc with GitHub-flavored markdown
    // Pandoc binary is provided by Lambda layer at /opt/bin/pandoc
    await runPandoc(inputPath, `-f gfm -t docx -o ${outputPath}`);

    // Read and return the result
    const result = readFileSync(outputPath);
    return result;
  } finally {
    // Cleanup temp files
    cleanup(inputPath, outputPath);
  }
}

/**
 * Convert GitHub-flavored markdown to PDF using Pandoc + LibreOffice
 * Two-step process: MD -> DOCX -> PDF
 */
export async function convertMdToPdf(markdown: string): Promise<Buffer> {
  const inputPath = '/tmp/input.md';
  const docxPath = '/tmp/intermediate.docx';

  try {
    // Step 1: Convert MD to DOCX
    writeFileSync(inputPath, markdown, 'utf-8');
    await runPandoc(inputPath, `-f gfm -t docx -o ${docxPath}`);

    // Step 2: Convert DOCX to PDF using LibreOffice
    // Note: convertTo expects filename only, it prepends /tmp/ internally
    const pdfPath = await convertTo('intermediate.docx', 'pdf');

    // Read and return the result
    const result = readFileSync(pdfPath);
    return result;
  } finally {
    // Cleanup temp files
    cleanup(inputPath, docxPath);
    // Note: LibreOffice creates the PDF in /tmp, cleanup handled by Lambda container
  }
}

/**
 * Convert DOCX to PDF using LibreOffice directly
 */
export async function convertDocxToPdf(docxBuffer: Buffer): Promise<Buffer> {
  const inputPath = '/tmp/input.docx';

  try {
    // Write DOCX to temp file
    writeFileSync(inputPath, docxBuffer);

    // Convert using LibreOffice
    // Note: convertTo expects filename only, it prepends /tmp/ internally
    const pdfPath = await convertTo('input.docx', 'pdf');

    // Read and return the result
    const result = readFileSync(pdfPath);
    return result;
  } finally {
    // Cleanup temp files
    cleanup(inputPath);
    // Note: LibreOffice creates the PDF in /tmp, cleanup handled by Lambda container
  }
}

/**
 * Convert PDF to DOCX using LibreOffice directly
 * Note: Quality may vary - PDF is a presentation format, not editable.
 * Complex layouts, images, and tables may not convert cleanly.
 * Scanned PDFs won't work (need OCR first).
 */
export async function convertPdfToDocx(pdfBuffer: Buffer): Promise<Buffer> {
  const inputPath = '/tmp/input.pdf';

  try {
    // Write PDF to temp file
    writeFileSync(inputPath, pdfBuffer);

    // Convert using LibreOffice
    // Note: convertTo expects filename only, it prepends /tmp/ internally
    const docxPath = await convertTo('input.pdf', 'docx');

    // Read and return the result
    const result = readFileSync(docxPath);
    return result;
  } finally {
    // Cleanup temp files
    cleanup(inputPath);
    // Note: LibreOffice creates the DOCX in /tmp, cleanup handled by Lambda container
  }
}

/**
 * Cleanup temporary files
 */
function cleanup(...paths: string[]): void {
  for (const filePath of paths) {
    if (filePath && existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch (error) {
        console.warn(`Failed to cleanup ${filePath}:`, error);
      }
    }
  }
}

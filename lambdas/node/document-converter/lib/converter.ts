import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { postProcessDocxTables } from './docx-postprocess.js';

// v3.x of @shelf/aws-lambda-libreoffice and node-pandoc are CommonJS packages
// Note: `require` is provided by esbuild banner via createRequire (see package.json build script)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { unpack } = require('@shelf/aws-lambda-libreoffice') as {
  unpack: (opts: { inputPath: string }) => Promise<string>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePandoc = require('node-pandoc') as (
  src: string,
  args: string,
  callback: (err: Error | null, result: string | boolean) => void
) => void;

const SOFFICE_BIN = '/tmp/instdir/program/soffice.bin';
const LO_ARGS = '--headless --invisible --nodefault --nolockcheck --nologo --norestore --nofirststartwizard';
const LO_USER_PROFILE = 'file:///tmp/lo_profile';

/**
 * Ensure LibreOffice environment is ready:
 * 1. Unpack the binary from the Lambda layer (idempotent)
 * 2. Create fontconfig so LO can resolve fonts
 * 3. Create a dedicated user profile directory
 */
async function ensureLibreOffice(): Promise<void> {
  await unpack({ inputPath: '/opt/lo.tar.br' });

  // Fontconfig — prevents "Cannot load default config file" warning
  const fcPath = '/tmp/fonts.conf';
  if (!existsSync(fcPath)) {
    const cachedir = '/tmp/fontconfig-cache';
    if (!existsSync(cachedir)) mkdirSync(cachedir, { recursive: true });
    writeFileSync(
      fcPath,
      `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>/tmp/instdir/share/fonts</dir>
  <dir>/tmp/instdir/share/fonts/truetype</dir>
  <dir>/usr/share/fonts</dir>
  <cachedir>${cachedir}</cachedir>
</fontconfig>`,
      'utf-8'
    );
    process.env.FONTCONFIG_FILE = fcPath;
  }

  // User profile — isolate LO state from prior invocations
  const profileDir = '/tmp/lo_profile';
  if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });
}

/**
 * Wipe and recreate the LibreOffice user profile.
 * Exit 81 typically signals stale profile state surviving across warm starts —
 * resetting the profile and retrying clears the flake without a cold start.
 */
function resetLibreOfficeProfile(): void {
  const profileDir = '/tmp/lo_profile';
  if (existsSync(profileDir)) {
    rmSync(profileDir, { recursive: true, force: true });
  }
  mkdirSync(profileDir, { recursive: true });
}

/**
 * Run LibreOffice conversion directly with full error visibility.
 * Bypasses the @shelf/aws-lambda-libreoffice `convertTo` wrapper which
 * swallows stderr, has opaque retry logic, and deletes the input file.
 *
 * Uses --env:UserInstallation to set a clean, explicit user profile path.
 * LO 6.4 (the Lambda layer version) has PDF export bugs that surface when
 * the default profile at $HOME/.config is absent or incomplete on cold starts.
 *
 * Retries once on exit 81 (profile-state flake), wiping /tmp/lo_profile first.
 */
function runLibreOffice(inputPath: string, format: string, outdir = '/tmp'): string {
  const cmd =
    `cd /tmp && ${SOFFICE_BIN} ${LO_ARGS}` +
    ` "-env:UserInstallation=${LO_USER_PROFILE}"` +
    ` --convert-to ${format} --outdir ${outdir} ${inputPath}`;

  const attempt = (): { stdout: string; stderr: string } => {
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 90000, stdio: ['pipe', 'pipe', 'pipe'] });
      return { stdout: out, stderr: '' };
    } catch (error: unknown) {
      const e = error as { stdout?: string; stderr?: string; status?: number };
      const stdout = e.stdout || '';
      const stderr = e.stderr || '';
      console.error(`[LibreOffice] exit ${e.status}, stdout: ${stdout.trim()}, stderr: ${stderr.trim()}`);

      // Exit 81: profile-state flake. Wipe profile and retry once.
      // Production traces show same-params alternating success/failure with no
      // useful diagnostic; the only thing that distinguishes the two is
      // residual state in /tmp/lo_profile carried across warm starts.
      if (e.status === 81) {
        console.warn(`[LibreOffice] exit 81 — wiping /tmp/lo_profile and retrying once`);
        resetLibreOfficeProfile();
        try {
          const retryOut = execSync(cmd, {
            encoding: 'utf8',
            timeout: 90000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          console.log(`[LibreOffice] retry succeeded after profile reset`);
          return { stdout: retryOut, stderr: '' };
        } catch (retryError: unknown) {
          const re = retryError as { stdout?: string; stderr?: string; status?: number };
          const retryStdout = re.stdout || '';
          const retryStderr = re.stderr || '';
          console.error(
            `[LibreOffice] retry exit ${re.status}, stdout: ${retryStdout.trim()}, stderr: ${retryStderr.trim()}`
          );
          const detail = retryStderr.trim() || retryStdout.trim() || '(LibreOffice produced no diagnostic output)';
          throw new Error(
            `LibreOffice conversion failed (exit ${re.status}). ` +
              `Wiped /tmp/lo_profile and retried once — second attempt also failed. ` +
              `File: ${inputPath}. Detail: ${detail}`
          );
        }
      }

      const detail = stderr.trim() || stdout.trim() || '(LibreOffice produced no diagnostic output)';
      throw new Error(`LibreOffice failed (exit ${e.status}). File: ${inputPath}. Detail: ${detail}`);
    }
  };

  const { stdout, stderr } = attempt();
  if (stderr) console.warn(`[LibreOffice] stderr: ${stderr.trim()}`);

  // Derive expected output path from input filename
  const basename = inputPath
    .split('/')
    .pop()!
    .replace(/\.\w+$/, `.${format}`);
  const outputPath = `${outdir}/${basename}`;

  if (!existsSync(outputPath)) {
    console.error(`[LibreOffice] stdout: ${stdout.trim()}`);
    throw new Error(`LibreOffice produced no output. Expected: ${outputPath}`);
  }

  return outputPath;
}

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
 * Convert GitHub-flavored markdown to DOCX using Pandoc.
 * Optionally accepts a reference DOCX for custom styling (fonts, headers, footers).
 */
export async function convertMdToDocx(markdown: string, referenceDoc?: string): Promise<Buffer> {
  const inputPath = '/tmp/input.md';
  const outputPath = '/tmp/output.docx';

  try {
    // Write markdown to temp file
    writeFileSync(inputPath, markdown, 'utf-8');

    // Convert using Pandoc with GitHub-flavored markdown
    // Pandoc binary is provided by Lambda layer at /opt/bin/pandoc
    const refDocArg = referenceDoc ? ` --reference-doc=${referenceDoc}` : '';
    await runPandoc(inputPath, `-f gfm -t docx -o ${outputPath}${refDocArg}`);

    // Post-process: fix table column widths (Pandoc sets equal widths, we want auto-fit)
    const raw = readFileSync(outputPath);
    const result = postProcessDocxTables(raw);
    return result;
  } finally {
    // Cleanup temp files
    cleanup(inputPath, outputPath);
  }
}

/**
 * Convert GitHub-flavored markdown to PDF using Pandoc + LibreOffice.
 * Primary path: MD → DOCX (with optional reference doc) → PDF
 * Fallback: MD → HTML → PDF (when LibreOffice fails on DOCX content)
 */
export async function convertMdToPdf(markdown: string, referenceDoc?: string): Promise<Buffer> {
  const inputPath = '/tmp/input.md';
  const docxPath = '/tmp/intermediate.docx';
  const pdfPath = '/tmp/intermediate.pdf';
  const htmlPath = '/tmp/intermediate.html';

  try {
    console.log(`[convertMdToPdf] Markdown: ${markdown.length} chars`);
    await ensureLibreOffice();

    // Strip internal anchor links [text](#anchor) → text
    // LibreOffice 6.4 (Lambda layer) crashes on DOCX internal hyperlinks during PDF export.
    // These are only TOC links — no value in a PDF. External links are preserved.
    const sanitized = markdown.replace(/\[([^\]]+)\]\(#[^)]+\)/g, '$1');

    writeFileSync(inputPath, sanitized, 'utf-8');

    // Primary path: MD → DOCX → PDF
    const refDocArg = referenceDoc ? ` --reference-doc=${referenceDoc}` : '';
    await runPandoc(inputPath, `-f gfm -t docx -o ${docxPath}${refDocArg}`);

    const rawDocx = readFileSync(docxPath);
    const processedDocx = postProcessDocxTables(rawDocx);
    writeFileSync(docxPath, processedDocx);
    console.log(`[convertMdToPdf] DOCX: ${processedDocx.length} bytes`);

    try {
      const convertedPath = runLibreOffice(docxPath, 'pdf');
      const result = readFileSync(convertedPath);
      console.log(`[convertMdToPdf] PDF: ${result.length} bytes (DOCX path)`);
      return result;
    } catch (docxPdfError) {
      const msg = docxPdfError instanceof Error ? docxPdfError.message : String(docxPdfError);
      console.warn(`[convertMdToPdf] DOCX→PDF failed: ${msg}, trying HTML fallback`);
    }

    // Fallback: MD → HTML → PDF via LibreOffice
    // Uses execSync for Pandoc instead of node-pandoc because node-pandoc
    // treats Pandoc stderr warnings as errors (e.g. "[WARNING] This document...")
    writeFileSync(inputPath, sanitized, 'utf-8');
    try {
      execSync(`/opt/bin/pandoc -f gfm -t html5 --standalone -o ${htmlPath} ${inputPath}`, {
        encoding: 'utf8',
        timeout: 30000,
      });
    } catch (pandocError: unknown) {
      const err = pandocError as { status?: number };
      if (err.status && err.status !== 0) {
        throw new Error(`Pandoc HTML conversion failed (exit ${err.status})`);
      }
    }
    console.log(`[convertMdToPdf] Falling back to HTML→PDF`);

    // Clean any stale output from the failed primary path
    if (existsSync(pdfPath)) {
      unlinkSync(pdfPath);
    }

    try {
      const convertedPath = runLibreOffice(htmlPath, 'pdf');
      const result = readFileSync(convertedPath);
      console.log(`[convertMdToPdf] PDF: ${result.length} bytes (HTML fallback)`);
      return result;
    } catch (htmlPdfError) {
      const msg = htmlPdfError instanceof Error ? htmlPdfError.message : String(htmlPdfError);
      throw new Error(
        `PDF conversion failed via both DOCX and HTML paths. ` +
          `Markdown: ${markdown.length} chars. HTML error: ${msg}`
      );
    }
  } finally {
    cleanup(inputPath, docxPath, pdfPath, htmlPath);
  }
}

/**
 * Convert DOCX to PDF using LibreOffice directly
 */
export async function convertDocxToPdf(docxBuffer: Buffer): Promise<Buffer> {
  const inputPath = '/tmp/input.docx';

  try {
    await ensureLibreOffice();
    writeFileSync(inputPath, docxBuffer);
    const pdfPath = runLibreOffice(inputPath, 'pdf');
    return readFileSync(pdfPath);
  } finally {
    cleanup(inputPath, '/tmp/input.pdf');
  }
}

/**
 * Convert any LibreOffice-compatible format to PDF.
 * Accepts the original file extension (e.g. ".pptx", ".doc", ".odt") so that
 * LibreOffice can identify the input format correctly.
 */
export async function convertGenericToPdf(inputBuffer: Buffer, extension: string): Promise<Buffer> {
  const inputFilename = `input${extension}`;
  const inputPath = `/tmp/${inputFilename}`;

  try {
    await ensureLibreOffice();
    writeFileSync(inputPath, inputBuffer);
    const pdfPath = runLibreOffice(inputPath, 'pdf');
    return readFileSync(pdfPath);
  } finally {
    cleanup(inputPath, `/tmp/input.pdf`);
  }
}

/**
 * Convert PDF to DOCX using LibreOffice directly
 */
export async function convertPdfToDocx(pdfBuffer: Buffer): Promise<Buffer> {
  const inputPath = '/tmp/input.pdf';

  try {
    await ensureLibreOffice();
    writeFileSync(inputPath, pdfBuffer);
    const docxPath = runLibreOffice(inputPath, 'docx');
    return readFileSync(docxPath);
  } finally {
    cleanup(inputPath, '/tmp/input.docx');
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

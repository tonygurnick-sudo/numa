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
 * Cache a "fully initialized" Promise per container so warmup runs at most once.
 * Each Lambda container has its own state; this lives until the container is
 * recycled.
 */
let libreOfficeWarmup: Promise<void> | null = null;

/**
 * Ensure LibreOffice environment is ready and fully initialized.
 *
 * Cold-start race fix: under concurrent burst (15+ simultaneous cold starts),
 * the first `--convert-to` invocation on a fresh container reliably failed
 * ~50% of the time with exit 81 and no diagnostic output. `soffice --version`
 * succeeds even in this state — different code path. Doing an actual text →
 * PDF conversion as the warmup probe exercises the filter system, font
 * loading, and profile init — the exact paths the real failure happens on.
 *
 * The probe runs up to 3 times with backoff (2s, 4s) since the cold-start
 * race itself can hit it. By the time `convertGenericToPdf` is called, a
 * successful conversion has already happened in this container.
 *
 * Steps (memoized — runs once per container life):
 *   1. Unpack the binary from the Lambda layer (idempotent)
 *   2. Create fontconfig so LO can resolve fonts
 *   3. Create a dedicated user profile directory
 *   4. Convert a 1-byte text file to PDF as the readiness probe
 *
 * Validated on nd-labs 2026-05-12: 30/30 concurrent cold starts succeed
 * (vs 16/30 pre-fix, vs 15/30 with a `--version`-only probe).
 */
async function ensureLibreOffice(): Promise<void> {
  if (libreOfficeWarmup) return libreOfficeWarmup;

  libreOfficeWarmup = (async (): Promise<void> => {
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

    // Cold-start warmup probe: do a real tiny conversion. `--version` succeeds
    // even when conversion will fail (different code path), so it's not a
    // reliable readiness signal. A real text → PDF conversion exercises the
    // filter system, font loading, profile init — everything that exit 81
    // failures are sensitive to. Retry the probe up to 3 times with backoff
    // since the cold-start race itself can hit it.
    const probeIn = '/tmp/warmup-probe.txt';
    const probeOutDir = '/tmp/warmup-probe-out';
    if (!existsSync(probeOutDir)) mkdirSync(probeOutDir, { recursive: true });
    writeFileSync(probeIn, 'warmup', 'utf-8');

    let probeOk = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const t0 = Date.now();
        execSync(
          `${SOFFICE_BIN} ${LO_ARGS} "-env:UserInstallation=${LO_USER_PROFILE}" --convert-to pdf --outdir ${probeOutDir} ${probeIn}`,
          { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        console.log(`[LibreOffice warmup] ready in ${Date.now() - t0}ms (attempt ${attempt})`);
        probeOk = true;
        break;
      } catch (e) {
        const err = e as { status?: number; stderr?: string };
        console.warn(
          `[LibreOffice warmup] probe attempt ${attempt}/3 failed (exit ${err.status}): ${err.stderr || '(no stderr)'}`
        );
        if (attempt < 3) {
          // Wipe profile + back off before retry
          resetLibreOfficeProfile();
          execSync(`sleep ${attempt * 2}`); // 2s, 4s
        }
      }
    }
    // Cleanup probe artifacts (best-effort)
    try {
      unlinkSync(probeIn);
      rmSync(probeOutDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    if (!probeOk) {
      // All 3 probe attempts failed — reset the cache so the next request
      // re-tries init (might hit a fresher container in the pool) and let
      // the real conversion's retry logic catch any residual flake.
      console.error(`[LibreOffice warmup] all 3 probes failed; releasing warmup cache`);
      libreOfficeWarmup = null;
    }
  })();

  return libreOfficeWarmup;
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

      // Exit 81 on Lambda's LO 6.4: most common cause is an incomplete
      // initialization on cold-start under concurrent load. The pre-warm in
      // ensureLibreOffice() handles most of this; this retry is the residual
      // safety net. Wipe profile, sleep briefly to let any half-initialized
      // state settle, then retry.
      if (e.status === 81) {
        console.warn(`[LibreOffice] exit 81 — wiping /tmp/lo_profile and retrying once`);
        resetLibreOfficeProfile();
        // 500ms settle: in the original failure traces both attempts failed
        // back-to-back at ~5s each, suggesting a stateful issue that needs
        // time to unwind rather than an immediate retry.
        execSync('sleep 0.5');
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

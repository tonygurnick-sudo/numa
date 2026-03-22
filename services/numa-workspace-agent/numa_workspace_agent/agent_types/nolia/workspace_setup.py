"""Nolia workspace setup — pre-pipeline data preparation.

Downloads knowledge base files from the DATA bucket, resolves the output
template, and creates the workspace directory structure before any pipeline
phase runs.

Called by the orchestrator with Nolia-specific metadata (assessment_type,
KB names, etc.) extracted from ``request_metadata``.
"""

import asyncio
import json
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import boto3
import structlog

logger = structlog.get_logger()

# Workspace paths
WORKDIR = Path("/workdir")
TMP_DIR = WORKDIR / "tmp"
OUTPUTS_DIR = WORKDIR / "outputs"
KB_DIR = WORKDIR / "knowledge-bases"
UPLOADS_DIR = WORKDIR / "uploads"

# Bundled template (inside the Docker image, read-only)
BUNDLED_TEMPLATE = Path(__file__).parent / "templates" / "output-template.md"

# Environment
DATA_BUCKET = os.environ.get("DATA_BUCKET_NAME", "")
OUTPUTS_BUCKET = os.environ.get("OUTPUTS_BUCKET_NAME", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
EXTRACT_LAMBDA_ARN = os.environ.get("EXTRACT_CONTENT_LAMBDA_ARN", "")
DOCUMENT_CONVERTER_LAMBDA = os.environ.get("DOCUMENT_CONVERTER_LAMBDA_NAME", "")

# Extraction concurrency (matches V1 Step Function MaxConcurrency: 10)
MAX_EXTRACT_CONCURRENCY = 10

# File extensions that can be converted to PDF via the document-converter Lambda.
# Matches the LibreOffice-supported formats in the converter.
CONVERTIBLE_EXTENSIONS = {
    ".doc",
    ".docx",
    ".pptx",
    ".ppt",
    ".xls",
    ".xlsx",
    ".odt",
    ".odp",
    ".ods",
    ".rtf",
    ".key",
    ".numbers",
    ".pages",
}

# Standard S3 source folders used by the Nolia whitelabel wizard.
# All KB types try these; if none have files, fall back to the old
# category-specific folder name (e.g. "global-knowledge-base/").
KB_SOURCE_FOLDERS = ["documents", "pre-rfx", "rfx", "supporting"]


def _get_s3_client():
    return boto3.client("s3", region_name=AWS_REGION)


async def setup_nolia_workspace(
    user_sub: str,
    conversation_id: str,
    *,
    assessment_type: str = "evaluation-report",
    global_kb: str = "",
    procurement_kb: str = "",
    project_kb: str = "",
) -> None:
    """Set up the workspace for a Nolia compliance review run.

    Creates directories, downloads KB files from the data bucket, and
    resolves the output template.

    Args:
        user_sub: Cognito user sub.
        conversation_id: Conversation/run ID.
        assessment_type: "evaluation-report" or "terms-of-reference".
        global_kb: Name of the global knowledge base folder in the data bucket.
        procurement_kb: Name of the procurement KB folder (for evaluation-report).
        project_kb: Name of the project KB folder (for terms-of-reference).
    """
    logger.info(
        "Setting up Nolia workspace",
        _name="NOLIA_WORKSPACE_SETUP",
        phase="pipeline",
        assessment_type=assessment_type,
        global_kb=global_kb,
        procurement_kb=procurement_kb,
        project_kb=project_kb,
    )

    # 1. Create directory structure
    for d in [TMP_DIR, OUTPUTS_DIR, KB_DIR, UPLOADS_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    if not DATA_BUCKET:
        logger.warning(
            "DATA_BUCKET_NAME not set — skipping KB download",
            _name="NOLIA_NO_DATA_BUCKET",
            phase="pipeline",
        )
        return

    s3 = _get_s3_client()

    # 2. Download knowledge base files
    if global_kb:
        _download_kb(s3, global_kb, "global-knowledge-base", "global-rules.md")

    if assessment_type == "evaluation-report" and procurement_kb:
        _download_kb(
            s3, procurement_kb, "procurement-knowledge-base", "procurement-rules.md"
        )
    elif assessment_type == "terms-of-reference" and project_kb:
        _download_kb(s3, project_kb, "project-knowledge-base", "project-rules.md")

    # 3. Resolve output template
    _resolve_output_template(s3, assessment_type, global_kb, procurement_kb, project_kb)

    logger.info(
        "Nolia workspace setup complete",
        _name="NOLIA_WORKSPACE_SETUP_COMPLETE",
        phase="pipeline",
    )


def _download_kb(
    s3,
    kb_name: str,
    kb_type: str,
    rules_filename: str,
) -> None:
    """Download a knowledge base folder and its rules file from the data bucket.

    Tries all standard S3 source folders (documents/, pre-rfx/, rfx/,
    supporting/) first.  If none contain files, falls back to the legacy
    category-specific folder name (e.g. ``global-knowledge-base/``).

    All downloaded files land in ``/workdir/knowledge-bases/{kb_type}/``.
    """
    target_dir = KB_DIR / kb_type
    target_dir.mkdir(parents=True, exist_ok=True)

    total_downloaded = 0

    # Try all standard folders (new wizard structure).
    # Preserve subfolder structure so the agent sees pre-rfx/, rfx/, etc.
    for folder in KB_SOURCE_FOLDERS:
        kb_prefix = f"documents/kb-{kb_name}/{folder}/"
        folder_dir = target_dir / folder
        folder_dir.mkdir(parents=True, exist_ok=True)
        downloaded = _download_s3_prefix(s3, DATA_BUCKET, kb_prefix, folder_dir)
        total_downloaded += downloaded
        if downloaded > 0:
            logger.info(
                f"Downloaded {downloaded} files from {folder}/",
                _name="NOLIA_KB_DOWNLOAD_FOLDER",
                phase="pipeline",
                kb_name=kb_name,
                folder=folder,
                files_downloaded=downloaded,
            )

    # Fallback: old category-specific folder name (flat into target_dir)
    if total_downloaded == 0:
        kb_prefix = f"documents/kb-{kb_name}/{kb_type}/"
        total_downloaded = _download_s3_prefix(s3, DATA_BUCKET, kb_prefix, target_dir)

    logger.info(
        f"Downloaded {total_downloaded} total KB files",
        _name="NOLIA_KB_DOWNLOAD",
        phase="pipeline",
        kb_name=kb_name,
        kb_type=kb_type,
        files_downloaded=total_downloaded,
    )

    # Download rules file (always at root level of the KB prefix)
    rules_key = f"documents/kb-{kb_name}/{rules_filename}"
    rules_path = KB_DIR / rules_filename
    try:
        s3.download_file(DATA_BUCKET, rules_key, str(rules_path))
        logger.info(
            "Downloaded rules file",
            _name="NOLIA_RULES_DOWNLOAD",
            phase="pipeline",
            rules_key=rules_key,
        )
    except Exception as e:
        logger.warning(
            "Rules file not found — phase will proceed without it",
            _name="NOLIA_RULES_NOT_FOUND",
            phase="pipeline",
            rules_key=rules_key,
            error=str(e),
        )


def _download_s3_prefix(s3, bucket: str, prefix: str, target_dir: Path) -> int:
    """Download all objects under an S3 prefix to a local directory."""
    paginator = s3.get_paginator("list_objects_v2")
    downloaded = 0

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            relative = key[len(prefix) :]
            if not relative:
                continue

            local_path = target_dir / relative
            local_path.parent.mkdir(parents=True, exist_ok=True)

            s3.download_file(bucket, key, str(local_path))
            downloaded += 1

    return downloaded


def _resolve_output_template(
    s3,
    assessment_type: str,
    global_kb: str,
    procurement_kb: str,
    project_kb: str,
) -> None:
    """Resolve the output template: custom from S3 or bundled default.

    Priority order:
    1. Domain-specific KB template (procurement or project)
    2. Global KB template
    3. Bundled default template

    For each KB, checks the new ``templates/`` subfolder first, then
    falls back to the legacy ``output-template.md`` at the KB root.
    """
    template_dest = WORKDIR / "output-template.md"

    domain_kb = procurement_kb if assessment_type == "evaluation-report" else project_kb
    kbs_to_check = [kb for kb in [domain_kb, global_kb] if kb]

    for kb_name in kbs_to_check:
        # Try new structure: first file in templates/ subfolder
        if _download_first_template(s3, kb_name, template_dest):
            return

        # Try legacy structure: output-template.md at KB root
        legacy_key = f"documents/kb-{kb_name}/output-template.md"
        try:
            s3.download_file(DATA_BUCKET, legacy_key, str(template_dest))
            logger.info(
                "Using custom output template (legacy path)",
                _name="NOLIA_CUSTOM_TEMPLATE",
                phase="pipeline",
                template_key=legacy_key,
            )
            return
        except Exception:
            continue

    # Bundled default
    if BUNDLED_TEMPLATE.exists():
        shutil.copy2(str(BUNDLED_TEMPLATE), str(template_dest))
        logger.info(
            "Using bundled output template",
            _name="NOLIA_BUNDLED_TEMPLATE",
            phase="pipeline",
        )
    else:
        logger.warning(
            "No output template found (custom or bundled)",
            _name="NOLIA_NO_TEMPLATE",
            phase="pipeline",
        )


def _download_first_template(s3, kb_name: str, dest: Path) -> bool:
    """Download the first file from the ``templates/`` subfolder of a KB.

    Returns True if a file was found and downloaded, False otherwise.
    """
    templates_prefix = f"documents/kb-{kb_name}/templates/"
    paginator = s3.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=DATA_BUCKET, Prefix=templates_prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/"):
                continue
            s3.download_file(DATA_BUCKET, key, str(dest))
            logger.info(
                "Using custom output template from templates/",
                _name="NOLIA_CUSTOM_TEMPLATE",
                phase="pipeline",
                template_key=key,
                kb_name=kb_name,
            )
            return True

    return False


# ── Document Conversion ──────────────────────────────────────────────────────
#
# Converts non-PDF documents (DOCX, DOC, PPTX, etc.) to PDF via the
# document-converter Lambda (LibreOffice-based). The converted PDF is then
# fed into the standard chunked vision extraction pipeline below.


async def _convert_to_pdf(
    original_file: Path,
    s3_bucket: str,
    s3_key: str,
    s3_prefix: str,
) -> tuple[Path, str]:
    """Convert a non-PDF document to PDF via the document-converter Lambda.

    Args:
        original_file: Local path to the uploaded file.
        s3_bucket: S3 bucket containing the original file.
        s3_key: S3 key of the original file.
        s3_prefix: S3 prefix for this run (for storing the converted PDF).

    Returns:
        Tuple of (local PDF path, S3 key of converted PDF).
    """
    import urllib.request

    from botocore.config import Config

    logger.info(
        "Converting document to PDF",
        _name="NOLIA_CONVERT_START",
        phase="pipeline",
        file=original_file.name,
        suffix=original_file.suffix,
    )

    lambda_client = boto3.client(
        "lambda",
        region_name=AWS_REGION,
        config=Config(read_timeout=300, connect_timeout=10),
    )

    converter_payload = json.dumps(
        {
            "body": json.dumps(
                {
                    "action": "file",
                    "format": "pdf",
                    "sourceBucket": s3_bucket,
                    "sourceKey": s3_key,
                }
            )
        }
    ).encode("utf-8")

    response = lambda_client.invoke(
        FunctionName=DOCUMENT_CONVERTER_LAMBDA,
        InvocationType="RequestResponse",
        Payload=converter_payload,
    )

    response_payload = json.loads(response["Payload"].read())
    body = (
        json.loads(response_payload["body"])
        if "body" in response_payload
        else response_payload
    )

    if not body.get("success"):
        raise RuntimeError(
            f"Document conversion failed for {original_file.name}: "
            f"{body.get('error', 'unknown error')}"
        )

    # Download converted PDF from the presigned URL
    download_url = body["downloadUrl"]
    with urllib.request.urlopen(download_url) as resp:  # noqa: S310
        pdf_bytes = resp.read()

    # Save locally
    pdf_filename = original_file.stem + ".pdf"
    local_pdf_path = UPLOADS_DIR / pdf_filename
    local_pdf_path.write_bytes(pdf_bytes)

    # Upload to S3 so _extract_pdf can reference it
    s3_pdf_key = f"{s3_prefix}/uploads/{pdf_filename}"
    s3 = _get_s3_client()
    s3.put_object(
        Body=pdf_bytes,
        Bucket=s3_bucket,
        Key=s3_pdf_key,
        ContentType="application/pdf",
    )

    logger.info(
        "Document converted to PDF",
        _name="NOLIA_CONVERT_COMPLETE",
        phase="pipeline",
        original=original_file.name,
        pdf=pdf_filename,
        size_bytes=len(pdf_bytes),
        s3_key=s3_pdf_key,
    )

    return local_pdf_path, s3_pdf_key


# ── Document Extraction ──────────────────────────────────────────────────────
#
# Orchestrates parallel vision extraction of PDF documents by calling the
# existing extract-content-from-file Lambda with 3 actions:
#   prepare_chunks → extract_chunk (parallel) → merge_chunks
#
# This replaces the V1 Step Function orchestration (PrepareChunks →
# ExtractChunksMap → MergeChunks) with in-container orchestration.
# The extract-content Lambda handles all vision model calls, rate limiting,
# retry logic, and temp file management.


async def extract_uploaded_document(s3_prefix: str) -> Optional[str]:
    """Extract content from the uploaded document.

    Scans /workdir/uploads/ for supported files. PDFs go directly to
    vision extraction. DOCX and other Office formats are first converted
    to PDF via the document-converter Lambda, then extracted. Pre-extracted
    JSON files skip extraction entirely.

    Args:
        s3_prefix: S3 prefix for this run (e.g., v2-apps/nolia/{user}/{conv}).

    Returns:
        Path to the extracted JSON file in /workdir/uploads/, or None if
        no extraction was needed.
    """
    # Find uploaded files
    uploads = list(UPLOADS_DIR.iterdir()) if UPLOADS_DIR.exists() else []
    pdf_files = [f for f in uploads if f.suffix.lower() == ".pdf"]
    json_files = [f for f in uploads if f.suffix.lower() == ".json"]
    convertible_files = [
        f for f in uploads if f.suffix.lower() in CONVERTIBLE_EXTENSIONS
    ]

    if json_files:
        logger.info(
            "JSON file found — skipping extraction",
            _name="NOLIA_EXTRACT_SKIP_JSON",
            phase="pipeline",
            file=json_files[0].name,
        )
        return str(json_files[0])

    # Convert non-PDF documents to PDF before extraction
    was_converted = False
    if not pdf_files and convertible_files:
        source_file = convertible_files[0]

        if not DOCUMENT_CONVERTER_LAMBDA:
            logger.warning(
                "DOCUMENT_CONVERTER_LAMBDA_NAME not set — cannot convert "
                f"{source_file.suffix} to PDF",
                _name="NOLIA_CONVERT_NO_LAMBDA",
                phase="pipeline",
                file=source_file.name,
            )
            return None

        s3_source_key = f"{s3_prefix}/uploads/{source_file.name}"
        pdf_path, _ = await _convert_to_pdf(
            original_file=source_file,
            s3_bucket=OUTPUTS_BUCKET,
            s3_key=s3_source_key,
            s3_prefix=s3_prefix,
        )
        pdf_files = [pdf_path]
        was_converted = True

    if not pdf_files:
        logger.warning(
            "No PDF, JSON, or convertible files found in uploads",
            _name="NOLIA_EXTRACT_NO_FILE",
            phase="pipeline",
            uploads=[f.name for f in uploads],
        )
        return None

    pdf_file = pdf_files[0]

    if not EXTRACT_LAMBDA_ARN:
        logger.warning(
            "EXTRACT_CONTENT_LAMBDA_ARN not set — cannot extract PDF",
            _name="NOLIA_EXTRACT_NO_LAMBDA",
            phase="pipeline",
        )
        return None

    # The PDF is in S3 at {s3_prefix}/uploads/{filename}
    # (either uploaded by the frontend or placed there by conversion)
    s3_key = f"{s3_prefix}/uploads/{pdf_file.name}"

    logger.info(
        "Starting PDF extraction",
        _name="NOLIA_EXTRACT_START",
        phase="pipeline",
        pdf_file=pdf_file.name,
        s3_key=s3_key,
        was_converted=was_converted,
    )

    output_key = await _extract_pdf(
        s3_bucket=OUTPUTS_BUCKET,
        s3_key=s3_key,
        output_prefix=s3_prefix,
    )

    # Download the extracted JSON to /workdir/uploads/
    local_path = UPLOADS_DIR / "extracted_document.json"
    s3 = _get_s3_client()
    s3.download_file(OUTPUTS_BUCKET, output_key, str(local_path))

    logger.info(
        "PDF extraction complete",
        _name="NOLIA_EXTRACT_COMPLETE",
        phase="pipeline",
        output_key=output_key,
        local_path=str(local_path),
    )

    # Clean up the intermediate converted PDF from S3
    if was_converted:
        try:
            s3.delete_object(Bucket=OUTPUTS_BUCKET, Key=s3_key)
            logger.debug(
                "Cleaned up converted PDF from S3",
                _name="NOLIA_CONVERT_CLEANUP",
                phase="pipeline",
                key=s3_key,
            )
        except Exception:
            logger.warning(
                "Failed to clean up converted PDF from S3",
                _name="NOLIA_CONVERT_CLEANUP_FAIL",
                phase="pipeline",
                key=s3_key,
            )

    return str(local_path)


async def _extract_pdf(s3_bucket: str, s3_key: str, output_prefix: str) -> str:
    """Orchestrate parallel vision extraction of a PDF.

    Calls the extract-content-from-file Lambda with 3 actions:
    1. prepare_chunks — convert pages to images, define chunks
    2. extract_chunk — extract text from each chunk (parallel, max 10)
    3. merge_chunks — combine into final document JSON

    Returns the S3 key of the merged extracted JSON.
    """
    import time

    extract_start = time.monotonic()
    from botocore.config import Config

    lambda_client = boto3.client(
        "lambda",
        region_name=AWS_REGION,
        config=Config(read_timeout=900, connect_timeout=10),
    )

    # Step 1: Prepare chunks
    step1_start = time.monotonic()
    logger.info(
        "Extraction step 1/3: preparing chunks",
        _name="NOLIA_EXTRACT_PREPARE",
        phase="pipeline",
    )
    prepare_result = _invoke_extract_lambda(
        lambda_client,
        {
            "action": "prepare_chunks",
            "input_bucket": s3_bucket,
            "input_key": s3_key,
            "chunk_size": 100,
        },
    )

    chunks = prepare_result["chunks"]
    temp_prefix = prepare_result["temp_prefix"]
    total_pages = prepare_result.get("total_pages", 0)
    step1_dur = time.monotonic() - step1_start

    logger.info(
        "Extraction step 1/3 complete",
        _name="NOLIA_EXTRACT_PREPARE_DONE",
        phase="pipeline",
        total_pages=total_pages,
        num_chunks=len(chunks),
        temp_prefix=temp_prefix,
        duration_s=round(step1_dur, 1),
    )

    # Step 2: Extract chunks in parallel
    step2_start = time.monotonic()
    logger.info(
        f"Extraction step 2/3: extracting {len(chunks)} chunks (max {MAX_EXTRACT_CONCURRENCY} concurrent)",
        _name="NOLIA_EXTRACT_CHUNKS",
        phase="pipeline",
    )

    semaphore = asyncio.Semaphore(MAX_EXTRACT_CONCURRENCY)
    executor = ThreadPoolExecutor(max_workers=MAX_EXTRACT_CONCURRENCY)
    loop = asyncio.get_event_loop()

    async def extract_one(chunk: dict) -> dict:
        chunk_start = time.monotonic()
        async with semaphore:
            result = await loop.run_in_executor(
                executor,
                _invoke_extract_lambda,
                lambda_client,
                {
                    "action": "extract_chunk",
                    "chunk_id": chunk["chunk_id"],
                    "start_page": chunk["start_page"],
                    "end_page": chunk["end_page"],
                    "temp_prefix": temp_prefix,
                    "input_bucket": s3_bucket,
                },
            )
            chunk_dur = time.monotonic() - chunk_start
            logger.debug(
                f"Chunk {chunk['chunk_id']} extracted (pages {chunk['start_page']}-{chunk['end_page']})",
                _name="NOLIA_EXTRACT_CHUNK_DONE",
                phase="pipeline",
                chunk_id=chunk["chunk_id"],
                start_page=chunk["start_page"],
                end_page=chunk["end_page"],
                duration_s=round(chunk_dur, 1),
            )
            return result

    chunk_results = await asyncio.gather(
        *[extract_one(c) for c in chunks],
        return_exceptions=True,
    )

    # Check for errors
    errors = [r for r in chunk_results if isinstance(r, Exception)]
    if errors:
        logger.error(
            "Extraction chunk failures",
            _name="NOLIA_EXTRACT_CHUNK_ERRORS",
            phase="pipeline",
            num_errors=len(errors),
            first_error=str(errors[0]),
        )
        raise RuntimeError(
            f"Extraction failed: {len(errors)} of {len(chunks)} chunks failed. First error: {errors[0]}"
        )

    step2_dur = time.monotonic() - step2_start
    logger.info(
        "Extraction step 2/3 complete",
        _name="NOLIA_EXTRACT_CHUNKS_DONE",
        phase="pipeline",
        chunks_extracted=len(chunk_results),
        duration_s=round(step2_dur, 1),
    )

    # Step 3: Merge chunks
    step3_start = time.monotonic()
    logger.info(
        "Extraction step 3/3: merging chunks",
        _name="NOLIA_EXTRACT_MERGE",
        phase="pipeline",
    )

    output_key = f"{output_prefix}/extracted_document.json"
    merge_result = _invoke_extract_lambda(
        lambda_client,
        {
            "action": "merge_chunks",
            "chunks": list(chunk_results),
            "output_bucket": s3_bucket,
            "output_key": output_key,
            "temp_prefix": temp_prefix,
        },
    )

    executor.shutdown(wait=False)
    step3_dur = time.monotonic() - step3_start
    total_dur = time.monotonic() - extract_start

    logger.info(
        "Extraction timing summary",
        _name="NOLIA_EXTRACT_TIMING",
        phase="pipeline",
        total_pages=total_pages,
        num_chunks=len(chunks),
        step1_prepare_s=round(step1_dur, 1),
        step2_extract_s=round(step2_dur, 1),
        step3_merge_s=round(step3_dur, 1),
        total_s=round(total_dur, 1),
        pages_per_second=round(total_pages / total_dur, 1) if total_dur > 0 else 0,
    )

    return merge_result.get("output_key", output_key)


def _invoke_extract_lambda(lambda_client, payload: dict) -> dict:
    """Invoke extract-content-from-file Lambda synchronously.

    This is a blocking call — use run_in_executor for parallel invocations.
    """
    response = lambda_client.invoke(
        FunctionName=EXTRACT_LAMBDA_ARN,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload),
    )
    result_bytes = response["Payload"].read()
    result = json.loads(result_bytes)

    # Lambda error responses have an errorMessage field
    if isinstance(result, dict) and "errorMessage" in result:
        raise RuntimeError(
            f"Extraction Lambda error (action={payload.get('action')}): "
            f"{result['errorMessage']}"
        )

    return result

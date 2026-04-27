"""Nolia Funding workspace setup — pre-pipeline data preparation.

Entry points:

- ``setup_funding_rules_workspace()`` — for ``nolia-funding-rules-generator``.
  Downloads the Funding KB's selection-criteria, application-form,
  good-examples (optional), output template, and the
  supporting-data-manifest.json (per-file descriptions of the supporting-data
  lookup files) into /workdir/knowledge-bases/. The raw supporting-data
  files themselves are NOT downloaded for rules generation — only their
  manifest entries, which the rules agent uses to emit per-file rules
  describing how each lookup file is consulted during assessment.

- ``pre_extract_kb_documents()`` — also called from the rules-generation
  pipeline (after ``setup_funding_rules_workspace``). Walks every PDF/DOCX
  in the KB's S3 prefix, runs the extract-content Lambda once per file,
  and writes ``{filename}.extracted.json`` sidecars next to the originals
  in S3. Sidecars for rules-relevant subfolders are also downloaded
  locally so the rules agent can read pre-parsed JSON instead of raw
  binaries. Cached sidecars are picked up by every future assessment run
  via ``setup_funding_assess_workspace`` — no per-assessment extraction
  cost for KB content.

- ``setup_funding_assess_workspace()`` — for ``nolia-funding-assess``.
  Downloads the paired Global KB rules, the Funding KB's full contents
  (including supporting-data + manifest + cached ``.extracted.json``
  sidecars), and the output template.

- ``extract_funding_application()`` — applicant uploads. Pre-extracts each
  PDF/DOCX upload to ``extracted_{stem}.json`` for the assessment agent.

- ``setup_funding_compare_workspace()`` — for ``nolia-funding-compare``.
  Downloads prior assessment artefacts for each run being compared, plus the
  Funding KB's output template (for structural context).

Imports a handful of helpers from ``..nolia.workspace_setup`` — S3 client,
prefix download, PDF extraction (simple + chunked), DOCX→PDF conversion.
These are genuinely shared infrastructure, not product-specific logic. If
the cross-package import ever becomes inconvenient, lift them to a
``..nolia_shared`` module.
"""

import asyncio
import json
import os
from pathlib import Path
from typing import Optional

import boto3
import structlog

# Shared S3/extraction helpers. These underscore-prefixed names are still
# considered package-internal but are clearly reusable across Nolia products.
# If duplication pressure arises, promote them to a shared module.
from ..nolia.workspace_setup import (  # noqa: E501
    _convert_to_pdf,
    _download_s3_prefix,
    _extract_pdf,
    _extract_simple,
    _get_s3_client,
)

logger = structlog.get_logger()

# ─── Workspace paths ─────────────────────────────────────────────────────────

WORKDIR = Path("/workdir")
TMP_DIR = WORKDIR / "tmp"
OUTPUTS_DIR = WORKDIR / "outputs"
KB_DIR = WORKDIR / "knowledge-bases"
UPLOADS_DIR = WORKDIR / "uploads"
PRIOR_ASSESSMENTS_DIR = WORKDIR / "prior-assessments"

# ─── Environment ─────────────────────────────────────────────────────────────

DATA_BUCKET = os.environ.get("DATA_BUCKET_NAME", "")
OUTPUTS_BUCKET = os.environ.get("OUTPUTS_BUCKET_NAME", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
EXTRACT_LAMBDA_ARN = os.environ.get("EXTRACT_CONTENT_LAMBDA_ARN", "")
DOCUMENT_CONVERTER_LAMBDA = os.environ.get("DOCUMENT_CONVERTER_LAMBDA_NAME", "")

# Per-run cap on simultaneous _extract_pdf invocations. ``_extract_pdf``
# itself page-chunk-parallelises up to 10 chunks per PDF, so the total
# Lambda concurrency footprint is bounded by this × 10.
MAX_PER_RUN_PDF_CONCURRENCY = 5

# File extensions we pre-extract for the agent. Everything else stays in
# /workdir/uploads/ untouched and the agent reads it directly with the
# appropriate tool (openpyxl for xlsx, native Read for txt/md/csv, etc.).
EXTRACTABLE_EXTENSIONS = {".pdf", ".docx"}

# Above this size we use the chunked extraction path (prepare → extract ×
# N → merge) which was built to dodge the 15-minute Lambda timeout on the
# large reference PDFs in supporting-data. Below it we use the single-call
# default-mode path, which is one Lambda invocation and skips the per-page
# image-staging round trip — a meaningful speed-up for the typical
# applicant upload (CV, transcript, quote — usually a handful of pages).
SIMPLE_EXTRACT_SIZE_THRESHOLD_BYTES = 500 * 1024  # 500 KB

# ─── S3 layout (matches funding-kb-structure.md) ─────────────────────────────

# Subfolders under documents/kb-{kb_id}/ for Funding KBs.
# Folder names are the frontend's `s3Folder` values (see
# `nolia-funding-app/frontend/src/components/kb/wizard/wizard-configs.ts`) —
# do NOT rename these here without also updating the frontend.
FUNDING_KB_SUBFOLDERS = [
    "application-form",
    "selection-criteria",
    "good-examples",
    "supporting-data",
    "templates",
]

# Subfolders under documents/kb-{kb_id}/ that Funding-KB rules generation
# needs. The raw supporting-data/ files (curriculum PDFs, provider spreadsheets,
# etc.) are NOT pulled for rules generation — they are assessment-time lookup
# data, too large/heterogeneous to include in every rules run. Instead, rules
# generation reads the supporting-data-manifest.json (at the KB root, pulled
# separately below) which carries a curated description per file, and emits
# one rule per manifest entry describing how that lookup file is used.
FUNDING_KB_SUBFOLDERS_FOR_RULES = [
    "application-form",
    "selection-criteria",
    "good-examples",
    "templates",
]

# Global KBs are single-step: a flat documents/ folder of org-wide policies.
# No application form, no output template, no good examples, no supporting data.
GLOBAL_KB_SUBFOLDERS_FOR_RULES = [
    "documents",
]

# The generated rules filename at the KB's root level:
FUNDING_RULES_FILENAME = "funding-rules.md"
GLOBAL_RULES_FILENAME = "global-rules.md"
SUPPORTING_DATA_MANIFEST_FILENAME = "supporting-data-manifest.json"

# ─── Common setup ────────────────────────────────────────────────────────────


def _ensure_workspace_dirs() -> None:
    """Create /workdir/ subfolders. Idempotent."""
    for d in [TMP_DIR, OUTPUTS_DIR, KB_DIR, UPLOADS_DIR, PRIOR_ASSESSMENTS_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def _download_file(
    s3, bucket: str, key: str, target: Path, *, optional: bool = False
) -> bool:
    """Download a single S3 object to a local path.

    Returns True on success, False on 404 if ``optional`` (else raises).
    """
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        s3.download_file(bucket, key, str(target))
        return True
    except Exception as e:
        if optional:
            logger.info(
                "Optional file not present — skipping",
                _name="NOLIA_FUNDING_OPTIONAL_MISSING",
                key=key,
                error=str(e),
            )
            return False
        raise


# ─── Entry point: rules generation workspace ─────────────────────────────────


async def setup_funding_rules_workspace(
    user_sub: str,
    conversation_id: str,
    *,
    kb_id: str,
    kb_name: str = "",
    kb_category: str = "funding",
) -> None:
    """Set up workspace for a Nolia Funding rules-generation run.

    Downloads from ``s3://{DATA_BUCKET}/documents/kb-{kb_id}/`` to
    ``/workdir/knowledge-bases/``.

    For Funding KBs (``kb_category="funding"``, default):
      - application-form/
      - selection-criteria/
      - good-examples/  (optional)
      - templates/
      - supporting-data-manifest.json  (KB-root file — curated per-file
        descriptions of the supporting-data lookup files; used by the rules
        agent to emit one rule per lookup file)

    For Global KBs (``kb_category="global"``):
      - documents/  (the single flat folder — Global KBs are 1-step)

    Does NOT download the raw supporting-data/ files themselves (only the
    manifest describing them). Does NOT touch /workdir/uploads/ (rules runs
    have no applicant uploads).
    """
    logger.info(
        "Setting up funding rules workspace",
        _name="NOLIA_FUNDING_RULES_WORKSPACE_SETUP",
        phase="pipeline",
        kb_id=kb_id,
        kb_name=kb_name,
        kb_category=kb_category,
    )

    _ensure_workspace_dirs()

    if not DATA_BUCKET:
        logger.warning(
            "DATA_BUCKET_NAME not set — skipping KB download",
            _name="NOLIA_FUNDING_NO_DATA_BUCKET",
        )
        return

    if not kb_id:
        logger.warning(
            "No kb_id provided — skipping KB download",
            _name="NOLIA_FUNDING_NO_KB_ID",
        )
        return

    subfolders = (
        GLOBAL_KB_SUBFOLDERS_FOR_RULES
        if kb_category == "global"
        else FUNDING_KB_SUBFOLDERS_FOR_RULES
    )

    s3 = _get_s3_client()
    kb_prefix = f"documents/kb-{kb_id}/"

    total_files = 0
    for subfolder in subfolders:
        prefix = f"{kb_prefix}{subfolder}/"
        target_dir = KB_DIR / subfolder
        count = _download_s3_prefix(s3, DATA_BUCKET, prefix, target_dir)
        if count > 0:
            logger.info(
                "Downloaded KB subfolder",
                _name="NOLIA_FUNDING_KB_DOWNLOAD",
                subfolder=subfolder,
                file_count=count,
            )
        total_files += count

    # Funding KBs: also pull the supporting-data-manifest.json from the KB
    # root. This is a small curated JSON (per-file descriptions of the
    # supporting-data lookup files) that the rules agent uses to emit one
    # rule per lookup file. Global KBs don't have a manifest.
    if kb_category != "global":
        manifest_key = f"{kb_prefix}{SUPPORTING_DATA_MANIFEST_FILENAME}"
        manifest_target = KB_DIR / SUPPORTING_DATA_MANIFEST_FILENAME
        if _download_file(
            s3, DATA_BUCKET, manifest_key, manifest_target, optional=True
        ):
            logger.info(
                "Downloaded supporting-data manifest",
                _name="NOLIA_FUNDING_KB_MANIFEST_DOWNLOAD",
                key=manifest_key,
            )
            total_files += 1

    logger.info(
        "Funding rules workspace ready",
        _name="NOLIA_FUNDING_RULES_WORKSPACE_COMPLETE",
        total_files=total_files,
        kb_category=kb_category,
    )


# ─── Entry point: assessment workspace ───────────────────────────────────────


async def setup_funding_assess_workspace(
    user_sub: str,
    conversation_id: str,
    *,
    global_kb_id: str,
    funding_kb_id: str,
) -> None:
    """Set up workspace for a Nolia Funding assessment run.

    Downloads:
      - Global KB's ``global-rules.md``
      - Funding KB's 5 subfolders + ``funding-rules.md`` +
        ``supporting-data-manifest.json``
      - Pre-extracts any PDFs in supporting-data/ to JSON so the assessment
        agent can grep/read extracted content instead of handling raw PDFs
        inline.

    Does NOT download applicant uploads — call
    ``extract_funding_application()`` separately after this completes.
    """
    logger.info(
        "Setting up funding assess workspace",
        _name="NOLIA_FUNDING_ASSESS_WORKSPACE_SETUP",
        phase="pipeline",
        global_kb_id=global_kb_id,
        funding_kb_id=funding_kb_id,
    )

    _ensure_workspace_dirs()

    if not DATA_BUCKET:
        logger.warning(
            "DATA_BUCKET_NAME not set — skipping KB download",
            _name="NOLIA_FUNDING_NO_DATA_BUCKET",
        )
        return

    s3 = _get_s3_client()

    # ── Global KB: just the rules file for now ──────────────────────────────
    if global_kb_id:
        global_rules_key = f"documents/kb-{global_kb_id}/{GLOBAL_RULES_FILENAME}"
        global_rules_path = KB_DIR / GLOBAL_RULES_FILENAME
        downloaded = _download_file(
            s3, DATA_BUCKET, global_rules_key, global_rules_path, optional=True
        )
        if downloaded:
            logger.info(
                "Downloaded global rules",
                _name="NOLIA_FUNDING_GLOBAL_RULES_DOWNLOAD",
                key=global_rules_key,
            )

    # ── Funding KB: everything ──────────────────────────────────────────────
    if not funding_kb_id:
        logger.warning(
            "No funding_kb_id provided — assessment will likely fail",
            _name="NOLIA_FUNDING_NO_FUNDING_KB",
        )
        return

    kb_prefix = f"documents/kb-{funding_kb_id}/"

    # Download all subfolders
    for subfolder in FUNDING_KB_SUBFOLDERS:
        prefix = f"{kb_prefix}{subfolder}/"
        target_dir = KB_DIR / subfolder
        count = _download_s3_prefix(s3, DATA_BUCKET, prefix, target_dir)
        if count > 0:
            logger.info(
                "Downloaded KB subfolder",
                _name="NOLIA_FUNDING_KB_DOWNLOAD",
                subfolder=subfolder,
                file_count=count,
            )

    # Download funding-rules.md and supporting-data-manifest.json at KB root
    for filename, optional in [
        (FUNDING_RULES_FILENAME, False),
        (SUPPORTING_DATA_MANIFEST_FILENAME, True),
    ]:
        key = f"{kb_prefix}{filename}"
        target = KB_DIR / filename
        _download_file(s3, DATA_BUCKET, key, target, optional=optional)

    # KB PDF/DOCX sidecars (`{name}.extracted.json`) are produced once at
    # rules-generation time by ``pre_extract_kb_documents`` and stored in the
    # data bucket alongside the originals. The ``_download_s3_prefix`` calls
    # above pick them up automatically — no per-assessment extraction needed.

    logger.info(
        "Funding assess workspace ready",
        _name="NOLIA_FUNDING_ASSESS_WORKSPACE_COMPLETE",
    )


async def pre_extract_kb_documents(
    kb_id: str,
    kb_category: str = "funding",
) -> dict:
    """Pre-extract every PDF/DOCX in the KB's S3 prefix and write
    ``{filename}.extracted.json`` sidecars next to the originals.

    Called from the rules-generation orchestrator after the KB has been
    downloaded for the rules agent. Walks the data bucket directly (no
    reliance on local copies — supporting-data isn't downloaded at rules-gen
    time but we still want its sidecars cached for assessment).

    Per file, branches on size:
      - PDF ≤ ``SIMPLE_EXTRACT_SIZE_THRESHOLD_BYTES`` → single-call Lambda.
      - PDF >  threshold → chunked path (``_extract_pdf``) + S3 copy to
        the final sidecar key (chunked merge writes to its own temp key).
      - DOCX → always single-call (Lambda handles convert internally).
        KB DOCX files are forms/templates and tend to be small; if a giant
        DOCX hits the 15-min timeout, the per-file failure is logged and
        the rest of the KB still extracts.

    For "rules-relevant" subfolders (everything except ``supporting-data/``),
    the resulting sidecar is also downloaded to
    ``/workdir/knowledge-bases/{subfolder}/`` so the rules agent can read
    the JSON directly during its run. ``supporting-data/`` sidecars are
    S3-only — the rules agent doesn't read those files anyway (the manifest
    is its contract).

    Always re-extracts on every rules-gen run. KB edits are rare and
    correctness beats Lambda cost here. Sidecar files matching the
    ``*.extracted.json`` suffix are skipped during enumeration so we don't
    extract our own output.

    Returns a summary dict ``{extracted, failed, files}``.
    """
    summary: dict = {"extracted": 0, "failed": 0, "files": []}

    if not kb_id or not DATA_BUCKET:
        logger.warning(
            "Cannot pre-extract KB — missing kb_id or DATA_BUCKET",
            _name="NOLIA_FUNDING_KB_EXTRACT_NOCONFIG",
            kb_id=kb_id,
            has_data_bucket=bool(DATA_BUCKET),
        )
        return summary

    if not EXTRACT_LAMBDA_ARN:
        logger.warning(
            "EXTRACT_CONTENT_LAMBDA_ARN not set — skipping KB pre-extraction",
            _name="NOLIA_FUNDING_KB_EXTRACT_NOLAMBDA",
        )
        return summary

    if kb_category == "global":
        subfolders = list(GLOBAL_KB_SUBFOLDERS_FOR_RULES)
        rules_relevant = set(GLOBAL_KB_SUBFOLDERS_FOR_RULES)
    else:
        subfolders = list(FUNDING_KB_SUBFOLDERS)
        rules_relevant = set(FUNDING_KB_SUBFOLDERS) - {"supporting-data"}

    s3 = _get_s3_client()
    kb_prefix = f"documents/kb-{kb_id}/"

    targets: list[dict] = []
    for subfolder in subfolders:
        prefix = f"{kb_prefix}{subfolder}/"
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=DATA_BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if key == prefix or key.endswith("/"):
                    continue
                filename = key.rsplit("/", 1)[-1]
                if filename.endswith(".extracted.json"):
                    continue
                ext = (
                    "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
                )
                if ext not in EXTRACTABLE_EXTENSIONS:
                    continue
                targets.append(
                    {
                        "key": key,
                        "size": obj.get("Size", 0),
                        "filename": filename,
                        "subfolder": subfolder,
                        "ext": ext,
                    }
                )

    if not targets:
        logger.info(
            "No KB PDF/DOCX files to pre-extract",
            _name="NOLIA_FUNDING_KB_EXTRACT_NONE",
            kb_id=kb_id,
            kb_category=kb_category,
        )
        return summary

    semaphore = asyncio.Semaphore(MAX_PER_RUN_PDF_CONCURRENCY)
    # Live under temp-pdf/ so we reuse the extract-content Lambda's existing
    # data-bucket IAM allowance for that prefix (the Lambda's prepare_chunks
    # also writes its page images under temp-pdf/{batch_id}/, so this stays
    # consistent).
    temp_prefix = f"temp-pdf/kb-extract/{kb_id}"

    async def extract_one(target: dict) -> dict:
        key = target["key"]
        size_bytes = target["size"]
        filename = target["filename"]
        subfolder = target["subfolder"]
        ext = target["ext"]
        sidecar_key = f"{key}.extracted.json"
        # DOCX always uses simple path (Lambda handles convert internally).
        # PDFs branch on size.
        use_simple_path = (
            ext == ".docx" or size_bytes <= SIMPLE_EXTRACT_SIZE_THRESHOLD_BYTES
        )

        async with semaphore:
            try:
                if use_simple_path:
                    await asyncio.to_thread(
                        _extract_simple,
                        s3_bucket=DATA_BUCKET,
                        s3_key=key,
                        output_key=sidecar_key,
                        file_name=filename,
                    )
                else:
                    # Chunked PDF path — writes to a temp key, then copy to sidecar.
                    chunked_output_key = await _extract_pdf(
                        s3_bucket=DATA_BUCKET,
                        s3_key=key,
                        output_prefix=f"{temp_prefix}/{subfolder}",
                    )
                    await asyncio.to_thread(
                        s3.copy_object,
                        Bucket=DATA_BUCKET,
                        CopySource={"Bucket": DATA_BUCKET, "Key": chunked_output_key},
                        Key=sidecar_key,
                    )
                    try:
                        await asyncio.to_thread(
                            s3.delete_object, Bucket=DATA_BUCKET, Key=chunked_output_key
                        )
                    except Exception:
                        pass

                if subfolder in rules_relevant:
                    local_target = KB_DIR / subfolder / f"{filename}.extracted.json"
                    local_target.parent.mkdir(parents=True, exist_ok=True)
                    await asyncio.to_thread(
                        s3.download_file,
                        DATA_BUCKET,
                        sidecar_key,
                        str(local_target),
                    )

                logger.info(
                    "Pre-extracted KB document",
                    _name="NOLIA_FUNDING_KB_EXTRACT_OK",
                    file=filename,
                    subfolder=subfolder,
                    size_bytes=size_bytes,
                    path="simple" if use_simple_path else "chunked",
                    sidecar_key=sidecar_key,
                    locally_available=subfolder in rules_relevant,
                )
                return {"status": "extracted", "key": key, "sidecar_key": sidecar_key}
            except Exception as e:
                logger.warning(
                    "Failed to pre-extract KB document",
                    _name="NOLIA_FUNDING_KB_EXTRACT_FAIL",
                    file=filename,
                    subfolder=subfolder,
                    size_bytes=size_bytes,
                    path="simple" if use_simple_path else "chunked",
                    error=str(e),
                )
                return {"status": "failed", "key": key, "reason": str(e)}

    results = await asyncio.gather(*(extract_one(t) for t in targets))
    summary["extracted"] = sum(1 for r in results if r["status"] == "extracted")
    summary["failed"] = sum(1 for r in results if r["status"] == "failed")
    summary["files"] = [r["key"] for r in results]

    logger.info(
        "KB pre-extraction summary",
        _name="NOLIA_FUNDING_KB_EXTRACT_SUMMARY",
        kb_id=kb_id,
        kb_category=kb_category,
        target_count=len(targets),
        extracted=summary["extracted"],
        failed=summary["failed"],
    )

    return summary


# ─── Entry point: extract applicant uploaded documents ───────────────────────


async def extract_funding_application(s3_prefix: str) -> list[str]:
    """Pre-extract PDF and DOCX applicant uploads to JSON sidecars.

    For every ``.pdf`` and ``.docx`` in ``/workdir/uploads/``:

    - **Small (≤ SIMPLE_EXTRACT_SIZE_THRESHOLD_BYTES):** single-call
      Lambda invocation in default mode. The Lambda dispatches by suffix
      and handles DOCX→PDF conversion internally — one round trip total.
    - **Large:** existing chunked path (PDFs go straight in; DOCX is
      converted to PDF first via ``_convert_to_pdf`` because the chunked
      Lambda only accepts PDFs).

    Every other file type — xlsx, csv, txt, images, json, .doc, .pages,
    etc. — is left in place untouched. The agent reads those directly
    with the appropriate tool (openpyxl for xlsx, native Read for text,
    etc.). Originals are never deleted; we only ADD ``extracted_{stem}.json``
    sidecars next to PDF/DOCX inputs.

    Args:
        s3_prefix: S3 prefix for this run (e.g.,
            ``v2-apps/nolia-funding/{user}/{conv}``).

    Returns:
        List of local paths to the extracted JSON sidecars produced this
        run (empty list when no PDF/DOCX uploads were present).
    """
    if not UPLOADS_DIR.exists():
        return []

    uploads = sorted(p for p in UPLOADS_DIR.iterdir() if p.is_file())
    if not uploads:
        logger.info(
            "No uploads to process",
            _name="NOLIA_FUNDING_EXTRACT_NO_UPLOADS",
        )
        return []

    extractables = [f for f in uploads if f.suffix.lower() in EXTRACTABLE_EXTENSIONS]
    passthrough = [f for f in uploads if f.suffix.lower() not in EXTRACTABLE_EXTENSIONS]

    if passthrough:
        logger.info(
            "Passing through non-PDF/DOCX uploads — agent will read directly",
            _name="NOLIA_FUNDING_EXTRACT_PASSTHROUGH",
            files=[f.name for f in passthrough],
            count=len(passthrough),
        )

    if not extractables:
        return []

    if not EXTRACT_LAMBDA_ARN:
        logger.warning(
            "EXTRACT_CONTENT_LAMBDA_ARN not set — can't pre-extract applicant uploads",
            _name="NOLIA_FUNDING_EXTRACT_NO_LAMBDA",
        )
        return []

    s3 = _get_s3_client()
    semaphore = asyncio.Semaphore(MAX_PER_RUN_PDF_CONCURRENCY)

    async def extract_one(src: Path) -> Optional[str]:
        size_bytes = src.stat().st_size
        suffix = src.suffix.lower()
        s3_key = f"{s3_prefix}/uploads/{src.name}"
        local_json = UPLOADS_DIR / f"extracted_{src.stem}.json"
        use_simple_path = size_bytes <= SIMPLE_EXTRACT_SIZE_THRESHOLD_BYTES

        async with semaphore:
            try:
                if use_simple_path:
                    output_key = f"{s3_prefix}/tmp-extracted/{src.stem}.json"
                    await asyncio.to_thread(
                        _extract_simple,
                        s3_bucket=OUTPUTS_BUCKET,
                        s3_key=s3_key,
                        output_key=output_key,
                        file_name=src.name,
                    )
                else:
                    pdf_s3_key = s3_key
                    if suffix == ".docx":
                        if not DOCUMENT_CONVERTER_LAMBDA:
                            logger.warning(
                                "Cannot convert large DOCX — DOCUMENT_CONVERTER_LAMBDA_NAME not set",
                                _name="NOLIA_FUNDING_CONVERT_NO_LAMBDA",
                                file=src.name,
                            )
                            return None
                        _, pdf_s3_key = await _convert_to_pdf(
                            original_file=src,
                            s3_bucket=OUTPUTS_BUCKET,
                            s3_key=s3_key,
                            s3_prefix=s3_prefix,
                        )
                    output_key = await _extract_pdf(
                        s3_bucket=OUTPUTS_BUCKET,
                        s3_key=pdf_s3_key,
                        output_prefix=f"{s3_prefix}/tmp-extracted",
                    )

                await asyncio.to_thread(
                    s3.download_file, OUTPUTS_BUCKET, output_key, str(local_json)
                )
                logger.info(
                    "Extracted applicant document",
                    _name="NOLIA_FUNDING_EXTRACT_OK",
                    source=src.name,
                    suffix=suffix,
                    size_bytes=size_bytes,
                    path="simple" if use_simple_path else "chunked",
                    extracted=local_json.name,
                )
                return str(local_json)
            except Exception as e:
                logger.warning(
                    "Failed to extract applicant document",
                    _name="NOLIA_FUNDING_EXTRACT_FAIL",
                    source=src.name,
                    suffix=suffix,
                    size_bytes=size_bytes,
                    path="simple" if use_simple_path else "chunked",
                    error=str(e),
                )
                return None

    extract_results = await asyncio.gather(*(extract_one(f) for f in extractables))
    extracted_paths = [p for p in extract_results if p is not None]

    logger.info(
        "Applicant extraction complete",
        _name="NOLIA_FUNDING_EXTRACT_COMPLETE",
        extracted_count=len(extracted_paths),
        passthrough_count=len(passthrough),
        source_files=len(uploads),
    )

    return extracted_paths


# ─── Entry point: compare workspace ──────────────────────────────────────────


async def setup_funding_compare_workspace(
    user_sub: str,
    conversation_id: str,
    *,
    funding_kb_id: str,
    run_entries: list[dict],
) -> None:
    """Set up workspace for a Nolia Funding comparison run.

    Assessments are **Fund-scoped** — any assessor with access to a Fund
    can compare any assessments in it, even ones created by a different
    user. Each prior run's S3 path uses the *creator's* ``user_sub``, not
    the current caller's, so the frontend must pass the pair of
    ``run_id`` + ``user_sub`` (``owner_user_sub``) per run.

    ``run_entries`` shape::

        [
            {"run_id": "run-1", "user_sub": "abc-..."},
            {"run_id": "run-2", "user_sub": "def-..."},
        ]

    Downloads everything under each run's S3 prefix into
    ``/workdir/prior-assessments/run-{i}/``. The artefacts the compare
    prompt actually consumes are:
      - ``_result.json`` — applicant + decision envelope
      - ``_summary_and_reasoning.md`` — narrative summary of the assessment
      - ``outputs/Assessment_<applicant>.md`` — rendered per-criterion report
      - ``outputs/_applicant.json`` — richer applicant identity (optional)

    Older runs may also carry ``tmp/findings.md`` from the legacy three-step
    assess pipeline; the current single-step assess does not produce it and
    the compare prompt no longer reads it.

    Also downloads the Funding KB's output template to provide structural
    context to the compare agent (so it knows which criteria to compare).
    """
    logger.info(
        "Setting up funding compare workspace",
        _name="NOLIA_FUNDING_COMPARE_WORKSPACE_SETUP",
        phase="pipeline",
        funding_kb_id=funding_kb_id,
        run_count=len(run_entries),
    )

    _ensure_workspace_dirs()

    if not OUTPUTS_BUCKET:
        logger.warning(
            "OUTPUTS_BUCKET_NAME not set — cannot download prior assessments",
            _name="NOLIA_FUNDING_NO_OUTPUTS_BUCKET",
        )
        return

    s3 = _get_s3_client()

    for i, entry in enumerate(run_entries, start=1):
        run_id = entry.get("run_id", "")
        owner_sub = entry.get("user_sub") or user_sub
        if not run_id:
            logger.warning(
                "Skipping compare entry with missing run_id",
                _name="NOLIA_FUNDING_COMPARE_ENTRY_MISSING_RUN_ID",
                entry=entry,
            )
            continue

        target_dir = PRIOR_ASSESSMENTS_DIR / f"run-{i}"
        target_dir.mkdir(parents=True, exist_ok=True)

        run_prefix = f"v2-apps/nolia-funding/{owner_sub}/{run_id}/"

        # Download everything under the run prefix (small footprint —
        # only _result, outputs, tmp)
        try:
            count = _download_s3_prefix(s3, OUTPUTS_BUCKET, run_prefix, target_dir)
            logger.info(
                "Downloaded prior assessment",
                _name="NOLIA_FUNDING_PRIOR_DOWNLOAD",
                run_id=run_id,
                owner_sub_last4=owner_sub[-4:] if owner_sub else "",
                cross_user=owner_sub != user_sub,
                file_count=count,
                local_path=str(target_dir),
            )
        except Exception as e:
            logger.warning(
                "Failed to download prior assessment",
                _name="NOLIA_FUNDING_PRIOR_DOWNLOAD_FAIL",
                run_id=run_id,
                owner_sub_last4=owner_sub[-4:] if owner_sub else "",
                error=str(e),
            )

    # Download the Funding KB's output template so the compare agent
    # can structure its comparison around the same criteria.
    if funding_kb_id and DATA_BUCKET:
        template_prefix = f"documents/kb-{funding_kb_id}/templates/"
        template_target = KB_DIR / "templates"
        try:
            count = _download_s3_prefix(
                s3, DATA_BUCKET, template_prefix, template_target
            )
            logger.info(
                "Downloaded funding template for compare context",
                _name="NOLIA_FUNDING_COMPARE_TEMPLATE_DOWNLOAD",
                file_count=count,
            )
        except Exception as e:
            logger.warning(
                "Failed to download funding template",
                _name="NOLIA_FUNDING_COMPARE_TEMPLATE_FAIL",
                error=str(e),
            )

    logger.info(
        "Funding compare workspace ready",
        _name="NOLIA_FUNDING_COMPARE_WORKSPACE_COMPLETE",
    )


# ─── Convenience helpers for orchestrators ───────────────────────────────────


def read_supporting_data_manifest() -> Optional[dict]:
    """Read the supporting-data-manifest.json if it was downloaded."""
    path = KB_DIR / SUPPORTING_DATA_MANIFEST_FILENAME
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception as e:
        logger.warning(
            "Failed to parse supporting-data manifest",
            _name="NOLIA_FUNDING_MANIFEST_PARSE_FAIL",
            error=str(e),
        )
        return None

"""Nolia Funding workspace setup — pre-pipeline data preparation.

Three entry points, one per pipeline:

- ``setup_funding_rules_workspace()`` — for ``nolia-funding-rules-generator``.
  Downloads the Funding KB's selection-criteria, application-form,
  good-examples (optional), output template, and the
  supporting-data-manifest.json (per-file descriptions of the supporting-data
  lookup files) into /workdir/knowledge-bases/. The raw supporting-data
  files themselves are NOT downloaded for rules generation — only their
  manifest entries, which the rules agent uses to emit per-file rules
  describing how each lookup file is consulted during assessment.

- ``setup_funding_assess_workspace()`` — for ``nolia-funding-assess``.
  Downloads the paired Global KB rules, the Funding KB's full contents
  (including supporting-data + manifest), the output template, and pre-extracts
  any PDFs in supporting-data. Also extracts the applicant's uploaded docs.

- ``setup_funding_compare_workspace()`` — for ``nolia-funding-compare``.
  Downloads prior assessment artefacts for each run being compared, plus the
  Funding KB's output template (for structural context).

Imports a handful of helpers from ``..nolia.workspace_setup`` — S3 client,
prefix download, PDF extraction, DOCX→PDF conversion. These are genuinely
shared infrastructure, not product-specific logic. If the cross-package
import ever becomes inconvenient, lift them to a ``..nolia_shared`` module.
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
    CONVERTIBLE_EXTENSIONS,
    _convert_to_pdf,
    _download_s3_prefix,
    _extract_pdf,
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

    # ── Pre-extract supporting-data PDFs ────────────────────────────────────
    # Large PDFs (curriculum docs, etc.) can't be read inline. Extract them
    # once up-front so the assessment agent can query the extracted JSON.
    await _pre_extract_supporting_data(user_sub, conversation_id)

    logger.info(
        "Funding assess workspace ready",
        _name="NOLIA_FUNDING_ASSESS_WORKSPACE_COMPLETE",
    )


async def _pre_extract_supporting_data(user_sub: str, conversation_id: str) -> None:
    """Extract all PDFs in /workdir/knowledge-bases/supporting-data/ to JSON.

    Writes alongside each PDF: ``{name}.extracted.json``. The assessment
    agent reads the extracted JSON rather than loading the raw PDF into
    context. For non-PDF supporting files (CSVs, XLSX) we do nothing —
    the agent queries them directly with scripts.
    """
    supporting_dir = KB_DIR / "supporting-data"
    if not supporting_dir.exists():
        return

    pdfs = [p for p in supporting_dir.glob("**/*.pdf") if p.is_file()]
    if not pdfs:
        logger.info(
            "No supporting-data PDFs to pre-extract",
            _name="NOLIA_FUNDING_SUPPORTING_NO_PDFS",
        )
        return

    if not EXTRACT_LAMBDA_ARN:
        logger.warning(
            "EXTRACT_CONTENT_LAMBDA_ARN not set — skipping supporting PDF extraction",
            _name="NOLIA_FUNDING_SUPPORTING_NO_LAMBDA",
        )
        return

    s3 = _get_s3_client()
    # We need PDFs in S3 for _extract_pdf to work. The supporting-data PDFs
    # are already in s3://{DATA_BUCKET}/documents/kb-{kb}/supporting-data/ —
    # the call below needs those S3 keys, not the local paths. Resolve from
    # the KB's S3 prefix captured earlier? Simpler: re-upload each local PDF
    # to a temporary location under the run's outputs bucket, extract, then
    # clean up. Keeps ownership clear.

    run_prefix = f"v2-apps/nolia-funding/{user_sub}/{conversation_id}"

    for pdf in pdfs:
        temp_key = f"{run_prefix}/tmp-supporting-data/{pdf.name}"
        try:
            s3.upload_file(str(pdf), OUTPUTS_BUCKET, temp_key)
            output_key = await _extract_pdf(
                s3_bucket=OUTPUTS_BUCKET,
                s3_key=temp_key,
                output_prefix=f"{run_prefix}/tmp-supporting-data",
            )
            # Download extracted JSON next to the PDF
            extracted_local = pdf.with_suffix(".extracted.json")
            s3.download_file(OUTPUTS_BUCKET, output_key, str(extracted_local))
            logger.info(
                "Extracted supporting-data PDF",
                _name="NOLIA_FUNDING_SUPPORTING_EXTRACTED",
                pdf=pdf.name,
                extracted=extracted_local.name,
            )
        except Exception as e:
            logger.warning(
                "Failed to pre-extract supporting PDF — agent will need to handle it",
                _name="NOLIA_FUNDING_SUPPORTING_EXTRACT_FAIL",
                pdf=pdf.name,
                error=str(e),
            )
        finally:
            # Clean up the temp S3 upload
            try:
                s3.delete_object(Bucket=OUTPUTS_BUCKET, Key=temp_key)
            except Exception:
                pass


# ─── Entry point: extract applicant uploaded documents ───────────────────────


async def extract_funding_application(s3_prefix: str) -> list[str]:
    """Extract every applicant-uploaded document in /workdir/uploads/.

    Unlike the procurement flow (which has one primary document), funding
    applications often have multiple files (application form + supporting
    docs). We extract each and write ``extracted_{stem}.json`` alongside it.

    Args:
        s3_prefix: S3 prefix for this run (e.g.,
            ``v2-apps/nolia-funding/{user}/{conv}``).

    Returns:
        List of local paths to extracted JSON files.
    """
    if not UPLOADS_DIR.exists():
        return []

    uploads = sorted(UPLOADS_DIR.iterdir())
    if not uploads:
        logger.info(
            "No uploads to extract",
            _name="NOLIA_FUNDING_EXTRACT_NO_UPLOADS",
        )
        return []

    pdfs: list[Path] = []
    conversions: list[tuple[Path, Path]] = []  # (original, converted_pdf)
    jsons_already: list[Path] = []

    for f in uploads:
        if not f.is_file():
            continue
        suffix = f.suffix.lower()
        if suffix == ".pdf":
            pdfs.append(f)
        elif suffix == ".json":
            jsons_already.append(f)
        elif suffix in CONVERTIBLE_EXTENSIONS:
            # Queue for conversion
            if not DOCUMENT_CONVERTER_LAMBDA:
                logger.warning(
                    "Cannot convert — DOCUMENT_CONVERTER_LAMBDA_NAME not set",
                    _name="NOLIA_FUNDING_CONVERT_NO_LAMBDA",
                    file=f.name,
                )
                continue
            conversions.append((f, f.with_suffix(".pdf")))

    # Perform conversions
    if conversions:
        convert_tasks = []
        for original, _target in conversions:
            s3_source_key = f"{s3_prefix}/uploads/{original.name}"
            convert_tasks.append(
                _convert_to_pdf(
                    original_file=original,
                    s3_bucket=OUTPUTS_BUCKET,
                    s3_key=s3_source_key,
                    s3_prefix=s3_prefix,
                )
            )
        convert_results = await asyncio.gather(*convert_tasks, return_exceptions=True)
        for (original, _target), result in zip(conversions, convert_results):
            if isinstance(result, Exception):
                logger.warning(
                    "Conversion failed",
                    _name="NOLIA_FUNDING_CONVERT_FAIL",
                    original=original.name,
                    error=str(result),
                )
                continue
            pdf_path, _s3_key = result
            pdfs.append(pdf_path)

    # Extract each PDF
    extracted_paths: list[str] = []

    if not pdfs and not jsons_already:
        logger.warning(
            "No PDF/convertible/JSON applicant files after processing",
            _name="NOLIA_FUNDING_EXTRACT_NOTHING",
        )
        return []

    if not EXTRACT_LAMBDA_ARN and pdfs:
        logger.warning(
            "EXTRACT_CONTENT_LAMBDA_ARN not set — can't extract applicant PDFs",
            _name="NOLIA_FUNDING_EXTRACT_NO_LAMBDA",
        )
        # Still return any pre-existing JSONs
        return [str(j) for j in jsons_already]

    for pdf in pdfs:
        s3_key = f"{s3_prefix}/uploads/{pdf.name}"
        try:
            output_key = await _extract_pdf(
                s3_bucket=OUTPUTS_BUCKET,
                s3_key=s3_key,
                output_prefix=f"{s3_prefix}/tmp-extracted",
            )
            local_json = UPLOADS_DIR / f"extracted_{pdf.stem}.json"
            s3 = _get_s3_client()
            s3.download_file(OUTPUTS_BUCKET, output_key, str(local_json))
            extracted_paths.append(str(local_json))
            logger.info(
                "Extracted applicant document",
                _name="NOLIA_FUNDING_EXTRACT_OK",
                source=pdf.name,
                extracted=local_json.name,
            )
        except Exception as e:
            logger.warning(
                "Failed to extract applicant document",
                _name="NOLIA_FUNDING_EXTRACT_FAIL",
                source=pdf.name,
                error=str(e),
            )

    # Pre-existing JSONs — include as-is
    extracted_paths.extend(str(j) for j in jsons_already)

    logger.info(
        "Applicant extraction complete",
        _name="NOLIA_FUNDING_EXTRACT_COMPLETE",
        extracted_count=len(extracted_paths),
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

    Downloads, for each entry:
      - ``_result.json``
      - all files under ``outputs/`` (the assessment MD/PDF/DOCX)
      - ``tmp/findings.md`` if it exists

    Into ``/workdir/prior-assessments/run-{i}/``.

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

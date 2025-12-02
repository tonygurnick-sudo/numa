"""
Nolia-specific utilities for the 4-phase analysis pipeline.

Provides functions for:
- Workspace setup with additional Nolia-specific directories
- `tmp/` directory S3 persistence between phases
- Knowledge base file download from data bucket
"""

from pathlib import Path
from typing import Dict, Optional

import structlog

import s3_helpers
from utils import s3_operations

logger = structlog.get_logger(__name__)


def setup_nolia_workspace(workdir: Path) -> Dict[str, Path]:
    """
    Create workspace directories for a Nolia analysis run.

    Extends the standard workspace with Nolia-specific directories.

    Args:
        workdir: Root workspace directory (typically /tmp/cc_ws/{job_id})

    Returns:
        Dictionary with paths to all workspace directories
    """
    dirs = {
        "inputs": workdir / "input-procurement-evaluation-report",
        "outputs": workdir / "outputs",
        "tmp": workdir / "tmp",
        "knowledge_bases": workdir / "knowledge-bases",
    }
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    return dirs


def upload_tmp_to_s3(tmp_dir: Path, bucket: str, prefix: str) -> int:
    """
    Upload tmp/ directory contents to S3 for the next phase.

    This persists intermediate outputs (manifest, CSVs, summaries) between
    Lambda invocations so subsequent phases can access prior work.

    Args:
        tmp_dir: Local tmp directory
        bucket: S3 bucket name
        prefix: S3 prefix for the job (e.g., "nolia/user_id/job_id")

    Returns:
        Count of files uploaded
    """
    count = 0
    if not tmp_dir.exists():
        return count

    for file_path in tmp_dir.rglob("*"):
        if not file_path.is_file():
            continue
        rel_path = file_path.relative_to(tmp_dir)
        s3_key = s3_operations.safe_s3_key(prefix, "workspace", "tmp", str(rel_path))
        content_type = s3_operations.guess_content_type(file_path)

        try:
            s3_helpers.write(
                s3_key,
                file_path.read_bytes(),
                content_type=content_type,
                bucket=bucket,
            )
            count += 1
            logger.debug("Uploaded tmp file to S3", file=str(rel_path), key=s3_key)
        except Exception as e:
            logger.warning(
                "Failed to upload tmp file", file=str(rel_path), error=str(e)
            )

    if count:
        logger.info("Uploaded tmp directory to S3", files=count, prefix=prefix)
    return count


def hydrate_tmp_from_s3(tmp_dir: Path, bucket: str, prefix: str) -> int:
    """
    Download tmp/ directory from S3 from previous phases.

    This restores intermediate outputs so the current phase can access
    work from prior phases (manifest, compliance CSVs, summaries).

    Args:
        tmp_dir: Local tmp directory to restore to
        bucket: S3 bucket name
        prefix: S3 prefix for the job

    Returns:
        Count of files downloaded
    """
    count = 0
    tmp_prefix = s3_operations.safe_s3_key(prefix, "workspace", "tmp") + "/"

    try:
        keys = s3_helpers.list_objects(prefix=tmp_prefix, bucket=bucket)
        for key in keys:
            # Skip folders
            if key.endswith("/"):
                continue

            # Extract relative path
            rel_path = key[len(tmp_prefix) :]
            if not rel_path:
                continue

            local_path = tmp_dir / rel_path
            local_path.parent.mkdir(parents=True, exist_ok=True)

            data = s3_helpers.read(key, bucket=bucket)
            local_path.write_bytes(data)
            count += 1
            logger.debug("Downloaded tmp file from S3", file=rel_path)

        if count:
            logger.info("Hydrated tmp directory from S3", files=count, prefix=prefix)
    except Exception as e:
        logger.warning("Failed to hydrate tmp from S3", error=str(e))

    return count


def _download_kb_folder(
    bucket: str, s3_prefix: str, local_dir: Path, kb_type: str
) -> int:
    """
    Download all files from a KB folder in S3.

    Args:
        bucket: S3 bucket name
        s3_prefix: S3 prefix for the KB folder
        local_dir: Local directory to download to
        kb_type: Type of KB for logging (e.g., "global", "procurement")

    Returns:
        Count of files downloaded
    """
    count = 0
    local_dir.mkdir(parents=True, exist_ok=True)

    try:
        keys = s3_helpers.list_objects(prefix=s3_prefix, bucket=bucket)
        for key in keys:
            if key.endswith("/"):
                continue
            rel_path = key[len(s3_prefix) :]
            if not rel_path:
                continue
            local_path = local_dir / rel_path
            local_path.parent.mkdir(parents=True, exist_ok=True)
            data = s3_helpers.read(key, bucket=bucket)
            local_path.write_bytes(data)
            count += 1
            logger.debug(f"Downloaded {kb_type} KB file", file=rel_path)
    except Exception as e:
        logger.warning(f"Failed to download {kb_type} KB files", error=str(e))

    return count


def _download_rules_file(
    bucket: str, rules_key: str, dest_path: Path, rules_type: str
) -> bool:
    """
    Download a rules file from S3.

    Args:
        bucket: S3 bucket name
        rules_key: S3 key for the rules file
        dest_path: Local path to save the rules file
        rules_type: Type of rules for logging (e.g., "global", "procurement")

    Returns:
        True if downloaded successfully, False otherwise
    """
    try:
        rules_data = s3_helpers.read(rules_key, bucket=bucket)
        dest_path.write_bytes(rules_data)
        logger.info(f"Downloaded {rules_type} rules", file=dest_path.name)
        return True
    except Exception as e:
        logger.warning(f"Failed to download {rules_type} rules", error=str(e))
        return False


def download_kb_files(
    data_bucket: str,
    global_kb: str,
    procurement_kb: str,
    workdir: Path,
    project_kb: str = "",
) -> Dict[str, int]:
    """
    Download knowledge base files from the data bucket to the workspace.

    KB files are stored in the data bucket at:
        documents/{kb_name}/
        ├── global-knowledge-base/ or procurement-knowledge-base/ or project-knowledge-base/
        └── global-rules.md or procurement-rules.md or project-rules.md

    Args:
        data_bucket: S3 bucket containing KB files
        global_kb: Name of the global KB (e.g., "global-test1")
        procurement_kb: Name of the procurement KB (e.g., "procurement-test1")
        workdir: Root workspace directory
        project_kb: Name of the project KB (e.g., "project-test1") for terms-of-reference

    Returns:
        Dictionary with counts of downloaded files per KB type
    """
    counts = {
        "global_kb_files": 0,
        "global_rules": 0,
        "procurement_kb_files": 0,
        "procurement_rules": 0,
        "project_kb_files": 0,
        "project_rules": 0,
    }
    kb_dir = workdir / "knowledge-bases"

    # Download global KB
    if global_kb:
        global_prefix = f"documents/{global_kb}/"
        counts["global_kb_files"] = _download_kb_folder(
            data_bucket,
            f"{global_prefix}global-knowledge-base/",
            kb_dir / "global-knowledge-base",
            "global",
        )
        if _download_rules_file(
            data_bucket,
            f"{global_prefix}global-rules.md",
            workdir / "global-rules.md",
            "global",
        ):
            counts["global_rules"] = 1

    # Download procurement KB
    if procurement_kb:
        procurement_prefix = f"documents/{procurement_kb}/"
        counts["procurement_kb_files"] = _download_kb_folder(
            data_bucket,
            f"{procurement_prefix}procurement-knowledge-base/",
            kb_dir / "procurement-knowledge-base",
            "procurement",
        )
        if _download_rules_file(
            data_bucket,
            f"{procurement_prefix}procurement-rules.md",
            workdir / "procurement-rules.md",
            "procurement",
        ):
            counts["procurement_rules"] = 1

    # Download project KB (for terms-of-reference assessment type)
    if project_kb:
        project_prefix = f"documents/{project_kb}/"
        counts["project_kb_files"] = _download_kb_folder(
            data_bucket,
            f"{project_prefix}project-knowledge-base/",
            kb_dir / "project-knowledge-base",
            "project",
        )
        if _download_rules_file(
            data_bucket,
            f"{project_prefix}project-rules.md",
            workdir / "project-rules.md",
            "project",
        ):
            counts["project_rules"] = 1

    # Log summary
    logger.info(
        "KB download complete",
        global_kb=global_kb,
        procurement_kb=procurement_kb,
        project_kb=project_kb,
        global_kb_files_downloaded=counts["global_kb_files"],
        global_rules_downloaded=counts["global_rules"] == 1,
        procurement_kb_files_downloaded=counts["procurement_kb_files"],
        procurement_rules_downloaded=counts["procurement_rules"] == 1,
        project_kb_files_downloaded=counts["project_kb_files"],
        project_rules_downloaded=counts["project_rules"] == 1,
    )

    # Log warnings for missing required files
    if global_kb and counts["global_rules"] == 0:
        logger.warning(
            "Global rules file not found",
            expected_key=f"documents/{global_kb}/global-rules.md",
            bucket=data_bucket,
        )
    if procurement_kb and counts["procurement_rules"] == 0:
        logger.warning(
            "Procurement rules file not found",
            expected_key=f"documents/{procurement_kb}/procurement-rules.md",
            bucket=data_bucket,
        )
    if project_kb and counts["project_rules"] == 0:
        logger.warning(
            "Project rules file not found",
            expected_key=f"documents/{project_kb}/project-rules.md",
            bucket=data_bucket,
        )

    return counts


def get_output_template_path() -> Optional[Path]:
    """
    Get the path to the bundled output template file.

    The template is bundled with the Lambda package.

    Returns:
        Path to the template file, or None if not found
    """
    # Check common locations for bundled templates
    possible_paths = [
        Path("/var/task/nolia_report/templates/Output_Template_Evaluation_Report.md"),
        Path("/var/task/templates/Output_Template_Evaluation_Report.md"),
        Path(__file__).parent.parent
        / "nolia_report"
        / "templates"
        / "Output_Template_Evaluation_Report.md",
    ]

    for path in possible_paths:
        if path.exists():
            return path

    logger.warning("Output template not found in bundled paths")
    return None


def copy_output_template_to_workspace(workdir: Path) -> bool:
    """
    Copy the bundled output template to the workspace.

    Args:
        workdir: Root workspace directory

    Returns:
        True if template was copied, False otherwise
    """
    template_path = get_output_template_path()
    if not template_path:
        return False

    dest = workdir / "Output_Template_Evaluation_Report.md"
    try:
        dest.write_text(template_path.read_text(encoding="utf-8"), encoding="utf-8")
        logger.info("Copied output template to workspace")
        return True
    except Exception as e:
        logger.warning("Failed to copy output template", error=str(e))
        return False

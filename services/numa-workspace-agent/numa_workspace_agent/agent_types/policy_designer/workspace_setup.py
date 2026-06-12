"""Policy Designer workspace setup — pre-pipeline workspace seeding.

Creates the workspace directory structure and writes the three input files
the pipeline phases read:

- ``/workdir/exemplar.md`` — copied from the exemplar bundled in the image.
- ``/workdir/school_context.md`` — the school context from the run prompt.
- ``/workdir/additional_instructions.md`` — optional per-school overrides
  (empty by default; a future lever for school-specific adjustments without
  prompt edits).

Unlike Nolia's setup there are no knowledge bases, S3 downloads, or document
extraction — everything the pipeline needs is bundled or in the request.
"""

import shutil
from pathlib import Path

import structlog

from ...atomic_io import atomic_write_text

logger = structlog.get_logger()

# Workspace paths
WORKDIR = Path("/workdir")
TMP_DIR = WORKDIR / "tmp"
OUTPUTS_DIR = WORKDIR / "outputs"

EXEMPLAR_DEST = WORKDIR / "exemplar.md"
SCHOOL_CONTEXT_DEST = WORKDIR / "school_context.md"
ADDITIONAL_INSTRUCTIONS_DEST = WORKDIR / "additional_instructions.md"

# Bundled exemplar (inside the Docker image, read-only)
BUNDLED_EXEMPLAR = Path(__file__).parent / "assets" / "exemplar.md"


def setup_policy_designer_workspace(
    user_sub: str,
    conversation_id: str,
    *,
    school_context: str,
    additional_instructions: str = "",
) -> None:
    """Seed the workspace for a Policy Designer run.

    Args:
        user_sub: Cognito user sub (logging only).
        conversation_id: Run/conversation ID (logging only).
        school_context: Freeform school context text from the run prompt.
        additional_instructions: Optional override instructions. Written as
            an empty file when not provided so phases can always read it.
    """
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

    shutil.copy2(BUNDLED_EXEMPLAR, EXEMPLAR_DEST)
    atomic_write_text(school_context or "", SCHOOL_CONTEXT_DEST, encoding="utf-8")
    atomic_write_text(
        additional_instructions or "", ADDITIONAL_INSTRUCTIONS_DEST, encoding="utf-8"
    )

    logger.info(
        "Policy Designer workspace seeded",
        _name="POLICY_DESIGNER_WORKSPACE_SETUP",
        phase="pipeline",
        user_sub=user_sub,
        conversation_id=conversation_id,
        exemplar_bytes=EXEMPLAR_DEST.stat().st_size,
        school_context_chars=len(school_context or ""),
        has_additional_instructions=bool(additional_instructions),
    )

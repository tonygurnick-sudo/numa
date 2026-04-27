"""Nolia Funding agent types.

Registers all Nolia Funding parent orchestrator types and (later) the
per-phase sub-agent types. Import order matters: phase types must be
registered before the parent type references them (only relevant once
phases are implemented — skeletons here don't reference phase types yet).

See ``nolia/dev-notes/tasks/nolia-ngai-tahu-general/numa-backend-plan.md``
for the full implementation plan.

Status: skeleton — parent orchestrators registered with stub pipelines that
write placeholder results. Phases to follow in steps 2–5.
"""

# Parent (orchestrator) agent types
# Phase types first — parent types reference phase orchestrators that in
# turn reference phase agent types via the registry. Order matters here:
# register phases before parents.
from . import nolia_funding_assess as _nolia_funding_assess  # noqa: F401
from . import nolia_funding_compare as _nolia_funding_compare  # noqa: F401
from . import nolia_funding_rules as _nolia_funding_rules  # noqa: F401
from . import phase_assess_evaluate as _phase_assess_evaluate  # noqa: F401
from . import phase_assess_extract as _phase_assess_extract  # noqa: F401
from . import phase_assess_render as _phase_assess_render  # noqa: F401
from . import phase_assess_single as _phase_assess_single  # noqa: F401
from . import phase_compare as _phase_compare  # noqa: F401
from . import phase_rules_extract as _phase_rules_extract  # noqa: F401
from . import phase_rules_extract_global as _phase_rules_extract_global  # noqa: F401
from . import phase_rules_review as _phase_rules_review  # noqa: F401
from . import phase_rules_review_global as _phase_rules_review_global  # noqa: F401
from . import phase_rules_second_review as _phase_rules_second_review  # noqa: F401
from . import (  # noqa: F401
    phase_rules_second_review_global as _phase_rules_second_review_global,
)

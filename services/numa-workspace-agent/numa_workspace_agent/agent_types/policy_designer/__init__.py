"""NZSBA Policy Designer agent types (FEAT-174).

Registers the three pipeline phase agent types and the parent orchestrator
type. Import order matters: phase types must be registered before the
parent type references them.
"""

from . import phase_generation as _phase_generation  # noqa: F401
from . import phase_render as _phase_render  # noqa: F401
from . import phase_review as _phase_review  # noqa: F401
from . import policy_designer as _policy_designer  # noqa: F401

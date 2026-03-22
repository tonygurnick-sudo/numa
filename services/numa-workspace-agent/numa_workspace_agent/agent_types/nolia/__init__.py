"""Nolia compliance review agent types.

Registers all Nolia phase agent types and the parent orchestrator type.
Import order matters: phase types must be registered before the parent
type references them.
"""

from . import nolia_compliance as _nolia_compliance  # noqa: F401
from . import nolia_rules_generator as _nolia_rules_generator  # noqa: F401
from . import phase_eda as _phase_eda  # noqa: F401
from . import phase_global as _phase_global  # noqa: F401
from . import phase_procurement as _phase_procurement  # noqa: F401
from . import phase_project as _phase_project  # noqa: F401
from . import phase_report_generate as _phase_report_generate  # noqa: F401
from . import phase_report_review as _phase_report_review  # noqa: F401
from . import phase_rules_extract as _phase_rules_extract  # noqa: F401
from . import phase_rules_review as _phase_rules_review  # noqa: F401
from . import phase_translate as _phase_translate  # noqa: F401

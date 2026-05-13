"""Claude Agent SDK hooks for Numa Workspace Agent."""

from numa_workspace_agent.hooks.image_resize import image_resize_hook
from numa_workspace_agent.hooks.param_aliases import param_aliases_hook
from numa_workspace_agent.hooks.security import (
    audit_hook,
    compaction_hook,
    security_hook,
)

__all__ = [
    "security_hook",
    "audit_hook",
    "compaction_hook",
    "image_resize_hook",
    "param_aliases_hook",
]

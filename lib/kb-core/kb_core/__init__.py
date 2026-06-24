"""Shared knowledge-base management primitives.

Used by both ``numa-chat-agent`` (read-only, to resolve a user's accessible
KBs per turn) and ``numa-kb-manager`` (the full CRUD API).
"""

from .kb_manager import KnowledgeBaseManager, sanitize_kb_name
from .resource_taxonomy import (
    INDUSTRIES,
    PERSONAS,
    normalise_industries,
    normalise_personas,
)

__all__ = [
    "KnowledgeBaseManager",
    "sanitize_kb_name",
    "PERSONAS",
    "INDUSTRIES",
    "normalise_personas",
    "normalise_industries",
]

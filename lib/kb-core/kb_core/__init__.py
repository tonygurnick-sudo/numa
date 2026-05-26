"""Shared knowledge-base management primitives.

Used by both ``numa-chat-agent`` (read-only, to resolve a user's accessible
KBs per turn) and ``numa-kb-manager`` (the full CRUD API).
"""

from .kb_manager import KnowledgeBaseManager
from .resource_taxonomy import (
    INDUSTRIES,
    PERSONAS,
    normalise_industries,
    normalise_personas,
)

__all__ = [
    "KnowledgeBaseManager",
    "PERSONAS",
    "INDUSTRIES",
    "normalise_personas",
    "normalise_industries",
]

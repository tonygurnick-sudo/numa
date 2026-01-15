"""Base contract for data connectors."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict


class BaseDataConnector(ABC):
    """Interface for validating and sanitizing connector configs."""

    connector_id: str
    display_name: str

    @abstractmethod
    def test_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Validate credentials and return a structured result."""

    @abstractmethod
    def sanitize_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Strip sensitive fields before storing to DynamoDB."""

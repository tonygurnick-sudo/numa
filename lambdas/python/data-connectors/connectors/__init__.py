"""Connector registry for data connector integrations."""

from typing import Optional

from .synergy import SynergyConnector

CONNECTOR_REGISTRY = {
    SynergyConnector.connector_id: SynergyConnector(),
}


def get_connector(connector_id: str) -> Optional[SynergyConnector]:
    """Return the connector instance matching the connector id."""
    return CONNECTOR_REGISTRY.get(connector_id)

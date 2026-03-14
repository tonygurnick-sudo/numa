"""Connector registry for data connector integrations."""

from typing import Optional, Union

from .gmail import GmailConnector
from .synergy import SynergyConnector

CONNECTOR_REGISTRY: dict[str, Union[SynergyConnector, GmailConnector]] = {
    SynergyConnector.connector_id: SynergyConnector(),
    GmailConnector.connector_id: GmailConnector(),
}


def get_connector(
    connector_id: str,
) -> Optional[Union[SynergyConnector, GmailConnector]]:
    """Return the connector instance matching the connector id."""
    return CONNECTOR_REGISTRY.get(connector_id)

"""OAuth workspace tools package."""

from .connect_tools import (
    handle_connect_request,
    handle_connect_status,
    handle_connect_synergy_download,
    handle_connect_synergy_list,
    handle_connect_synergy_search,
)
from .oauth_tools import (
    handle_oauth_connection_status,
    handle_oauth_download_file,
    handle_oauth_get_file_metadata,
    handle_oauth_list_files,
    handle_oauth_search_files,
)

__all__ = [
    # OAuth handlers (existing)
    "handle_oauth_list_files",
    "handle_oauth_download_file",
    "handle_oauth_search_files",
    "handle_oauth_get_file_metadata",
    "handle_oauth_connection_status",
    # Connect handlers (unified)
    "handle_connect_status",
    "handle_connect_synergy_list",
    "handle_connect_synergy_search",
    "handle_connect_synergy_download",
    "handle_connect_request",
]

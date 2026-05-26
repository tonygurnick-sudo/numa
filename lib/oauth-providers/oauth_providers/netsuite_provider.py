"""NetSuite AI Connector Service (MCP) provider implementation."""

import json
from typing import Any, Optional

from .base_provider import (
    OAuthFileMetadata,
    OAuthFolderContents,
    OAuthProvider,
)


class NetSuiteProvider(OAuthProvider):
    """NetSuite MCP data connector.

    Auth type: OAuth 2.0 Authorization Code + PKCE (public client)
    Protocol: MCP (JSON-RPC 2.0) over HTTPS
    """

    PROVIDER_ID = "netsuite"
    MCP_PATH = "/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools"

    def __init__(
        self,
        client_id: str,
        client_secret: str | None = None,
        account_id: str = "",
        **_: Any,
    ):
        # NetSuite is a public OAuth client (PKCE) — client_secret is always None
        # in production. The kwarg is accepted only to satisfy the OAuthProvider
        # base signature and the auto-discovery instantiation.
        super().__init__(client_id=client_id, client_secret=client_secret)
        # NetSuite API domains strictly require account IDs to be lowercased
        # and underscores replaced with hyphens (e.g. 1234567_SB1 -> 1234567-sb1).
        self.account_id = account_id
        sanitized_account_id = account_id.lower().replace("_", "-")
        self.base_url = f"https://{sanitized_account_id}.suitetalk.api.netsuite.com"
        self.mcp_url = f"{self.base_url}{self.MCP_PATH}"

    @property
    def provider_name(self) -> str:
        return self.PROVIDER_ID

    async def _mcp_call(
        self, access_token: str, tool_name: str, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        """Execute an MCP tool call via JSON-RPC 2.0."""
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }

        response = await self._make_request_with_retry(
            method="POST",
            url=self.mcp_url,
            access_token=access_token,
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        response.raise_for_status()

        data = response.json()
        if "error" in data:
            raise RuntimeError(f"NetSuite MCP Error: {data['error']}")

        # The result from tools/call typically has {"result": {"content": [...]}}
        return data.get("result", {})

    # -------------------------------------------------------------------------
    # NetSuite Native Tools
    # -------------------------------------------------------------------------

    async def get_record_type_metadata(
        self, access_token: str, record_type: str | None = None
    ) -> dict[str, Any]:
        """Get metadata for record types."""
        args: dict[str, Any] = {}
        if record_type:
            args["recordType"] = record_type
        return await self._mcp_call(access_token, "ns_getRecordTypeMetadata", args)

    async def get_record(
        self,
        access_token: str,
        record_type: str,
        record_id: str,
        fields: str | None = None,
    ) -> dict[str, Any]:
        """Get a single record by type and ID."""
        args: dict[str, Any] = {"recordType": record_type, "recordId": record_id}
        if fields:
            args["fields"] = fields
        return await self._mcp_call(access_token, "ns_getRecord", args)

    async def create_record(
        self, access_token: str, record_type: str, data: dict[str, Any] | str
    ) -> dict[str, Any]:
        """Create a new record. Data is auto-stringified if provided as a dict."""
        json_data = json.dumps(data) if isinstance(data, dict) else data
        return await self._mcp_call(
            access_token,
            "ns_createRecord",
            {"recordType": record_type, "data": json_data},
        )

    async def update_record(
        self,
        access_token: str,
        record_type: str,
        record_id: str,
        data: dict[str, Any] | str,
    ) -> dict[str, Any]:
        """Update an existing record."""
        json_data = json.dumps(data) if isinstance(data, dict) else data
        return await self._mcp_call(
            access_token,
            "ns_updateRecord",
            {"recordType": record_type, "recordId": record_id, "data": json_data},
        )

    async def run_suiteql(
        self,
        access_token: str,
        query: str,
        description: str,
        page_size: int | None = None,
    ) -> dict[str, Any]:
        """Execute a SuiteQL query."""
        args: dict[str, Any] = {"sqlQuery": query, "description": description}
        if page_size:
            args["pageSize"] = page_size
        return await self._mcp_call(access_token, "ns_runCustomSuiteQL", args)

    async def get_suiteql_metadata(
        self, access_token: str, record_type: str | None = None
    ) -> dict[str, Any]:
        """Get SuiteQL table/field metadata."""
        args: dict[str, Any] = {}
        if record_type:
            args["recordType"] = record_type
        return await self._mcp_call(access_token, "ns_getSuiteQLMetadata", args)

    async def list_saved_searches(
        self, access_token: str, query: str | None = None
    ) -> dict[str, Any]:
        """List saved searches."""
        args: dict[str, Any] = {}
        if query:
            args["query"] = query
        return await self._mcp_call(access_token, "ns_listSavedSearches", args)

    async def run_saved_search(
        self,
        access_token: str,
        search_id: str,
        search_type: str | None = None,
        range_start: int | None = None,
        range_end: int | None = None,
    ) -> dict[str, Any]:
        """Run a saved search."""
        args: dict[str, Any] = {"searchId": search_id}
        if search_type:
            args["type"] = search_type
        if range_start is not None:
            args["range_start"] = range_start
        if range_end is not None:
            args["range_end"] = range_end
        return await self._mcp_call(access_token, "ns_runSavedSearch", args)

    async def list_reports(self, access_token: str) -> dict[str, Any]:
        """List all available reports."""
        return await self._mcp_call(access_token, "ns_listAllReports", {})

    async def run_report(
        self,
        access_token: str,
        report_id: int,
        date_to: str,
        date_from: str | None = None,
        subsidiary_id: int | None = None,
    ) -> dict[str, Any]:
        """Run a report."""
        args: dict[str, Any] = {"reportId": report_id, "dateTo": date_to}
        if date_from:
            args["dateFrom"] = date_from
        if subsidiary_id is not None:
            args["subsidiaryId"] = subsidiary_id
        return await self._mcp_call(access_token, "ns_runReport", args)

    async def get_subsidiaries(self, access_token: str) -> dict[str, Any]:
        """Get subsidiaries for report filtering."""
        return await self._mcp_call(access_token, "ns_getSubsidiaries", {})

    # -------------------------------------------------------------------------
    # Overridden File-Methods (Not Supported by NetSuite)
    # -------------------------------------------------------------------------

    async def list_files(
        self,
        access_token: str,
        folder_id: Optional[str] = None,
        page_size: int = 100,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        raise NotImplementedError("NetSuite does not support raw file enumeration.")

    async def download_file(
        self, access_token: str, file_id: str, max_download_size: Optional[int] = None
    ) -> bytes:
        raise NotImplementedError("NetSuite does not support raw file streaming.")

    async def get_file_metadata(
        self, access_token: str, file_id: str
    ) -> OAuthFileMetadata:
        raise NotImplementedError("NetSuite does not support raw file abstraction.")

    async def search_files(
        self,
        access_token: str,
        query: str,
        folder_id: Optional[str] = None,
        page_size: int = 100,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        raise NotImplementedError(
            "NetSuite does not support unstructured file searching. Use list_saved_searches."
        )

"""Unified connect tool handlers for Synergy, S3 data bucket, and generic HTTP.

These handlers extend the oauth-workspace-tools Lambda to support all connector
types in the unified connect system. OAuth handlers remain in oauth_tools.py.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Optional

import httpx
import structlog

from prm import client as prm_client
from prm import resource as prm_resource

from .oauth_tools import (
    _get_user_consolidated_vault,
    get_available_providers,
    get_oauth_token,
)
from .synergy_helpers import (
    SynergyAuthError,
)
from .synergy_helpers import download_file as synergy_download_file
from .synergy_helpers import (
    get_folder_items,
    get_synergy_credentials,
    is_synergy_configured,
    list_job_folders,
    search_jobs,
)

logger = structlog.get_logger()

# Environment configuration
CLIENT_NAME = os.environ.get("CLIENT_NAME", "demo")
DATA_BUCKET_NAME = os.environ.get("DATA_BUCKET_NAME", "")

# Maximum file download size (50MB)
MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024


# ---------------------------------------------------------------------------
# Unified status handler
# ---------------------------------------------------------------------------


def handle_connect_status(params: Dict[str, Any]) -> Dict[str, Any]:
    """Check connection status for all connector types (OAuth + Synergy + S3 data bucket).

    Returns unified status with auth_type field for each connector.
    """
    try:
        user_sub = params.get("user_sub", "")
        connector = params.get("connector", "").strip()

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}

        result: Dict[str, Any] = {}

        # If a specific connector is requested, only check that one
        if connector == "data-bucket":
            result["data-bucket"] = {
                "status": "connected",
                "auth_type": "iam",
                "display_name": "Data Bucket",
            }
            return {"status": "success", "result": result, "error": None}

        if connector == "synergy":
            configured = is_synergy_configured(user_sub)
            result["synergy"] = {
                "status": "connected" if configured else "disconnected",
                "auth_type": "pat",
                "display_name": "Synergy 12d",
                "connect_url": "/data-connectors",
            }
            return {"status": "success", "result": result, "error": None}

        if connector:
            # Check a specific OAuth provider
            vault_data = _get_user_consolidated_vault(user_sub)
            user_secrets = vault_data.get("secrets", {}) if vault_data else {}
            secret_key = f"oauth-{connector}"
            entry = user_secrets.get(secret_key)
            if entry:
                fields = entry.get("fields") or entry
                if fields.get("access_token"):
                    result[connector] = {
                        "status": "connected",
                        "auth_type": "oauth",
                        "user_email": fields.get("user_email"),
                        "connected_at": fields.get("connected_at"),
                        "connect_url": "/files?tab=remote",
                    }
                else:
                    result[connector] = {
                        "status": "disconnected",
                        "auth_type": "oauth",
                        "connect_url": "/files?tab=remote",
                    }
            else:
                result[connector] = {
                    "status": "disconnected",
                    "auth_type": "oauth",
                    "connect_url": "/files?tab=remote",
                }
            return {"status": "success", "result": result, "error": None}

        # No specific connector — check all
        # 1. S3 data bucket (always connected)
        result["data-bucket"] = {
            "status": "connected",
            "auth_type": "iam",
            "display_name": "Data Bucket",
        }

        # 2. Synergy
        configured = is_synergy_configured(user_sub)
        result["synergy"] = {
            "status": "connected" if configured else "disconnected",
            "auth_type": "pat",
            "display_name": "Synergy 12d",
            "connect_url": "/data-connectors",
        }

        # 3. OAuth providers
        providers = get_available_providers()
        if providers:
            vault_data = _get_user_consolidated_vault(user_sub)
            user_secrets = vault_data.get("secrets", {}) if vault_data else {}

            for prov in providers:
                secret_key = f"oauth-{prov}"
                entry = user_secrets.get(secret_key)
                if entry:
                    fields = entry.get("fields") or entry
                    if fields.get("access_token"):
                        result[prov] = {
                            "status": "connected",
                            "auth_type": "oauth",
                            "user_email": fields.get("user_email"),
                            "connected_at": fields.get("connected_at"),
                            "connect_url": "/files?tab=remote",
                        }
                    else:
                        result[prov] = {
                            "status": "disconnected",
                            "auth_type": "oauth",
                            "connect_url": "/files?tab=remote",
                        }
                else:
                    result[prov] = {
                        "status": "disconnected",
                        "auth_type": "oauth",
                        "connect_url": "/files?tab=remote",
                    }

        return {"status": "success", "result": result, "error": None}

    except Exception as e:
        logger.error("Error in connect_status", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


# ---------------------------------------------------------------------------
# Synergy handlers
# ---------------------------------------------------------------------------


def handle_connect_synergy_list(params: Dict[str, Any]) -> Dict[str, Any]:
    """List Synergy jobs/folders/files using folder_id prefix routing.

    folder_id mapping:
      - None/empty → search_jobs() → return jobs as folders
      - "job:{id}" → list_job_folders(id) → return folders
      - "folder:{id}" → get_folder_items(id) → return subfolders + files
    """
    try:
        user_sub = params.get("user_sub", "")
        folder_id = params.get("folder_id", "")
        page_size = int(params.get("page_size", 50))
        query = params.get("query", "")

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}

        creds = get_synergy_credentials(user_sub)
        if not creds:
            return {
                "status": "error",
                "result": None,
                "error": "Synergy 12d not connected. Please configure it at /data-connectors",
            }

        server, token = creds

        if not folder_id:
            # Root level — list jobs
            data = search_jobs(server, token, name=query, page=1, page_size=page_size)
            folders = [
                {
                    "folder_id": f"job:{job['job_id']}",
                    "name": job["name"],
                    "path": job.get("path", ""),
                    "has_subfolders": True,
                    "no_of_subfolders": job.get("no_of_folders"),
                }
                for job in data.get("items", [])
            ]
            return {
                "status": "success",
                "result": {
                    "folders": folders,
                    "files": [],
                    "total_count": data.get("total_rows") or len(folders),
                    "connector": "synergy",
                },
                "error": None,
            }

        if folder_id.startswith("job:"):
            # Job level — list top-level folders
            job_id = folder_id[4:]
            items = list_job_folders(server, token, job_id)
            folders = [
                {
                    "folder_id": f"folder:{f['folder_id']}",
                    "name": f["name"],
                    "has_subfolders": f.get("has_subfolders", False),
                    "no_of_subfolders": f.get("no_of_subfolders"),
                }
                for f in items
            ]
            return {
                "status": "success",
                "result": {
                    "folders": folders,
                    "files": [],
                    "total_count": len(folders),
                    "connector": "synergy",
                },
                "error": None,
            }

        if folder_id.startswith("folder:"):
            # Folder level — list subfolders and files
            real_folder_id = folder_id[7:]
            data = get_folder_items(server, token, real_folder_id)
            folders = [
                {
                    "folder_id": f"folder:{f['folder_id']}",
                    "name": f["name"],
                    "has_subfolders": f.get("has_subfolders", False),
                    "no_of_subfolders": f.get("no_of_subfolders"),
                }
                for f in data.get("subfolders", [])
            ]
            files = [
                {
                    "file_id": f["file_id"],
                    "name": f["name"],
                    "size": f.get("size"),
                    "content_type": f.get("content_type"),
                    "modified_at": f.get("modified_at"),
                }
                for f in data.get("files", [])
            ]
            return {
                "status": "success",
                "result": {
                    "folders": folders,
                    "files": files,
                    "total_count": len(folders) + len(files),
                    "connector": "synergy",
                },
                "error": None,
            }

        return {
            "status": "error",
            "result": None,
            "error": f"Invalid folder_id format: {folder_id}. Use 'job:{{id}}' or 'folder:{{id}}'.",
        }

    except SynergyAuthError:
        return {
            "status": "error",
            "result": None,
            "error": "Your Synergy access token has expired. Please reconnect with new credentials.",
            "error_code": "auth_error",
        }
    except httpx.HTTPError as e:
        logger.error("Synergy API error", error=str(e))
        return {"status": "error", "result": None, "error": f"Synergy API error: {e}"}
    except Exception as e:
        logger.error("Error in connect_synergy_list", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


def handle_connect_synergy_search(params: Dict[str, Any]) -> Dict[str, Any]:
    """Search Synergy jobs by name."""
    try:
        user_sub = params.get("user_sub", "")
        query = params.get("query", "").strip()
        page_size = int(params.get("page_size", 20))

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}

        if not query:
            return {"status": "error", "result": None, "error": "Missing query"}

        creds = get_synergy_credentials(user_sub)
        if not creds:
            return {
                "status": "error",
                "result": None,
                "error": "Synergy 12d not connected. Please configure it at /data-connectors",
            }

        server, token = creds
        data = search_jobs(server, token, name=query, page=1, page_size=page_size)

        folders = [
            {
                "folder_id": f"job:{job['job_id']}",
                "name": job["name"],
                "path": job.get("path", ""),
                "has_subfolders": True,
                "no_of_subfolders": job.get("no_of_folders"),
            }
            for job in data.get("items", [])
        ]

        return {
            "status": "success",
            "result": {
                "folders": folders,
                "files": [],
                "total_count": data.get("total_rows") or len(folders),
                "query": query,
                "connector": "synergy",
            },
            "error": None,
        }

    except SynergyAuthError:
        return {
            "status": "error",
            "result": None,
            "error": "Your Synergy access token has expired. Please reconnect with new credentials.",
            "error_code": "auth_error",
        }
    except httpx.HTTPError as e:
        logger.error("Synergy search error", error=str(e))
        return {"status": "error", "result": None, "error": f"Synergy API error: {e}"}
    except Exception as e:
        logger.error("Error in connect_synergy_search", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


def handle_connect_synergy_download(params: Dict[str, Any]) -> Dict[str, Any]:
    """Download a file from Synergy."""
    try:
        user_sub = params.get("user_sub", "")
        file_id = params.get("file_id", "").strip()

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}
        if not file_id:
            return {"status": "error", "result": None, "error": "Missing file_id"}

        creds = get_synergy_credentials(user_sub)
        if not creds:
            return {
                "status": "error",
                "result": None,
                "error": "Synergy 12d not connected. Please configure it at /data-connectors",
            }

        server, token = creds
        content, filename = synergy_download_file(server, token, file_id)

        if len(content) > MAX_DOWNLOAD_SIZE:
            return {
                "status": "error",
                "result": None,
                "error": f"File too large ({len(content) // (1024 * 1024)}MB). Max is {MAX_DOWNLOAD_SIZE // (1024 * 1024)}MB.",
            }

        safe_filename = os.path.basename(filename)
        safe_filename = re.sub(r"[^\w\s.-]", "_", safe_filename)
        safe_filename = safe_filename.strip(". ") or f"synergy_{file_id[:8]}"

        return {
            "status": "success",
            "result": {
                "file_content": content.hex(),
                "filename": safe_filename,
                "workspace_path": f"/workdir/uploads/connect-synergy/{safe_filename}",
                "connector": "synergy",
                "original_file_id": file_id,
                "size": len(content),
            },
            "error": None,
        }

    except SynergyAuthError:
        return {
            "status": "error",
            "result": None,
            "error": "Your Synergy access token has expired. Please reconnect with new credentials.",
            "error_code": "auth_error",
        }
    except httpx.HTTPError as e:
        logger.error("Synergy download error", error=str(e))
        return {
            "status": "error",
            "result": None,
            "error": f"Synergy download error: {e}",
        }
    except Exception as e:
        logger.error("Error in connect_synergy_download", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


# ---------------------------------------------------------------------------
# S3 data bucket handlers
# ---------------------------------------------------------------------------


def _get_s3_client():
    """Get PRM-wrapped S3 client."""
    return prm_client("s3")


def handle_connect_s3data_list(params: Dict[str, Any]) -> Dict[str, Any]:
    """List files and folders in the S3 data bucket.

    folder_id mapping:
      - None/empty → return top-level areas (files:my, files:company)
      - "files:my" → files/user/{user_sub}/
      - "files:my/path" → files/user/{user_sub}/path/
      - "files:company" → files/company/
      - "files:company/path" → files/company/path/
    """
    try:
        user_sub = params.get("user_sub", "")
        folder_id = params.get("folder_id", "")
        page_size = int(params.get("page_size", 50))

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}

        if not DATA_BUCKET_NAME:
            return {
                "status": "error",
                "result": None,
                "error": "Data bucket not configured",
            }

        if not folder_id:
            # Root level — return top-level areas (user files + company files only)
            folders = [
                {
                    "folder_id": "files:my",
                    "name": "My Files",
                    "has_subfolders": True,
                },
                {
                    "folder_id": "files:company",
                    "name": "Company Files",
                    "has_subfolders": True,
                },
            ]
            return {
                "status": "success",
                "result": {
                    "folders": folders,
                    "files": [],
                    "total_count": len(folders),
                    "connector": "data-bucket",
                },
                "error": None,
            }

        # Resolve folder_id to S3 prefix
        s3_prefix = _resolve_s3_prefix(folder_id, user_sub)
        if s3_prefix is None:
            return {
                "status": "error",
                "result": None,
                "error": f"Invalid folder_id format: {folder_id}",
            }

        s3 = _get_s3_client()
        paginator = s3.get_paginator("list_objects_v2")
        page_iterator = paginator.paginate(
            Bucket=DATA_BUCKET_NAME,
            Prefix=s3_prefix,
            Delimiter="/",
            PaginationConfig={"MaxItems": page_size},
        )

        folders = []
        files = []

        for page in page_iterator:
            # Collect folders (common prefixes)
            for prefix_obj in page.get("CommonPrefixes", []):
                prefix = prefix_obj["Prefix"]
                folder_name = prefix[len(s3_prefix) :].rstrip("/")
                if not folder_name:
                    continue
                child_folder_id = _build_child_folder_id(folder_id, folder_name)
                folders.append(
                    {
                        "folder_id": child_folder_id,
                        "name": folder_name,
                        "has_subfolders": True,
                    }
                )

            # Collect files (objects at this level)
            for obj in page.get("Contents", []):
                key = obj["Key"]
                name = key[len(s3_prefix) :]
                if not name or name.endswith("/"):
                    continue
                # Skip metadata sidecar files
                if name.endswith(".metadata.json"):
                    continue
                files.append(
                    {
                        "file_id": key,
                        "name": name,
                        "size": obj.get("Size", 0),
                        "modified_at": (
                            obj["LastModified"].isoformat()
                            if obj.get("LastModified")
                            else None
                        ),
                    }
                )

        return {
            "status": "success",
            "result": {
                "folders": folders,
                "files": files,
                "total_count": len(folders) + len(files),
                "connector": "data-bucket",
            },
            "error": None,
        }

    except Exception as e:
        logger.error("Error in connect_s3data_list", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


def handle_connect_s3data_search(params: Dict[str, Any]) -> Dict[str, Any]:
    """Search files in the S3 data bucket by key prefix/name pattern."""
    try:
        user_sub = params.get("user_sub", "")
        query = params.get("query", "").strip()
        folder_id = params.get("folder_id", "")
        page_size = int(params.get("page_size", 20))

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}
        if not query:
            return {"status": "error", "result": None, "error": "Missing query"}
        if not DATA_BUCKET_NAME:
            return {
                "status": "error",
                "result": None,
                "error": "Data bucket not configured",
            }

        # Determine search scope
        if folder_id:
            s3_prefix = _resolve_s3_prefix(folder_id, user_sub)
            if s3_prefix is None:
                return {
                    "status": "error",
                    "result": None,
                    "error": f"Invalid folder_id: {folder_id}",
                }
        else:
            # Search everywhere the user has access
            s3_prefix = None

        s3 = _get_s3_client()
        query_lower = query.lower()
        files = []

        # Search across user-accessible prefixes
        search_prefixes = (
            [s3_prefix]
            if s3_prefix
            else [
                f"files/user/{user_sub}/",
                "files/company/",
            ]
        )

        for prefix in search_prefixes:
            paginator = s3.get_paginator("list_objects_v2")
            page_iterator = paginator.paginate(
                Bucket=DATA_BUCKET_NAME,
                Prefix=prefix,
            )

            for page in page_iterator:
                for obj in page.get("Contents", []):
                    key = obj["Key"]
                    name = key.split("/")[-1]
                    if name.endswith(".metadata.json"):
                        continue
                    if query_lower in name.lower():
                        files.append(
                            {
                                "file_id": key,
                                "name": name,
                                "path": key,
                                "size": obj.get("Size", 0),
                                "modified_at": (
                                    obj["LastModified"].isoformat()
                                    if obj.get("LastModified")
                                    else None
                                ),
                            }
                        )
                        if len(files) >= page_size:
                            break
                if len(files) >= page_size:
                    break
            if len(files) >= page_size:
                break

        return {
            "status": "success",
            "result": {
                "folders": [],
                "files": files,
                "total_count": len(files),
                "query": query,
                "connector": "data-bucket",
            },
            "error": None,
        }

    except Exception as e:
        logger.error("Error in connect_s3data_search", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


def handle_connect_s3data_download(params: Dict[str, Any]) -> Dict[str, Any]:
    """Download a file from the S3 data bucket."""
    try:
        user_sub = params.get("user_sub", "")
        file_id = params.get("file_id", "").strip()  # file_id is the S3 key

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}
        if not file_id:
            return {"status": "error", "result": None, "error": "Missing file_id"}
        if not DATA_BUCKET_NAME:
            return {
                "status": "error",
                "result": None,
                "error": "Data bucket not configured",
            }

        # Security: validate the user has access to this key
        allowed_prefixes = [
            f"files/user/{user_sub}/",
            "files/company/",
        ]
        if not any(file_id.startswith(prefix) for prefix in allowed_prefixes):
            return {
                "status": "error",
                "result": None,
                "error": "Access denied: you can only download from your own files or company files.",
            }

        s3 = _get_s3_client()
        response = s3.get_object(Bucket=DATA_BUCKET_NAME, Key=file_id)
        content = response["Body"].read()

        if len(content) > MAX_DOWNLOAD_SIZE:
            return {
                "status": "error",
                "result": None,
                "error": f"File too large ({len(content) // (1024 * 1024)}MB). Max is {MAX_DOWNLOAD_SIZE // (1024 * 1024)}MB.",
            }

        filename = file_id.split("/")[-1]
        safe_filename = os.path.basename(filename)
        safe_filename = re.sub(r"[^\w\s.-]", "_", safe_filename)
        safe_filename = safe_filename.strip(". ") or f"data_{file_id[:8]}"

        return {
            "status": "success",
            "result": {
                "file_content": content.hex(),
                "filename": safe_filename,
                "workspace_path": f"/workdir/uploads/connect-data-bucket/{safe_filename}",
                "connector": "data-bucket",
                "original_file_id": file_id,
                "size": len(content),
                "content_type": response.get("ContentType", ""),
            },
            "error": None,
        }

    except Exception as e:
        logger.error("Error in connect_s3data_download", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


# ---------------------------------------------------------------------------
# Generic HTTP handler (for ad-hoc OAuth APIs)
# ---------------------------------------------------------------------------


def handle_connect_request(params: Dict[str, Any]) -> Dict[str, Any]:
    """Make an authenticated HTTP request to any OAuth-connected API.

    Injects the user's OAuth token as a Bearer token automatically.
    """
    import asyncio

    try:
        user_sub = params.get("user_sub", "")
        connector = params.get("connector", "").strip()
        method = params.get("method", "GET").upper()
        url = params.get("url", "").strip()
        headers = params.get("headers") or {}
        body = params.get("body")
        description = params.get("description", "")

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}
        if not connector:
            return {"status": "error", "result": None, "error": "Missing connector"}
        if not url:
            return {"status": "error", "result": None, "error": "Missing url"}
        if method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
            return {
                "status": "error",
                "result": None,
                "error": f"Invalid method: {method}",
            }

        # Synergy and data-bucket don't support generic HTTP
        if connector in ("synergy", "data-bucket"):
            return {
                "status": "error",
                "result": None,
                "error": f"connect_request is not supported for {connector}. Use the dedicated list/search/download tools.",
            }

        async def do_request():
            access_token = await get_oauth_token(connector, user_sub)
            if not access_token:
                return {
                    "status": "error",
                    "result": None,
                    "error": f"No valid OAuth token for {connector}. Please connect your account at /files?tab=remote",
                }

            # Inject auth header
            request_headers = {
                "Authorization": f"Bearer {access_token}",
                **headers,
            }

            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.request(
                    method=method,
                    url=url,
                    headers=request_headers,
                    json=body if body and method in ("POST", "PUT", "PATCH") else None,
                )

            # Try to parse response as JSON
            try:
                response_body = response.json()
            except Exception:
                response_body = response.text

            return {
                "status": "success",
                "result": {
                    "status_code": response.status_code,
                    "body": response_body,
                    "headers": dict(response.headers),
                    "connector": connector,
                    "description": description,
                },
                "error": None,
            }

        return asyncio.run(do_request())

    except httpx.HTTPError as e:
        logger.error("HTTP request error", error=str(e))
        return {"status": "error", "result": None, "error": f"HTTP error: {e}"}
    except Exception as e:
        logger.error("Error in connect_request", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


# ---------------------------------------------------------------------------
# S3 prefix resolution helpers
# ---------------------------------------------------------------------------


def _resolve_s3_prefix(folder_id: str, user_sub: str) -> Optional[str]:
    """Convert a folder_id to an S3 prefix.

    Returns None if the folder_id format is invalid.
    """
    if folder_id.startswith("kb:"):
        kb_path = folder_id[3:]
        if "/" in kb_path:
            kb_id, rest = kb_path.split("/", 1)
            if kb_id == "company":
                return f"documents/company/{rest}/"
            return f"documents/kb-{kb_id}/{rest}/"
        if kb_path == "company":
            return "documents/company/"
        return f"documents/kb-{kb_path}/"

    if folder_id.startswith("files:my"):
        rest = folder_id[8:].lstrip("/")
        if rest:
            return f"files/user/{user_sub}/{rest}/"
        return f"files/user/{user_sub}/"

    if folder_id.startswith("files:company"):
        rest = folder_id[13:].lstrip("/")
        if rest:
            return f"files/company/{rest}/"
        return "files/company/"

    return None


def _build_child_folder_id(parent_folder_id: str, child_name: str) -> str:
    """Build a child folder_id from a parent folder_id and child name."""
    if parent_folder_id.startswith("kb:"):
        return f"{parent_folder_id}/{child_name}"
    if parent_folder_id.startswith("files:"):
        return f"{parent_folder_id}/{child_name}"
    return f"{parent_folder_id}/{child_name}"

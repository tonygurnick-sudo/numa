"""Synergy API helpers for browsing jobs and folders."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from connectors.synergy import _build_base_url, _normalize_token


class SynergyAuthError(ValueError):
    """Raised when Synergy returns 401/403 — token expired, revoked, or insufficient permissions."""

    def __init__(self, status_code: int, detail: str = ""):
        self.status_code = status_code
        super().__init__(
            f"Synergy authentication failed (HTTP {status_code}). {detail}".strip()
        )


def _check_response(response: httpx.Response) -> None:
    """Raise SynergyAuthError on 401/403, otherwise raise_for_status."""
    if response.status_code in (401, 403):
        detail = response.text[:200] if response.text else ""
        raise SynergyAuthError(response.status_code, detail)
    response.raise_for_status()


def search_jobs(  # pylint: disable=too-many-arguments
    server: str,
    token: str,
    name: str,
    page: int,
    page_size: int,
) -> Dict[str, Any]:
    """Search top-level jobs in Synergy."""
    base_url = _build_base_url(server)
    url = f"{base_url}/api/v1/jobs/search"
    payload = {
        "QuickSearchTerm": "",
        "Name": name or "",
        "Page": page,
        "PageSize": page_size,
        "Attributes": [
            {
                "Attribute": {
                    "Name": "TopLevel",
                    "DisplayName": "Restrict to top level?",
                },
                "Type": "SynergyServerWeb.API.Models.SelectableProgrammaticAttribute",
                "Value": True,
                "SearchQueryType": 4,
                "Operation": 0,
                "Name": "Restrict to top level?",
                "OperationName": "=",
            }
        ],
    }
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.post(url, json=payload, headers=headers, timeout=60)
    _check_response(response)
    data = response.json()
    items = data.get("Result") or data.get("Items") or data.get("items") or []
    jobs = [_normalize_job(job) for job in items if isinstance(job, dict)]
    return {
        "page": data.get("PageNumber") or data.get("pageNumber"),
        "page_size": data.get("PageSize") or data.get("pageSize"),
        "total_rows": data.get("TotalRows") or data.get("Total") or data.get("total"),
        "total_pages": data.get("TotalPages") or data.get("totalPages"),
        "items": jobs,
    }


def count_all_jobs(server: str, token: str, timeout: float = 8.0) -> Optional[int]:
    """Total number of jobs the crawl would index — ALL jobs incl sub-jobs.

    Mirrors the coordinator's enumeration scope (TopLevel = False, NOT search_jobs'
    top-level-only default) so the count matches what a full sync actually indexes.
    One cheap call: PageSize=1 → TotalRows is the exact count (and TotalPages == the
    row count at PageSize=1, used as a fallback). Best-effort — returns None on any
    error so the index overview never blocks or fails on the live count.
    """
    base_url = _build_base_url(server)
    url = f"{base_url}/api/v1/jobs/search"
    payload = {
        "QuickSearchTerm": "",
        "Name": "",
        "Page": 1,
        "PageSize": 1,
        "Attributes": [
            {
                "Attribute": {
                    "Name": "TopLevel",
                    "DisplayName": "Restrict to top level?",
                },
                "Type": "SynergyServerWeb.API.Models.SelectableProgrammaticAttribute",
                "Value": False,
                "SearchQueryType": 4,
                "Operation": 0,
                "Name": "Restrict to top level?",
                "OperationName": "=",
            }
        ],
    }
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    try:
        response = httpx.post(url, json=payload, headers=headers, timeout=timeout)
        response.raise_for_status()
        data = response.json()
        total = data.get("TotalRows") or data.get("Total") or data.get("total")
        if total is None:
            # PageSize=1 → TotalPages equals the row count.
            total = data.get("TotalPages") or data.get("totalPages")
        return int(total) if total is not None else None
    except Exception:  # noqa: BLE001 — best-effort live count; never break the overview
        return None


def list_job_folders(
    server: str,
    token: str,
    job_id: str,
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    """Return top-level folders for a job, with pagination metadata.

    The upstream Synergy `/api/v1/jobs/{id}/items` endpoint always returns
    every folder in one shot — there's no `Page`/`PageSize` support on that
    route. We therefore fetch the whole list once and slice in-memory. This
    is still a win because:

    * For a job with thousands of folders, returning all of them in one
      API response causes the Files UI to render a huge tree at once,
      which is what causes the "loads forever" experience users see.
    * The total folder count for a job (`no_of_folders` from the job
      record) is usually modest, so the upstream call itself is fast.
    """
    base_url = _build_base_url(server)
    url = f"{base_url}/api/v1/jobs/{job_id}/items"
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(url, headers=headers, timeout=60)
    _check_response(response)
    data = response.json()
    items = (
        data.get("SubFolders")
        or data.get("Result")
        or data.get("Items")
        or data.get("items")
        or []
    )
    all_folders = [
        _normalize_folder(folder) for folder in items if isinstance(folder, dict)
    ]
    total = len(all_folders)
    page = max(1, page)
    page_size = max(1, page_size)
    start = (page - 1) * page_size
    end = start + page_size
    page_folders = all_folders[start:end]
    total_pages = max(1, (total + page_size - 1) // page_size)
    return {
        "items": page_folders,
        "page": page,
        "page_size": page_size,
        "total_rows": total,
        "total_pages": total_pages,
    }


def get_folder_items(
    server: str,
    token: str,
    folder_id: str,
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    """Return a folder's subfolders and a real page of its files.

    Synergy's `/api/v1/folders/{id}/items` is a single-shot composite whose
    `Files` field is only ever page 1, returned at Synergy's own
    (uncontrollable) default page size — `/items` has no way to request a
    different page or size. We previously sliced that single page in memory,
    which silently capped every folder at ~one Synergy page of files and made
    "Load more" exhaust before the real files were ever fetched.

    To page through the whole folder we drive files off the dedicated
    paginated endpoint instead (Style 2, path pagination):

        GET /api/v1/folders/{id}/files/{retrieve_attrs}/{page}/{page_size}/{filter}/{show_deleted}

    which returns a proper `PagedResultModel` we can walk via `TotalPages`.
    `retrieve_attributes=true` gives size/date metadata, `*` = no filter,
    `show_deleted=false`.

    Subfolders don't paginate (Synergy returns them all in one shot via
    `/items`), so we fetch them once on page 1 and return an empty list on
    later pages — the caller keeps the page-1 subfolders while the user pages
    through files.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    page = max(1, page)
    page_size = max(1, page_size)

    # Files: dedicated paginated endpoint so every page is consistent.
    # The {filter} segment is a SQL LIKE pattern — `%25` is the URL-encoded
    # `%` wildcard (match all). A literal `*` matches nothing on 12d, which
    # is what silently returned an empty folder.
    files_url = (
        f"{base_url}/api/v1/folders/{folder_id}/files"
        f"/true/{page}/{page_size}/%25/false"
    )
    files_response = httpx.get(files_url, headers=headers, timeout=60)
    _check_response(files_response)
    files_data = files_response.json() or {}
    file_items = (
        files_data.get("Result")
        or files_data.get("Items")
        or files_data.get("items")
        or []
    )
    files = [_normalize_file(f) for f in file_items if isinstance(f, dict)]
    files_total = (
        files_data.get("TotalRows")
        or files_data.get("Total")
        or files_data.get("total")
        or len(files)
    )
    total_pages = files_data.get("TotalPages") or files_data.get("totalPages") or 1
    page_number = files_data.get("PageNumber") or files_data.get("pageNumber") or page
    resolved_page_size = (
        files_data.get("PageSize") or files_data.get("pageSize") or page_size
    )

    # Subfolders only on the first page — they don't paginate.
    subfolders: List[Dict[str, Any]] = []
    if page == 1:
        items_response = httpx.get(
            f"{base_url}/api/v1/folders/{folder_id}/items",
            headers=headers,
            timeout=60,
        )
        _check_response(items_response)
        items_data = items_response.json() or {}
        subfolders = [
            _normalize_folder(folder)
            for folder in items_data.get("SubFolders", [])
            if isinstance(folder, dict)
        ]

    return {
        "folder_id": folder_id,
        "subfolders": subfolders,
        "files": files,
        "files_total": files_total,
        "page": page_number,
        "page_size": resolved_page_size,
        "total_rows": files_total,
        "total_pages": total_pages,
    }


def _normalize_job(job: Dict[str, Any]) -> Dict[str, Any]:
    job_id = (job.get("ID") or {}).get("IDString")
    return {
        "job_id": job_id or job.get("IDString"),
        "name": job.get("Name"),
        "description": job.get("Description"),
        "path": job.get("Path"),
        "no_of_folders": job.get("NoOfFolders"),
        "no_of_children": job.get("NoOfChildren"),
    }


def _attr_value(attributes: Any, *names: str) -> Any:
    """Return the value of a 12d custom/system attribute by (display) name.

    12d file objects carry an `Attributes` array of attribute *definitions*,
    each with a snake_case `name`/`display_name` and the per-file value under
    `value._value` (verified live: e.g. Revision -> value._value == "D",
    Document Status is an enum with the same value shape). Revision and
    Document Status are NOT top-level fields — they live here. Returns None if
    the attribute isn't present (e.g. the folder-list response omits Attributes
    on some instances), so callers degrade gracefully.
    """
    if not isinstance(attributes, list):
        return None
    # Attributes carry BOTH snake_case `name` ("document_status") and human
    # `display_name` ("Document Status"); instances vary in which is populated.
    # Check both, normalizing underscores, so either shape matches.
    wanted = {n.strip().lower().replace("_", " ") for n in names}
    for attr in attributes:
        if not isinstance(attr, dict):
            continue
        candidates = (attr.get("name"), attr.get("display_name"))
        normalized = {str(c).strip().lower().replace("_", " ") for c in candidates if c}
        if normalized & wanted:
            value = attr.get("value")
            if isinstance(value, dict):
                return value.get("_value")
            return value
    return None


def _normalize_file(file: Dict[str, Any]) -> Dict[str, Any]:
    file_id = (file.get("ID") or {}).get("IDString")
    attributes = file.get("Attributes")
    active_checkout = file.get("ActiveCheckout") or {}
    return {
        "file_id": file_id or file.get("IDString"),
        "name": file.get("FileName") or file.get("Name"),
        "size": file.get("FileSize") or file.get("Size"),
        "size_readable": file.get("SizeReadable"),
        "content_type": file.get("ContentType")
        or file.get("MimeType")
        or file.get("FileType"),
        # 12d's per-version timestamp; LastChangedTime is the server change,
        # LastModified the content mtime — prefer the former, fall back through.
        "modified_at": file.get("LastChangedTime")
        or file.get("ModifiedDate")
        or file.get("LastModified"),
        "created_on": file.get("CreatedOn") or file.get("CreationDate"),
        "version": file.get("LatestVersion") or file.get("Version"),
        "state": file.get("State"),
        "last_changed_by": file.get("LastChangedBy"),
        "file_type": file.get("FileType"),
        "path": file.get("Path"),
        "is_checked_out": bool(file.get("IsCheckedOut") or file.get("ActiveCheckout")),
        # ActiveCheckout is null when not checked out; field name for the holder
        # is unconfirmed live, so probe the likely keys defensively.
        "checked_out_by": (
            active_checkout.get("UserName")
            or active_checkout.get("User")
            or active_checkout.get("CheckedOutBy")
            or active_checkout.get("ContactName")
            if isinstance(active_checkout, dict)
            else None
        ),
        # Revision + Document Status are custom attributes, not top-level fields.
        "revision": _attr_value(attributes, "Revision"),
        "document_status": _attr_value(
            attributes, "Document Status", "Status", "Drawing Status"
        ),
    }


def _normalize_folder(folder: Dict[str, Any]) -> Dict[str, Any]:
    folder_id = (folder.get("ID") or {}).get("IDString")
    return {
        "folder_id": folder_id or folder.get("IDString"),
        "name": folder.get("Name"),
        "has_subfolders": folder.get("HasSubFolders")
        or (folder.get("NoOfSubFolders") or 0) > 0,
        "no_of_subfolders": folder.get("NoOfSubFolders"),
        "folder_type": folder.get("FolderType"),
    }


# ---------------------------------------------------------------------------
# File search / details / history / weblink (read parity with the 12d web UI)
#
# NOTE: these endpoint bodies/shapes are from the 12d API docs + the fields
# observed live, but the live POST /files/search body has 500'd on a partial
# payload before — verify the working body against the instance before relying
# on it in production.
# ---------------------------------------------------------------------------

# LimitSearchTo on FileSearchModel. File search is ALWAYS job-scoped — there is
# no working "all jobs" search (an unscoped/`0` body returns HTTP 500 on the live
# instance), and the 12d web client itself always scopes to a job. `2` = the job
# and its sub-jobs (captured from the web client). Verified live on cuttriss.
_SEARCH_SCOPE_JOB_AND_SUBJOBS = 2


def _build_limit_id(id_string: str) -> Dict[str, Any]:
    """Build a 12d ``LimitID`` object from an ``N_N`` IDString.

    12d's ``/files/search`` needs the *server* id as well as the entity id:
    ``"8_1"`` -> ``{"_id": 8, "_server_id": 1, "IDString": "8_1"}``. Sending only
    ``IDString`` returns HTTP 500 ("Object reference not set to an instance of an
    object") — that malformed payload is why early file-search attempts failed.
    """
    obj: Dict[str, Any] = {"IDString": id_string}
    parts = (id_string or "").split("_")
    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
        obj["_id"] = int(parts[0])
        obj["_server_id"] = int(parts[1])
    return obj


def search_files(
    server: str,
    token: str,
    query: str,
    job_id: str,
    page_size: int = 50,
    show_deleted: bool = False,
) -> Dict[str, Any]:
    """Search files *within a job* by name AND full-text contents, merged.

    12d file search is job-scoped: ``LimitSearchTo=2`` (the job + its sub-jobs)
    plus the job's full ``LimitID`` (which must include ``_server_id``). There is
    no global file search — callers resolve a job first, then search inside it.
    The filename and content searches are issued separately and merged (deduped
    by ``file_id``) so one query matches both names and document bodies.
    """
    if not job_id:
        raise ValueError(
            "A job scope (job_id) is required — Synergy has no global file search."
        )

    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    base_body: Dict[str, Any] = {
        "Page": 1,
        "PageSize": max(1, page_size),
        "Attributes": [],
        "ShowDeletedFiles": show_deleted,
        "RetrieveAttributes": True,
        "LimitSearchTo": _SEARCH_SCOPE_JOB_AND_SUBJOBS,
        "LimitID": _build_limit_id(job_id),
    }

    merged: Dict[str, Dict[str, Any]] = {}
    for field in ("FileName", "Contents"):
        response = httpx.post(
            f"{base_url}/api/v1/files/search",
            json={**base_body, field: query},
            headers=headers,
            timeout=90,
        )
        _check_response(response)
        data = response.json() or {}
        items = data.get("Result") or data.get("Items") or data.get("items") or []
        for raw in items:
            if not isinstance(raw, dict):
                continue
            normalized = _normalize_file(raw)
            fid = normalized.get("file_id")
            if fid and fid not in merged:
                merged[fid] = normalized

    files = list(merged.values())
    return {
        "items": files,
        "job_id": job_id,
        "query": query,
        "total_rows": len(files),
    }


def get_file_details(server: str, token: str, file_id: str) -> Dict[str, Any]:
    """Return full normalized metadata for a single file (GET /files/{id}/true)."""
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(
        f"{base_url}/api/v1/files/{file_id}/true", headers=headers, timeout=60
    )
    _check_response(response)
    return _normalize_file(response.json() or {})


def _normalize_history_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d file-history row (snake_case `History[]` items)."""
    return {
        "version": entry.get("version"),
        "changed_by": entry.get("change_by")
        or (entry.get("contact_info") or {}).get("name"),
        "changed_at": entry.get("utc_change_time"),
        "change_type": entry.get("change_type"),
    }


def get_file_history(
    server: str, token: str, file_id: str, page: int = 1, page_size: int = 50
) -> Dict[str, Any]:
    """Return a page of a file's version history (GET /files/{id}/history/...).

    12d returns the rows under a `History` key (not `Result`), snake_case.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(
        f"{base_url}/api/v1/files/{file_id}/history/true/{max(1, page)}/{max(1, page_size)}",
        headers=headers,
        timeout=60,
    )
    _check_response(response)
    data = response.json() or {}
    rows = data.get("History") or data.get("Result") or data.get("Items") or []
    return {
        "items": [_normalize_history_entry(r) for r in rows if isinstance(r, dict)],
        "page": data.get("PageNumber") or page,
        "page_size": data.get("PageSize") or page_size,
        "total_rows": data.get("TotalRows") or len(rows),
        "total_pages": data.get("TotalPages") or 1,
    }


def get_file_weblink(server: str, token: str, file_id: str) -> Dict[str, Any]:
    """Return a shareable web link to a file (GET /files/{id}/weblink/true)."""
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(
        f"{base_url}/api/v1/files/{file_id}/weblink/true", headers=headers, timeout=60
    )
    _check_response(response)
    # Endpoint returns a bare JSON string URL.
    try:
        url = response.json()
    except ValueError:
        url = response.text
    if isinstance(url, dict):
        url = url.get("WebLink") or url.get("Url") or url.get("url")
    return {"weblink": url}

"""Minimal, self-contained 12d Synergy REST client for the KB crawler.

Ported from ``tools/synergy_text_crawler.py``. Deliberately has no dependency on
the ``data-connectors`` package so the worker/coordinator images stay small and
decoupled. Only the three calls the crawl needs are implemented:

- ``iter_jobs``         — enumerate every job (incl. sub-jobs) for the coordinator
- ``list_job_files_page`` — one page of a job's files (cursor-friendly)
- ``download``          — raw bytes of a file version

File search is ALWAYS job-scoped (``LimitSearchTo=2`` = job + sub-jobs) with the
job's full ``LimitID`` (which must include ``_server_id``, parsed from the ``N_N``
IDString) — there is no global file search on 12d.
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, Iterator, List, Optional, Tuple

import httpx


class SynergyAuthError(RuntimeError):
    """PAT expired / revoked / insufficient permissions (HTTP 401/403)."""

    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"Synergy auth failed (HTTP {status_code})")


class JobPageError(RuntimeError):
    """A job-level file listing failed (HTTP >= 400, after retries).

    Distinct from "job has no files": callers must NOT treat a failed listing as
    an empty job — the deletion sweep would wrongly purge the job's corpus.
    """

    def __init__(self, job_id: str, status_code: int):
        self.job_id = job_id
        self.status_code = status_code
        super().__init__(f"files/search failed for job {job_id} (HTTP {status_code})")


class Synergy:
    def __init__(self, base_url: str, pat: str, timeout: float = 120.0):
        self.base = base_url.rstrip("/")
        token = (pat or "").strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        self.h = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        self.client = httpx.Client(timeout=timeout)
        # Proactive pacing: enforce a floor between outbound requests so a full
        # corpus crawl doesn't flood the customer's (typically on-prem) 12d
        # server. The per-request retry/backoff below only reacts AFTER the
        # server starts returning 429/5xx; this caps the steady-state rate. Set
        # SYNERGY_CRAWL_MIN_REQUEST_INTERVAL_MS=0 to disable.
        self._min_interval = max(
            0.0,
            float(os.getenv("SYNERGY_CRAWL_MIN_REQUEST_INTERVAL_MS", "100")) / 1000.0,
        )
        self._last_request_at = 0.0

    def _throttle(self) -> None:
        """Sleep just enough to honour the minimum inter-request interval."""
        if self._min_interval <= 0:
            return
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_request_at = time.monotonic()

    def close(self) -> None:
        self.client.close()

    def _post(self, path: str, body: dict, retries: int = 4) -> httpx.Response:
        url = f"{self.base}{path}"
        resp: Optional[httpx.Response] = None
        for attempt in range(retries):
            try:
                self._throttle()
                resp = self.client.post(url, headers=self.h, json=body)
            except httpx.HTTPError:
                if attempt == retries - 1:
                    raise
                time.sleep(2**attempt)
                continue
            if resp.status_code in (401, 403):
                raise SynergyAuthError(resp.status_code)
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt == retries - 1:
                    return resp
                time.sleep(2**attempt)
                continue
            return resp
        assert resp is not None
        return resp

    @staticmethod
    def _build_limit_id(job_idstring: str) -> Optional[Dict[str, Any]]:
        parts = (job_idstring or "").split("_")
        if len(parts) != 2 or not all(p.isdigit() for p in parts):
            return None
        return {
            "IDString": job_idstring,
            "_id": int(parts[0]),
            "_server_id": int(parts[1]),
        }

    def iter_jobs(self, page_size: int = 100) -> Iterator[dict]:
        """Yield every job. ``TopLevel=false`` returns all jobs incl. sub-jobs."""
        page = 1
        while True:
            body = {
                "Page": page,
                "PageSize": page_size,
                "Name": "",
                "QuickSearchTerm": "",
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
            r = self._post("/api/v1/jobs/search", body)
            r.raise_for_status()
            d = r.json()
            rows = d.get("Result") or d.get("Items") or []
            for row in rows:
                yield row
            total_pages = d.get("TotalPages") or 0
            if page >= total_pages or not rows:
                break
            page += 1

    def list_job_files_page(
        self, job_idstring: str, page: int, page_size: int = 100
    ) -> Tuple[List[dict], int]:
        """Return one page of a job's files plus the job's total page count.

        ``LimitSearchTo=2`` scopes to the job and its sub-jobs (the only working
        file scope). A malformed job id yields ``([], 0)`` (nothing to crawl);
        an HTTP error raises ``JobPageError`` — callers must distinguish "failed
        to list" from "genuinely empty" or the deletion sweep would wrongly
        purge a job's corpus on a transient 500.
        """
        limit_id = self._build_limit_id(job_idstring)
        if limit_id is None:
            return [], 0
        body = {
            "Page": page,
            "PageSize": page_size,
            "Attributes": [],
            "ShowDeletedFiles": False,
            "RetrieveAttributes": True,
            "FileName": "",
            "Contents": "",
            "LimitSearchTo": 2,
            "LimitID": limit_id,
        }
        r = self._post("/api/v1/files/search", body)
        if r.status_code >= 400:
            raise JobPageError(job_idstring, r.status_code)
        d = r.json()
        rows = d.get("Result") or d.get("Items") or []
        total_pages = int(d.get("TotalPages") or 0)
        return rows, total_pages

    def get_weblink(self, file_id: str) -> str:
        """Best-effort shareable web link for a file ('' on any failure)."""
        try:
            self._throttle()
            r = self.client.get(
                f"{self.base}/api/v1/files/{file_id}/weblink/true", headers=self.h
            )
            if r.status_code >= 400:
                return ""
            try:
                url = r.json()
            except ValueError:
                url = r.text
            if isinstance(url, dict):
                url = url.get("WebLink") or url.get("Url") or url.get("url")
            return str(url).strip() if url else ""
        except httpx.HTTPError:
            return ""

    def download(self, file_id: str, version: int, retries: int = 3) -> bytes:
        """Download raw file bytes (POST with empty body — verified working).

        Retries transient failures (5xx/429/network) with backoff: a single
        transient error here would otherwise count the file as errored and
        leave it unindexed for a whole crawl cycle.
        """
        url = (
            f"{self.base}/api/v1/files/{file_id}/download"
            f"?version={version}&with_references=false"
        )
        r: Optional[httpx.Response] = None
        for attempt in range(retries):
            try:
                self._throttle()
                r = self.client.post(
                    url,
                    headers={**self.h, "Content-Type": "application/octet-stream"},
                    content=b"",
                )
            except httpx.HTTPError:
                if attempt == retries - 1:
                    raise
                time.sleep(2**attempt)
                continue
            if r.status_code in (401, 403):
                raise SynergyAuthError(r.status_code)
            if r.status_code == 429 or r.status_code >= 500:
                if attempt == retries - 1:
                    r.raise_for_status()
                time.sleep(2**attempt)
                continue
            r.raise_for_status()
            return r.content
        assert r is not None
        r.raise_for_status()
        return r.content

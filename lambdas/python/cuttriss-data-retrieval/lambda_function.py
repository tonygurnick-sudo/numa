# lambdas/python/synergy_downloader/main.py
import csv
import io
import json
import logging
import mimetypes
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urljoin

import boto3
import botocore
import requests
from requests.adapters import HTTPAdapter, Retry

# If your repo uses structlog/powertools consistently, you can swap these in:
try:
    import structlog

    logger = structlog.get_logger()
except Exception:
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

# ---- Env vars (configure in IaC) ----
ENV_SYNERGY_BASE_URL = os.getenv("SYNERGY_BASE_URL", "").rstrip("/")
ENV_SYNERGY_PAT_SECRET_NAME = os.getenv("SYNERGY_PAT_SECRET_NAME", "synergy/pat")

ENV_DEFAULT_S3_BUCKET = os.getenv("S3_BUCKET", "")
ENV_DEFAULT_S3_PREFIX = os.getenv(
    "S3_PREFIX", "documents/company/synergy12d-documents/"
)

# Behavior flags
ENV_WITH_REFERENCES = os.getenv("WITH_REFERENCES", "false").lower() == "true"
ENV_FORCE_OVERWRITE = os.getenv("FORCE_OVERWRITE", "false").lower() == "true"
ENV_USE_SYNERGY_PATHS = (
    os.getenv("USE_SYNERGY_PATHS", "true").lower() == "true"
)  # keep Synergy path dirs in S3
ENV_ENABLE_DELETION = os.getenv("ENABLE_DELETION", "false").lower() == "true"

# Filters (comma-separated globs, optional)
ENV_INCLUDE_GLOBS = [
    g.strip() for g in os.getenv("INCLUDE_GLOBS", "").split(",") if g.strip()
]
ENV_EXCLUDE_GLOBS = [
    g.strip() for g in os.getenv("EXCLUDE_GLOBS", "").split(",") if g.strip()
]

# Networking/timeouts
ENV_HTTP_TIMEOUT = float(os.getenv("HTTP_TIMEOUT_SEC", "60"))
ENV_MAX_RETRIES = int(os.getenv("HTTP_MAX_RETRIES", "5"))
ENV_RETRY_BACKOFF = float(os.getenv("HTTP_BACKOFF_SEC", "0.5"))

# Pagination defaults
ENV_PAGE_SIZE = int(os.getenv("PAGE_SIZE", "100"))

# Probe/discovery defaults
ENV_DEFAULT_SYNC_MODE = os.getenv("SYNC_MODE", "probe").strip().lower()
ENV_SYNERGY_SERVER_ID = int(os.getenv("SYNERGY_SERVER_ID", "1"))
ENV_PROBE_RANGE_START = int(
    os.getenv("PROBE_RANGE_START", os.getenv("FOLDER_ID_RANGE_START", "1"))
)
ENV_PROBE_RANGE_END = int(
    os.getenv("PROBE_RANGE_END", os.getenv("FOLDER_ID_RANGE_END", "10000"))
)
ENV_PROBE_CHUNK_SIZE = int(
    os.getenv("PROBE_CHUNK_SIZE", os.getenv("FOLDER_ID_CHUNK_SIZE", "250"))
)
ENV_PROBE_STATE_TABLE = os.getenv("PROBE_STATE_TABLE")
ENV_PROBE_STATE_KEY = os.getenv("PROBE_STATE_KEY", "synergy-cuttriss")
ENV_PROBE_STATE_PK_ATTR = os.getenv("PROBE_STATE_PK_ATTR", "stateId")

# Boto3 clients
s3 = boto3.client("s3")
secrets = boto3.client("secretsmanager")
dynamodb = boto3.resource("dynamodb")

# ----- Helpers ---------------------------------------------------------------


def get_secret_pat(secret_name: str) -> str:
    resp = secrets.get_secret_value(SecretId=secret_name)
    # Accept either raw string or JSON with {"token": "..."}
    if "SecretString" in resp:
        val = resp["SecretString"]
        try:
            data = json.loads(val)
            token = data.get("token") or data.get("PAT") or data.get("pat")
            return token if token else val  # fallback to full string
        except Exception:
            return val
    raise RuntimeError("PAT secret missing SecretString")


def make_session() -> requests.Session:
    s = requests.Session()
    retries = Retry(
        total=ENV_MAX_RETRIES,
        read=ENV_MAX_RETRIES,
        connect=ENV_MAX_RETRIES,
        backoff_factor=ENV_RETRY_BACKOFF,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
    )
    adapter = HTTPAdapter(max_retries=retries, pool_maxsize=50)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def _event_int(
    event: Dict[str, Any], key: str, default: Optional[int]
) -> Optional[int]:
    if key not in event:
        return default
    value = event[key]
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key} must be an integer (got {value!r})")


class ProbeStateManager:
    """Tracks the next numeric folder ID to sweep so runs can resume where they stopped."""

    def __init__(
        self, table_name: Optional[str], state_key: str, pk_attr: str = "stateId"
    ):
        self.table_name = table_name
        self.state_key = state_key
        self.pk_attr = pk_attr or "stateId"
        self.table = None
        if table_name:
            self.table = dynamodb.Table(table_name)

    def load_next_start(self, default_start: int) -> int:
        if not self.table:
            return default_start
        try:
            resp = self.table.get_item(Key={self.pk_attr: self.state_key})
        except Exception as exc:
            logger.warning(
                "Failed to load probe cursor", table=self.table_name, error=str(exc)
            )
            return default_start
        item = resp.get("Item")
        if not item:
            return default_start
        raw = item.get("nextStartId") or item.get("next_start_id")
        if raw is None:
            return default_start
        try:
            return int(raw)
        except (TypeError, ValueError):
            logger.warning(
                "Invalid nextStartId in probe state", table=self.table_name, value=raw
            )
            return default_start

    def save_next_start(
        self, next_start: int, extra: Optional[Dict[str, Any]] = None
    ) -> None:
        if not self.table:
            return
        payload: Dict[str, Any] = {
            self.pk_attr: self.state_key,
            "nextStartId": int(next_start),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        if extra:
            payload.update(extra)
        try:
            self.table.put_item(Item=payload)
        except Exception as exc:
            logger.warning(
                "Failed to persist probe cursor", table=self.table_name, error=str(exc)
            )


class ManifestStore:
    """Persists per-folder manifests so we can detect path/version changes and deletions."""

    def __init__(self, bucket: str, base_prefix: str, s3_client=None):
        self.bucket = bucket
        self.s3_client = s3_client or s3
        prefix = (base_prefix or "").strip("/")
        manifest_prefix_parts = [p for p in [prefix, ".sync-manifests"] if p]
        self.manifest_prefix = "/".join(manifest_prefix_parts)

    def _key(self, folder_id: str) -> str:
        if not self.manifest_prefix:
            return f".sync-manifests/{folder_id}.json"
        return f"{self.manifest_prefix}/{folder_id}.json"

    def load(self, folder_id: str) -> Dict[str, Any]:
        key = self._key(folder_id)
        try:
            resp = self.s3_client.get_object(Bucket=self.bucket, Key=key)
            raw = resp["Body"].read()
            return json.loads(raw.decode("utf-8"))
        except botocore.exceptions.ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code in ("NoSuchKey", "NotFound"):
                return {}
            logger.warning("Failed to load manifest", folder=folder_id, error=str(exc))
            return {}
        except Exception as exc:
            logger.warning("Manifest load error", folder=folder_id, error=str(exc))
            return {}

    def save(self, folder_id: str, data: Dict[str, Any]) -> None:
        key = self._key(folder_id)
        body = json.dumps(data, separators=(",", ":")).encode("utf-8")
        self.s3_client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType="application/json",
        )


def _resolve_storage_config(event: Dict[str, Any]) -> tuple[str, str, str]:
    base_url = ENV_SYNERGY_BASE_URL
    if not base_url:
        raise RuntimeError("SYNERGY_BASE_URL env var is required")

    s3_bucket = event.get("s3Bucket") or ENV_DEFAULT_S3_BUCKET
    if not s3_bucket:
        raise RuntimeError(
            "S3 bucket must be provided via event.s3Bucket or env S3_BUCKET"
        )
    s3_prefix = (event.get("s3Prefix") or ENV_DEFAULT_S3_PREFIX).lstrip("/")

    return base_url, s3_bucket, s3_prefix


def _apply_behavior_overrides(event: Dict[str, Any]) -> None:
    global ENV_WITH_REFERENCES, ENV_FORCE_OVERWRITE, ENV_USE_SYNERGY_PATHS
    global ENV_INCLUDE_GLOBS, ENV_EXCLUDE_GLOBS, ENV_PAGE_SIZE

    if "withReferences" in event:
        ENV_WITH_REFERENCES = bool(event["withReferences"])
    if "forceOverwrite" in event:
        ENV_FORCE_OVERWRITE = bool(event["forceOverwrite"])
    if "useSynergyPaths" in event:
        ENV_USE_SYNERGY_PATHS = bool(event["useSynergyPaths"])
    if "includeGlobs" in event:
        ENV_INCLUDE_GLOBS = event["includeGlobs"] or []
    if "excludeGlobs" in event:
        ENV_EXCLUDE_GLOBS = event["excludeGlobs"] or []
    if "pageSize" in event:
        ENV_PAGE_SIZE = int(event["pageSize"])


def _build_totals(folder_count: int, summaries: List[Dict[str, Any]]) -> Dict[str, int]:
    return {
        "folders": folder_count,
        "files_seen": sum(s.get("total_seen", 0) for s in summaries),
        "uploaded": sum(s.get("uploaded", 0) for s in summaries),
        "skipped": sum(s.get("skipped", 0) for s in summaries),
        "errors": sum(s.get("errors", 0) for s in summaries),
        "deleted": sum(s.get("deleted", 0) for s in summaries),
    }


def glob_match(name: str, patterns: List[str]) -> bool:
    if not patterns:
        return False
    import fnmatch

    return any(fnmatch.fnmatch(name, pat) for pat in patterns)


def should_skip(name: str) -> bool:
    """Return True if this file name should be skipped based on include/exclude globs."""
    if ENV_INCLUDE_GLOBS and not glob_match(name, ENV_INCLUDE_GLOBS):
        return True
    if ENV_EXCLUDE_GLOBS and glob_match(name, ENV_EXCLUDE_GLOBS):
        return True
    return False


def s3_key_for_file(file_obj: Dict[str, Any], version: int, base_prefix: str) -> str:
    """
    Build an S3 key. If USE_SYNERGY_PATHS=true and 'SynergyPath' is present, we mirror it.
    Fall back to <FileId>__v<version>/<FileName> to avoid collisions.
    """
    # Try to use SynergyPath (something like "\Jobs\ProjectA\CAD\1 Grading_A.dwg")
    sy_path = file_obj.get("SynergyPath") or file_obj.get("Path") or ""
    file_name = (
        file_obj.get("Name")
        or file_obj.get("FileName")
        or f"{file_obj.get('IDString','file')}"
    )
    file_id = file_obj.get("IDString", "unknown")

    safe_name = file_name.replace("\\", "/")
    if ENV_USE_SYNERGY_PATHS and sy_path:
        # Normalize to s3-friendly path
        norm = sy_path.replace("\\", "/").lstrip("/")
        if not norm.endswith("/"):
            # Some SynergyPath includes the file name already; avoid duplication
            if norm.split("/")[-1].lower() == safe_name.lower():
                key = f"{base_prefix}{norm}__v{version}"
            else:
                key = f"{base_prefix}{norm}/{safe_name}__v{version}"
        else:
            key = f"{base_prefix}{norm}{safe_name}__v{version}"
    else:
        key = f"{base_prefix}{file_id}__v{version}/{safe_name}"
    return key


def get_file_details(
    sess: requests.Session,
    base_url: str,
    pat: str,
    file_id_str: str,
    retrieve_attributes: bool = True,
) -> Dict[str, Any]:
    """
    GET /api/v1/files/{id}?retrieve_attributes=true
    Returns the canonical file metadata, including FileName, FileType, Attributes, etc.
    """
    qs = f"?retrieve_attributes={'true' if retrieve_attributes else 'false'}"
    url = urljoin(base_url + "/", f"api/v1/files/{quote(file_id_str, safe='')}{qs}")
    headers = {"Authorization": f"Bearer {pat}", "Content-Type": "application/json"}
    try:
        resp = sess.get(url, headers=headers, timeout=ENV_HTTP_TIMEOUT)
    except requests.exceptions.RequestException as exc:
        logger.warning(
            "folders/{id}/items request error", folder=folder_id_str, error=str(exc)
        )
        return {}
    if resp.status_code == 401:
        raise RuntimeError("Unauthorized – PAT likely invalid or expired")
    resp.raise_for_status()
    return resp.json()


def guess_content_type(
    file_name: Optional[str], file_type_hint: Optional[str] = None
) -> str:
    """
    Best-effort MIME type resolution using filename extension first, then Synergy's FileType hint.
    """
    if file_name:
        ctype, _ = mimetypes.guess_type(file_name, strict=False)
        if ctype:
            return ctype

    if file_type_hint:
        hint = file_type_hint.lower()
        mapping = {
            "pdf": "application/pdf",
            "dwg": "image/vnd.dwg",
            "dxf": "image/vnd.dxf",
            "txt": "text/plain",
            "csv": "text/csv",
            "xls": "application/vnd.ms-excel",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "doc": "application/msword",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }
        for needle, mime in mapping.items():
            if needle in hint:
                return mime

    return "application/octet-stream"


def sanitize_metadata_key(name: str) -> Optional[str]:
    if not name:
        return None
    slug = re.sub(r"[^a-z0-9\-]+", "-", name.strip().lower())
    slug = slug.strip("-")
    return slug or None


def extract_attribute_metadata(file_obj: Dict[str, Any]) -> Dict[str, str]:
    """
    Convert Synergy Attributes array into lightweight S3 metadata entries.
    Keys are prefixed with attr- to avoid clashes with reserved headers.
    """
    attrs = file_obj.get("Attributes")
    if not isinstance(attrs, list):
        return {}

    metadata: Dict[str, str] = {}
    for attr in attrs:
        name = attr.get("name") or attr.get("display_name")
        key = sanitize_metadata_key(name)
        if not key:
            continue

        value = attr.get("value") or attr.get("Value") or attr.get("DefaultValue")
        resolved: Optional[str] = None
        if isinstance(value, dict):
            resolved = value.get("_value") or value.get("value") or value.get("Value")
            coord = value.get("_coordinate")
            if resolved is None and coord:
                resolved = f"{coord.get('x')},{coord.get('y')}"
        elif value not in (None, "", []):
            resolved = str(value)

        if resolved is None:
            continue

        metadata_key = f"attr-{key}"
        metadata[metadata_key] = str(resolved)[:1024]

    return metadata


def fetch_job_record(
    sess: requests.Session,
    base_url: str,
    pat: str,
    job_name: str,
) -> Optional[Dict[str, Any]]:
    # Normalize the job name: if it looks like a path, take the last segment
    norm = job_name.strip()
    if "/" in norm:
        norm = norm.split("/")[-1].strip()
    norm = re.sub(r"\s+", " ", norm)
    url = urljoin(
        base_url + "/", f"api/v1/jobs/?name={quote(norm)}&page=1&page_size=25"
    )
    headers = {"Authorization": f"Bearer {pat}", "Content-Type": "application/json"}
    resp = sess.get(url, headers=headers, timeout=ENV_HTTP_TIMEOUT)
    if resp.status_code == 401:
        raise RuntimeError("Unauthorized fetching job list – PAT likely invalid")
    try:
        resp.raise_for_status()
    except Exception as exc:
        logger.warning("Failed to fetch job record", job=job_name, error=str(exc))
        return None
    data = resp.json()
    jobs = data.get("Result") or data
    if not isinstance(jobs, list):
        return None
    target_lower = norm.lower()
    # 1) Exact-name match that already includes a root folder
    for job in jobs:
        name = (job.get("Name") or job.get("JobName") or "").strip().lower()
        if name == target_lower and (
            job.get("RootFolderIDString")
            or job.get("RootFolderIdString")
            or (
                isinstance(job.get("RootFolder"), dict)
                and job["RootFolder"].get("IDString")
            )
        ):
            return job
    # 2) Any job with a root folder reference
    for job in jobs:
        if (
            job.get("RootFolderIDString")
            or job.get("RootFolderIdString")
            or (
                isinstance(job.get("RootFolder"), dict)
                and job["RootFolder"].get("IDString")
            )
        ):
            return job
    # 3) Exact-name match without root info
    for job in jobs:
        name = (job.get("Name") or job.get("JobName") or "").strip().lower()
        if name == target_lower:
            return job
    # 4) Fallback first item
    return jobs[0] if jobs else None


def job_root_folder_id(job: Dict[str, Any]) -> Optional[str]:
    root = job.get("RootFolderIDString") or job.get("RootFolderIdString")
    if root:
        return root
    root_obj = job.get("RootFolder")
    if isinstance(root_obj, dict):
        rid = root_obj.get("IDString")
        if rid:
            return rid
        if root_obj.get("_id") and root_obj.get("_server_id"):
            return f"{root_obj['_id']}_{root_obj['_server_id']}"
    # Do NOT fall back to job ID as a folder ID
    return None


def _job_idstring(job: Dict[str, Any]) -> Optional[str]:
    jid = job.get("IDString") or job.get("IdString") or job.get("Id")
    if isinstance(jid, str) and jid:
        return jid
    ident = job.get("ID") or job.get("Id")
    if isinstance(ident, dict):
        if ident.get("IDString"):
            return ident["IDString"]
        _id = ident.get("_id")
        _sid = ident.get("_server_id")
        if _id is not None and _sid is not None:
            return f"{_id}_{_sid}"
    return None


def _should_skip_job_name(name: str) -> bool:
    n = (name or "").strip()
    prefixes = (
        "Cuttriss/Job Templates",
        "Cuttriss/G - General",
        "Cuttriss/L - Library",
        "Cuttriss/M - Management",
        "Cuttriss/S - Support",
        "Cuttriss/File Templates",
    )
    return any(n.startswith(p) for p in prefixes)


def folder_exists(
    sess: requests.Session, base_url: str, pat: str, folder_id_str: str
) -> bool:
    try:
        url = urljoin(
            base_url + "/",
            f"api/v1/folders/{quote(folder_id_str, safe='')}/items?page=1&page_size=1",
        )
        resp = sess.get(
            url,
            headers={
                "Authorization": f"Bearer {pat}",
                "Content-Type": "application/json",
            },
            timeout=ENV_HTTP_TIMEOUT,
        )
    except requests.exceptions.RequestException:
        return False
    if resp.status_code == 401:
        return False
    if resp.status_code >= 500 or resp.status_code == 404:
        return False
    try:
        resp.raise_for_status()
        return True
    except Exception:
        return False


def read_job_names_from_csv_bytes(
    body: bytes, column: str, limit: Optional[int]
) -> List[str]:
    text = body.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    if column not in (reader.fieldnames or []):
        raise ValueError(
            f"Column {column!r} not present in CSV header {reader.fieldnames}"
        )
    names: List[str] = []
    for row in reader:
        value = (row.get(column) or "").strip()
        if value:
            names.append(value)
        if limit and len(names) >= limit:
            break
    return names


def resolve_job_roots(
    sess: requests.Session,
    base_url: str,
    pat: str,
    job_names: List[str],
) -> List[str]:
    roots: List[str] = []
    for name in job_names:
        if _should_skip_job_name(name):
            logger.info("Skipping non-job path", job=name)
            continue
        job = fetch_job_record(sess, base_url, pat, name)
        if not job:
            logger.warning("Job not found when resolving root", job=name)
            continue
        root = job_root_folder_id(job)
        if not root:
            # Guarded fallback: try job IDString only if it exists as a folder
            cand = _job_idstring(job)
            if cand and folder_exists(sess, base_url, pat, cand):
                root = cand
            else:
                logger.warning("Job missing RootFolder ID", job=name)
                continue
        if not folder_exists(sess, base_url, pat, root):
            logger.warning("Root folder invalid/unreachable", job=name, root=root)
            continue
        roots.append(root)
    return roots


def s3_exists(bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except botocore.exceptions.ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def list_folder_items(
    sess: requests.Session, base_url: str, pat: str, folder_id_str: str
) -> Dict[str, Any]:
    """
    GET /api/v1/folders/{id}/items
    Returns { "SubFolders": [...], "Files": { "Result":[...], "TotalCount":..., "Page":..., "PageSize":... } } (shape may vary)
    """
    url = urljoin(
        base_url + "/", f"api/v1/folders/{quote(folder_id_str, safe='')}/items"
    )
    headers = {"Authorization": f"Bearer {pat}", "Content-Type": "application/json"}
    resp = sess.get(url, headers=headers, timeout=ENV_HTTP_TIMEOUT)
    if resp.status_code == 401:
        raise RuntimeError("Unauthorized – PAT likely invalid or expired")
    if resp.status_code >= 500:
        logger.warning(
            "folders/{id}/items 5xx", folder=folder_id_str, status=resp.status_code
        )
        return {}
    try:
        resp.raise_for_status()
    except Exception as exc:
        logger.warning(
            "folders/{id}/items failed", folder=folder_id_str, error=str(exc)
        )
        return {}
    return resp.json()


def fetch_folder_files(
    sess: requests.Session,
    base_url: str,
    pat: str,
    folder_id_str: str,
    page_size: int = 100,
    include_deleted: bool = False,
) -> List[Dict[str, Any]]:
    """
    Prefer /folders/{id}/files but fall back to the items payload if the API 5xx-es
    or returns an empty body. This mirrors the improved CSV tool so Lambda runs are
    just as resilient.
    """
    files = _collect_files_via_files_endpoint(
        sess,
        base_url,
        pat,
        folder_id_str,
        page_size=page_size,
        include_deleted=include_deleted,
    )
    if files:
        return files
    fallback = _collect_files_via_items_endpoint(
        sess,
        base_url,
        pat,
        folder_id_str,
        page_size=page_size,
    )
    if fallback:
        logger.warning(
            "Using items fallback for folder",
            folder=folder_id_str,
            count=len(fallback),
        )
    return fallback


def _collect_files_via_files_endpoint(
    sess: requests.Session,
    base_url: str,
    pat: str,
    folder_id_str: str,
    page_size: int,
    include_deleted: bool,
) -> List[Dict[str, Any]]:
    headers = {"Authorization": f"Bearer {pat}", "Content-Type": "application/json"}
    page = 1
    collected: List[Dict[str, Any]] = []
    while True:
        qs = (
            f"?retrieve_attributes=false&page={page}&page_size={page_size}"
            f"&show_deleted_files={'true' if include_deleted else 'false'}"
        )
        url = urljoin(
            base_url + "/", f"api/v1/folders/{quote(folder_id_str, safe='')}/files{qs}"
        )
        try:
            resp = sess.get(url, headers=headers, timeout=ENV_HTTP_TIMEOUT)
        except requests.exceptions.RequestException as exc:
            logger.warning(
                "folders/{id}/files request error", folder=folder_id_str, error=str(exc)
            )
            return []
        if resp.status_code == 401:
            raise RuntimeError("Unauthorized – PAT likely invalid or expired")
        if resp.status_code >= 500:
            logger.warning(
                "folders/{id}/files 5xx", folder=folder_id_str, status=resp.status_code
            )
            return []
        try:
            resp.raise_for_status()
        except Exception as exc:
            logger.warning(
                "folders/{id}/files failed", folder=folder_id_str, error=str(exc)
            )
            return []
        data = resp.json()
        chunk = (
            data.get("Result")
            or data.get("Files", {}).get("Result")
            or data.get("Items")
            or []
        )
        if not isinstance(chunk, list) or not chunk:
            break
        collected.extend(chunk)
        if len(chunk) < page_size:
            break
        page += 1
    return collected


def _collect_files_via_items_endpoint(
    sess: requests.Session,
    base_url: str,
    pat: str,
    folder_id_str: str,
    page_size: int,
) -> List[Dict[str, Any]]:
    headers = {"Authorization": f"Bearer {pat}", "Content-Type": "application/json"}
    page = 1
    collected: List[Dict[str, Any]] = []
    while True:
        qs = f"?page={page}&page_size={page_size}"
        url = urljoin(
            base_url + "/", f"api/v1/folders/{quote(folder_id_str, safe='')}/items{qs}"
        )
        try:
            resp = sess.get(url, headers=headers, timeout=ENV_HTTP_TIMEOUT)
        except requests.exceptions.RequestException as exc:
            logger.warning(
                "items fallback request error", folder=folder_id_str, error=str(exc)
            )
            return collected
        if resp.status_code == 401:
            raise RuntimeError("Unauthorized – PAT likely invalid or expired")
        if resp.status_code >= 500:
            logger.warning(
                "items fallback 5xx", folder=folder_id_str, status=resp.status_code
            )
            return collected
        try:
            resp.raise_for_status()
        except Exception as exc:
            logger.warning(
                "items fallback failed", folder=folder_id_str, error=str(exc)
            )
            return collected
        data = resp.json()
        files_section = data.get("Files")
        if isinstance(files_section, dict):
            chunk = files_section.get("Result") or []
        else:
            chunk = data.get("Result") or data.get("Items") or []
        if not isinstance(chunk, list) or not chunk:
            break
        collected.extend(chunk)
        if len(chunk) < page_size:
            break
        page += 1
    return collected


def download_file_stream_to_s3(
    sess: requests.Session,
    base_url: str,
    pat: str,
    file_id_str: str,
    version: int,
    with_references: bool,
    s3_bucket: str,
    s3_key: str,
    content_type: Optional[str] = None,
    metadata: Optional[Dict[str, str]] = None,
):
    """
    POST /api/v1/files/{fileId}/download?version=X&with_references=false
    Stream bytes to S3 (avoids loading whole file into memory).
    """
    params = (
        f"?version={version}&with_references={'true' if with_references else 'false'}"
    )
    url = urljoin(
        base_url + "/", f"api/v1/files/{quote(file_id_str, safe='')}/download{params}"
    )
    headers = {
        "Authorization": f"Bearer {pat}",
        "Content-Type": "application/octet-stream",
    }

    with sess.post(
        url, headers=headers, data=b"", stream=True, timeout=ENV_HTTP_TIMEOUT
    ) as resp:
        if resp.status_code == 401:
            raise RuntimeError("Unauthorized – PAT likely invalid or expired")
        resp.raise_for_status()

        # Upload to S3 using streaming
        # Note: requests.Response.raw is a file-like object
        extra_args = {
            "ContentType": content_type or "application/octet-stream",
        }
        if metadata:
            extra_args["Metadata"] = metadata
        s3.upload_fileobj(resp.raw, s3_bucket, s3_key, ExtraArgs=extra_args)


def walk_and_collect_folders(sess, base_url, pat, start_folder_id: str) -> List[str]:
    """
    Recursively collect folder IDStrings starting from start_folder_id using /folders/{id}/items
    """
    stack = [start_folder_id]
    visited = set()
    collected = []

    while stack:
        fid = stack.pop()
        if fid in visited:
            continue
        visited.add(fid)
        collected.append(fid)
        try:
            items = list_folder_items(sess, base_url, pat, fid)
        except Exception as e:
            logger.warning("Failed to list folder items", folder=fid, error=str(e))
            continue

        subfolders = items.get("SubFolders") or []
        for sf in subfolders:
            sf_id = (
                sf.get("IDString") or f"{sf.get('_id','')}_{sf.get('_server_id','')}"
            )
            if sf_id:
                stack.append(sf_id)

    return collected


def delete_s3_object(bucket: str, key: str) -> None:
    try:
        s3.delete_object(Bucket=bucket, Key=key)
    except botocore.exceptions.ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in ("NoSuchKey", "NotFound"):
            return
        logger.warning("Failed to delete S3 object", key=key, error=str(exc))


def cleanup_orphans(
    bucket: str,
    previous_manifest: Dict[str, Any],
    current_manifest: Dict[str, Any],
) -> int:
    removed = 0
    prev_files = previous_manifest.get("files") or {}
    curr_files = current_manifest.get("files") or {}
    prev_ids = set(prev_files.keys())
    curr_ids = set(curr_files.keys())

    stale = prev_ids - curr_ids
    for file_id in stale:
        old = prev_files.get(file_id) or {}
        key = old.get("key")
        if key:
            delete_s3_object(bucket, key)
            removed += 1

    overlaps = prev_ids & curr_ids
    for file_id in overlaps:
        old_key = (prev_files.get(file_id) or {}).get("key")
        new_key = (curr_files.get(file_id) or {}).get("key")
        if old_key and new_key and old_key != new_key:
            delete_s3_object(bucket, old_key)
            removed += 1

    return removed


def sync_folder(
    sess: requests.Session,
    base_url: str,
    pat: str,
    folder_id_str: str,
    s3_bucket: str,
    s3_prefix: str,
    with_references: bool,
    force_overwrite: bool,
    manifest_store: Optional[ManifestStore] = None,
    cleanup_deleted: bool = False,
) -> Dict[str, Any]:
    """Sync one Synergy folder (and all files in it) to S3."""
    total = 0
    skipped = 0
    uploaded = 0
    errors = 0
    removed = 0

    previous_manifest: Dict[str, Any] = {}
    if manifest_store:
        previous_manifest = manifest_store.load(folder_id_str) or {}

    file_entries = fetch_folder_files(
        sess,
        base_url,
        pat,
        folder_id_str,
        page_size=ENV_PAGE_SIZE,
        include_deleted=False,
    )
    current_manifest_files: Dict[str, Dict[str, Any]] = {}

    for f in file_entries:
        file_id = f.get("IDString")
        if not file_id:
            logger.warning("File missing IDString, skipping", folder=folder_id_str)
            continue

        try:
            detailed = get_file_details(
                sess, base_url, pat, file_id, retrieve_attributes=True
            )
        except Exception as meta_err:
            logger.warning(
                "Failed to fetch file metadata", file=file_id, error=str(meta_err)
            )
            detailed = {}

        merged_file = {**f, **(detailed or {})}

        name = (
            merged_file.get("FileName")
            or merged_file.get("DisplayName")
            or merged_file.get("Name")
            or merged_file.get("Path")
            or merged_file.get("IDString", "unknown")
        )

        if should_skip(name):
            logger.info("Skipping by filter", file=name, folder=folder_id_str)
            continue

        state = (f.get("State") or "").lower()
        if state == "deleted":
            continue

        latest_ver = f.get("LatestVersion") or f.get("Version") or 1

        key = s3_key_for_file(merged_file, latest_ver, s3_prefix)
        total += 1

        current_manifest_files[file_id] = {
            "key": key,
            "version": int(latest_ver),
        }

        if not force_overwrite and s3_exists(s3_bucket, key):
            skipped += 1
            logger.info("Already present, skipping", key=key)
            continue

        content_type = guess_content_type(name, merged_file.get("FileType"))
        metadata = extract_attribute_metadata(merged_file)

        try:
            download_file_stream_to_s3(
                sess,
                base_url,
                pat,
                file_id,
                int(latest_ver),
                with_references,
                s3_bucket,
                key,
                content_type=content_type,
                metadata=metadata or None,
            )
            uploaded += 1
            logger.info("Uploaded", key=key, version=int(latest_ver))
        except Exception as e:
            errors += 1
            logger.exception("Failed to download/upload file", file=name, key=key)

    manifest_payload = {
        "folderId": folder_id_str,
        "files": current_manifest_files,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }

    if manifest_store:
        try:
            manifest_store.save(folder_id_str, manifest_payload)
        except Exception as exc:
            logger.warning(
                "Failed to save manifest", folder=folder_id_str, error=str(exc)
            )

    if cleanup_deleted and manifest_store and previous_manifest:
        removed = cleanup_orphans(s3_bucket, previous_manifest, manifest_payload)

    return {
        "folder": folder_id_str,
        "total_seen": total,
        "uploaded": uploaded,
        "skipped": skipped,
        "errors": errors,
        "deleted": removed,
    }


def _run_probe_sync(
    event: Dict[str, Any],
    base_url: str,
    s3_bucket: str,
    s3_prefix: str,
    sess: requests.Session,
    pat: str,
    manifest_store: Optional[ManifestStore],
) -> Dict[str, Any]:
    server_id = (
        _event_int(event, "serverId", ENV_SYNERGY_SERVER_ID) or ENV_SYNERGY_SERVER_ID
    )
    range_start = (
        _event_int(event, "rangeStart", ENV_PROBE_RANGE_START) or ENV_PROBE_RANGE_START
    )
    range_end = (
        _event_int(event, "rangeEnd", ENV_PROBE_RANGE_END) or ENV_PROBE_RANGE_END
    )
    chunk_size = (
        _event_int(event, "chunkSize", ENV_PROBE_CHUNK_SIZE) or ENV_PROBE_CHUNK_SIZE
    )

    if range_end < range_start:
        raise RuntimeError("rangeEnd must be greater than or equal to rangeStart")

    total_slots = range_end - range_start + 1
    if chunk_size <= 0:
        chunk_size = ENV_PROBE_CHUNK_SIZE
    chunk_size = max(1, min(chunk_size, total_slots))

    cursor_override = _event_int(event, "startId", None)
    state_table = event.get("stateTable") or ENV_PROBE_STATE_TABLE
    state_key = event.get("stateKey") or ENV_PROBE_STATE_KEY
    state_pk_attr = event.get("statePkAttr") or ENV_PROBE_STATE_PK_ATTR

    cursor = ProbeStateManager(state_table, state_key, state_pk_attr)
    start_id = (
        cursor_override
        if cursor_override is not None
        else cursor.load_next_start(range_start)
    )
    if start_id < range_start or start_id > range_end:
        start_id = range_start
    end_id = min(range_end, start_id + chunk_size - 1)

    folder_numbers = list(range(start_id, end_id + 1))

    logger.info(
        "Starting Synergy probe chunk",
        start_id=start_id,
        end_id=end_id,
        chunk_size=chunk_size,
        server_id=server_id,
        bucket=s3_bucket,
        prefix=s3_prefix,
    )

    summaries: List[Dict[str, Any]] = []
    cleanup_deleted = ENV_ENABLE_DELETION or bool(event.get("cleanupDeleted"))
    for folder_num in folder_numbers:
        folder_id_str = f"{folder_num}_{server_id}"
        try:
            summary = sync_folder(
                sess,
                base_url,
                pat,
                folder_id_str,
                s3_bucket,
                s3_prefix,
                with_references=ENV_WITH_REFERENCES,
                force_overwrite=ENV_FORCE_OVERWRITE,
                manifest_store=manifest_store,
                cleanup_deleted=cleanup_deleted,
            )
            summaries.append(summary)
        except Exception:
            logger.exception("Folder sync failed", folder=folder_id_str)

    totals = _build_totals(len(folder_numbers), summaries)

    next_start = end_id + 1
    if next_start > range_end:
        next_start = range_start

    cursor.save_next_start(
        next_start,
        {
            "lastRangeStart": start_id,
            "lastRangeEnd": end_id,
            "rangeStart": range_start,
            "rangeEnd": range_end,
            "chunkSize": chunk_size,
        },
    )

    logger.info(
        "Synergy probe chunk complete",
        probe_start=start_id,
        probe_end=end_id,
        next_start=next_start,
        **totals,
    )

    return {
        "statusCode": 200,
        "body": {
            "totals": totals,
            "folders": summaries,
            "probe": {
                "startId": start_id,
                "endId": end_id,
                "nextStartId": next_start,
                "rangeStart": range_start,
                "rangeEnd": range_end,
                "chunkSize": chunk_size,
                "serverId": server_id,
                "stateTable": state_table,
                "stateKey": state_key,
            },
        },
    }


def _run_legacy_sync(
    event: Dict[str, Any],
    base_url: str,
    s3_bucket: str,
    s3_prefix: str,
    sess: requests.Session,
    pat: str,
    manifest_store: Optional[ManifestStore],
) -> Dict[str, Any]:
    csv_bucket = event.get("jobCsvBucket")
    csv_key = event.get("jobCsvKey")
    csv_column = event.get("jobCsvColumn", "Job Path")
    csv_limit = event.get("jobCsvLimit")
    job_names_event = event.get("jobNames")
    explicit_roots = event.get("rootFolderIdStrings")
    start_folder = event.get("startFolderIdString")

    logger.info(
        "Starting 12d Synergy sync",
        base_url=base_url,
        bucket=s3_bucket,
        prefix=s3_prefix,
        with_references=ENV_WITH_REFERENCES,
        force_overwrite=ENV_FORCE_OVERWRITE,
        use_synergy_paths=ENV_USE_SYNERGY_PATHS,
        page_size=ENV_PAGE_SIZE,
    )

    seed_roots: List[str] = []

    if csv_bucket and csv_key:
        obj = s3.get_object(Bucket=csv_bucket, Key=csv_key)
        raw = obj["Body"].read()
        limit = int(csv_limit) if csv_limit is not None else None
        job_names = read_job_names_from_csv_bytes(raw, csv_column, limit)
        if not job_names:
            raise RuntimeError("No job names parsed from CSV")
        seed_roots = resolve_job_roots(sess, base_url, pat, job_names)
        logger.info(
            "Resolved job roots from CSV",
            csv_bucket=csv_bucket,
            csv_key=csv_key,
            count=len(seed_roots),
        )
    elif job_names_event:
        job_names = [str(name) for name in job_names_event if str(name).strip()]
        seed_roots = resolve_job_roots(sess, base_url, pat, job_names)
        logger.info("Resolved job roots from event jobNames", count=len(seed_roots))
    elif explicit_roots:
        seed_roots = [str(r) for r in explicit_roots if str(r).strip()]
        logger.info("Using provided rootFolderIdStrings", count=len(seed_roots))
    elif start_folder:
        seed_roots = [start_folder]
        logger.info("Using single start folder", folder=start_folder)
    else:
        raise RuntimeError(
            "Provide one of jobCsvBucket/jobCsvKey, jobNames, rootFolderIdStrings, or startFolderIdString"
        )

    if not seed_roots:
        raise RuntimeError("No valid root folders resolved")

    all_folders: List[str] = []
    for root in seed_roots:
        try:
            folders = walk_and_collect_folders(sess, base_url, pat, root)
            all_folders.extend(folders)
        except Exception:
            logger.exception("Failed to walk root folder", root=root)
    deduped: List[str] = []
    seen_folders: set[str] = set()
    for folder in all_folders:
        if folder in seen_folders:
            continue
        seen_folders.add(folder)
        deduped.append(folder)
    all_folders = deduped
    logger.info("Discovered folders", count=len(all_folders))

    summaries = []
    cleanup_deleted = ENV_ENABLE_DELETION or bool(event.get("cleanupDeleted"))
    for fid in all_folders:
        try:
            summary = sync_folder(
                sess,
                base_url,
                pat,
                fid,
                s3_bucket,
                s3_prefix,
                with_references=ENV_WITH_REFERENCES,
                force_overwrite=ENV_FORCE_OVERWRITE,
                manifest_store=manifest_store,
                cleanup_deleted=cleanup_deleted,
            )
            summaries.append(summary)
        except Exception:
            logger.exception("Folder sync failed", folder=fid)

    totals = _build_totals(len(all_folders), summaries)

    logger.info("12d Synergy sync complete", **totals)

    return {
        "statusCode": 200,
        "body": {
            "totals": totals,
            "folders": summaries,
        },
    }


def handler(event: Optional[Dict[str, Any]], _ctx) -> Dict[str, Any]:
    """
    Event schema (summary):
    - Probe mode (default / recommended for Cuttriss):
        {
          "mode": "probe",
          "rangeStart": 1,
          "rangeEnd": 60000,
          "chunkSize": 250,
          "serverId": 1,
          "startId": 1500,           # optional override to resume at a specific ID
          "stateTable": "cursorTable",  # optional DynamoDB table for persistence
          "stateKey": "cuttriss"        # optional row key within the state table
        }
    - Legacy (job list) mode is still available via `"mode": "legacy"` plus the legacy
      CSV/jobName fields documented previously.
    """
    event = event or {}
    base_url, s3_bucket, s3_prefix = _resolve_storage_config(event)
    _apply_behavior_overrides(event)

    mode = str(event.get("mode") or ENV_DEFAULT_SYNC_MODE or "probe").strip().lower()

    pat = get_secret_pat(ENV_SYNERGY_PAT_SECRET_NAME)
    sess = make_session()
    manifest_store = ManifestStore(s3_bucket, s3_prefix, s3_client=s3)

    if mode == "legacy":
        return _run_legacy_sync(
            event, base_url, s3_bucket, s3_prefix, sess, pat, manifest_store
        )
    if mode not in ("probe", "auto", "autoprobe"):
        raise RuntimeError(f"Unsupported mode {mode!r}")
    return _run_probe_sync(
        event, base_url, s3_bucket, s3_prefix, sess, pat, manifest_store
    )

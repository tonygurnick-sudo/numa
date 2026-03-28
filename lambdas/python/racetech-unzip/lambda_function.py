"""Auto-extract .zip uploads in the racetech-data S3 prefix.

Triggered by S3 ObjectCreated events on .zip files. Extracts all files from
the zip, uploads them to the same S3 prefix, then deletes the original .zip.

This ensures the workspace agent always sees raw .sqlite files without needing
to unzip at query time.
"""

from __future__ import annotations

import os
import zipfile
from pathlib import Path

import boto3
import structlog

logger = structlog.get_logger()

DATA_BUCKET_NAME: str = os.environ["DATA_BUCKET_NAME"]
TMP_DIR = Path("/tmp")

s3 = boto3.client("s3")


def handler(event: dict, _ctx: object) -> None:
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]

        if not key.endswith(".zip"):
            logger.info("Skipping non-zip file", key=key)
            continue

        logger.info("Processing zip upload", bucket=bucket, key=key)

        # Derive the S3 prefix (directory) from the key
        prefix = key.rsplit("/", 1)[0] + "/" if "/" in key else ""
        zip_filename = key.rsplit("/", 1)[-1]
        local_zip = TMP_DIR / zip_filename

        try:
            # Download
            s3.download_file(bucket, key, str(local_zip))
            logger.info("Downloaded zip", size_bytes=local_zip.stat().st_size)

            # Extract and upload each file
            with zipfile.ZipFile(local_zip, "r") as zf:
                for member in zf.namelist():
                    # Skip directories and hidden files
                    if member.endswith("/") or member.startswith("__MACOSX"):
                        continue

                    # Use only the filename (ignore any directory structure in the zip)
                    filename = Path(member).name
                    local_path = TMP_DIR / filename

                    with zf.open(member) as src, open(local_path, "wb") as dst:
                        dst.write(src.read())

                    upload_key = f"{prefix}{filename}"
                    s3.upload_file(str(local_path), bucket, upload_key)
                    logger.info(
                        "Uploaded extracted file",
                        key=upload_key,
                        size_bytes=local_path.stat().st_size,
                    )

                    local_path.unlink()

            # Delete the original .zip from S3
            s3.delete_object(Bucket=bucket, Key=key)
            logger.info("Deleted original zip", key=key)

        except Exception:
            logger.exception("Failed to process zip", key=key)
            raise
        finally:
            if local_zip.exists():
                local_zip.unlink()

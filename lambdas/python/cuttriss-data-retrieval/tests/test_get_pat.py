#!/usr/bin/env python3
import json
import os
import sys

import boto3
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    EndpointConnectionError,
    NoCredentialsError,
)

# like this : AWS_PROFILE=q-demo AWS_REGION=us-east-1 SECRET_NAME=Greg_Synergy12D_PAT \
#  poetry run python -u tests/test_get_pat.py


def main():
    # Resolve region & secret name (envs override defaults)
    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-1"
    secret_name = os.getenv("SECRET_NAME") or "synergy/pat"

    print(f"[INFO] Using profile: {os.getenv('AWS_PROFILE', '(default)')}")
    print(f"[INFO] Region       : {region}")
    print(f"[INFO] Secret name  : {secret_name}")
    sys.stdout.flush()

    # Show who we are (helps catch wrong account)
    try:
        sts = boto3.client("sts", region_name=region)
        ident = sts.get_caller_identity()
        print(f"[INFO] Caller ARN   : {ident['Arn']}")
        print(f"[INFO] Account ID   : {ident['Account']}")
    except Exception as e:
        print(f"[WARN] Could not get caller identity: {e}")
    sys.stdout.flush()

    # Read secret
    try:
        sm = boto3.client("secretsmanager", region_name=region)
        print("[INFO] Calling Secrets Manager get_secret_value...")
        resp = sm.get_secret_value(SecretId=secret_name)
        print("[INFO] Secrets Manager responded.")
    except NoCredentialsError:
        print(
            "[ERR] No AWS credentials found. Try `aws sts get-caller-identity` or set AWS_PROFILE.",
            file=sys.stderr,
        )
        sys.exit(2)
    except EndpointConnectionError as e:
        print(
            f"[ERR] Could not reach Secrets Manager endpoint in region {region}: {e}",
            file=sys.stderr,
        )
        sys.exit(3)
    except ClientError as e:
        print(f"[ERR] ClientError from Secrets Manager: {e}", file=sys.stderr)
        sys.exit(4)
    except BotoCoreError as e:
        print(f"[ERR] BotoCoreError: {e}", file=sys.stderr)
        sys.exit(5)
    except Exception as e:
        print(f"[ERR] Unexpected error: {e}", file=sys.stderr)
        sys.exit(6)

    val = resp.get("SecretString") or ""
    if not val:
        print("[ERR] SecretString was empty.", file=sys.stderr)
        sys.exit(7)

    # Accept raw string or {"token": "..."}
    try:
        parsed = json.loads(val)
        token = parsed.get("token") or parsed.get("PAT") or parsed.get("pat") or val
    except Exception:
        token = val

    print("[OK] Secret retrieved.")
    print(f"Name      : {secret_name}")
    print(f"Region    : {region}")
    print(f"Length    : {len(token)}")
    print(f"Preview   : {token[:6]}...{token[-6:]}")
    print('Tip: store as JSON {"token":"<PAT>"} for clarity.')
    sys.stdout.flush()


if __name__ == "__main__":
    main()

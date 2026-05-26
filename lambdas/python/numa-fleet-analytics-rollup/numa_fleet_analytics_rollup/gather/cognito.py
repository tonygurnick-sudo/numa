"""Cognito user-pool gather. Provisioned count + sub -> email map."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any


def gather_cognito(session, client_name: str, region: str) -> dict[str, Any]:
    idp = session.client("cognito-idp", region_name=region)
    try:
        pools = idp.list_user_pools(MaxResults=60).get("UserPools", [])
        candidates = [p for p in pools if client_name in (p.get("Name") or "")]
        if not candidates:
            return {
                "warning": "no matching user pool",
                "all_pool_names": [p["Name"] for p in pools],
                "sub_to_email": {},
            }
        pool = candidates[0]
        user_count = 0
        active_in_30d = 0
        sub_to_email: dict[str, str] = {}
        pagination = None
        last_activity_threshold = datetime.now(timezone.utc) - timedelta(days=30)
        while True:
            kw: dict[str, Any] = {"UserPoolId": pool["Id"], "Limit": 60}
            if pagination:
                kw["PaginationToken"] = pagination
            resp = idp.list_users(**kw)
            for u in resp.get("Users", []):
                user_count += 1
                last = u.get("UserLastModifiedDate")
                if last and last >= last_activity_threshold:
                    active_in_30d += 1
                attrs = {a["Name"]: a["Value"] for a in u.get("Attributes", [])}
                sub = attrs.get("sub")
                email = attrs.get("email")
                if sub and email:
                    sub_to_email[sub] = email
            pagination = resp.get("PaginationToken")
            if not pagination:
                break
        return {
            "user_pool_id": pool["Id"],
            "user_pool_name": pool["Name"],
            "provisioned_users": user_count,
            "modified_in_last_30d": active_in_30d,
            "sub_to_email": sub_to_email,
        }
    except Exception as e:
        return {"error": repr(e), "sub_to_email": {}}

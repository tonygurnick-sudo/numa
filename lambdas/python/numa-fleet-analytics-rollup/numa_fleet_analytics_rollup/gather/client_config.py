"""Client config attached to the snapshot.

Already extracted by persist.list_client_names; this thin wrapper renames
the fields to match what the frontend expects.
"""

from __future__ import annotations


def attach_dashboard_config(summary: dict) -> dict:
    """Re-shape the persist-layer summary into the snapshot's client_config slot.

    The shape is identical to what the prototype gather script produced so the
    React components don't need a translation step.
    """
    return {
        "client_name": summary.get("clientName"),
        "client_account_id": summary.get("client_account_id"),
        "region": summary.get("region"),
        "dev_instance": bool(summary.get("dev_instance") or False),
        "bedrock_account": summary.get("bedrock_account"),
        "allow_bedrock_quota_sharing": bool(
            summary.get("allow_bedrock_quota_sharing") or False
        ),
        "preferred_kb": summary.get("preferred_kb"),
        # 'nextgen' | 'arcanum' | 'standalone' | None — comes from
        # numa-client-metadata. Drives the frontend's Numa-attributable cost
        # filter: standalone accounts get an allowlist applied so customer's
        # own AWS workloads (RDS, OpenSearch, QuickSight, ...) don't pollute
        # the cost composition donut.
        "account_org": summary.get("account_org"),
    }

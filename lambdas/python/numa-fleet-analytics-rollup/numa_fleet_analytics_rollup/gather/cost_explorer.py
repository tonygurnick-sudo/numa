"""Cost Explorer gather. Daily SERVICE + Bedrock USAGE_TYPE drilldown."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any


def gather_cost_explorer(session, days: int) -> dict[str, Any]:
    # Cost Explorer is a global service with a single us-east-1 endpoint —
    # do NOT swap this for the client's region.
    ce = session.client("ce", region_name="us-east-1")
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)
    out: dict[str, Any] = {
        "window": {"start": start.isoformat(), "end": end.isoformat(), "days": days},
        "by_service_daily": {},
        "totals_by_service": {},
        "totals_by_day": {},
        "grand_total": 0.0,
        "bedrock_usage_type_totals": {},
    }
    try:
        resp = ce.get_cost_and_usage(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="DAILY",
            Metrics=["UnblendedCost"],
            GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
        )
        for period in resp.get("ResultsByTime", []):
            day = period["TimePeriod"]["Start"]
            for grp in period.get("Groups", []):
                svc = grp["Keys"][0]
                amt = float(grp["Metrics"]["UnblendedCost"]["Amount"])
                out["by_service_daily"].setdefault(svc, {})[day] = amt
                out["totals_by_service"][svc] = (
                    out["totals_by_service"].get(svc, 0) + amt
                )
                out["totals_by_day"][day] = out["totals_by_day"].get(day, 0) + amt
                out["grand_total"] += amt

        # USAGE_TYPE drilldown for the Amazon Bedrock umbrella line
        try:
            usage_resp = ce.get_cost_and_usage(
                TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
                Granularity="DAILY",
                Metrics=["UnblendedCost"],
                Filter={"Dimensions": {"Key": "SERVICE", "Values": ["Amazon Bedrock"]}},
                GroupBy=[{"Type": "DIMENSION", "Key": "USAGE_TYPE"}],
            )
            ut_totals: dict[str, float] = {}
            for period in usage_resp.get("ResultsByTime", []):
                for grp in period.get("Groups", []):
                    ut = grp["Keys"][0]
                    ut_totals[ut] = ut_totals.get(ut, 0) + float(
                        grp["Metrics"]["UnblendedCost"]["Amount"]
                    )
            out["bedrock_usage_type_totals"] = ut_totals
        except Exception as e:
            out["bedrock_usage_type_totals_error"] = str(e)
    except Exception as e:
        out["error"] = repr(e)
    return out

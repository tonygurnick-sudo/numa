#!/usr/bin/env python3
"""Live integration + unit harness for the Numa Credit System (SPK-015).

Exercises the DEPLOYED `credit-debit` and `admin-credits-*` Lambdas and the live credit-ledger
table on a dev stack (default arcanum-demo-tony), plus the pure pricing lib locally. Read-mostly:
the only writes use throwaway synthetic conversation IDs (cleaned up) and a BALANCE top-up that is
snapshotted and restored in a finally block. Safe to re-run.

    AWS_PROFILE=q-demo python3 tools/credits-system-test.py [--client arcanum-demo-tony]

Exit code is non-zero if any assertion FAILs. FINDINGs are design/calibration notes, not failures.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from decimal import Decimal
from typing import Any, Optional

import boto3

# ── pure lib (no boto3/structlog at import; safe to load locally) ──────────────────────────────
sys.path.insert(
    0, os.path.join(os.path.dirname(__file__), "..", "lib", "credit-pricing")
)
from credit_pricing.credits import (  # noqa: E402
    CREDIT_USD,
    MARGIN_TARGET,
    floor_credits,
    margin_actual,
)
from credit_pricing.pricing import (  # noqa: E402
    ANTHROPIC_MODEL_PRICING,
    recalculate_anthropic_cost,
)
from credit_pricing.processing import TurnCost, build_conversation_rows  # noqa: E402
from credit_pricing.tiers import (  # noqa: E402
    VALUE_TIER_CREDITS,
    _parse_classification,
    tier_to_credits,
)

# ── results ────────────────────────────────────────────────────────────────────────────────────
PASS, FAIL, FINDING, SKIP = [], [], [], []


def ok(name: str, detail: str = "") -> None:
    PASS.append(name)
    print(f"  \033[32mPASS\033[0m {name}" + (f"  — {detail}" if detail else ""))


def bad(name: str, detail: str = "") -> None:
    FAIL.append(name)
    print(f"  \033[31mFAIL\033[0m {name}" + (f"  — {detail}" if detail else ""))


def check(cond: bool, name: str, detail: str = "") -> bool:
    (ok if cond else bad)(name, detail)
    return cond


def finding(name: str, detail: str) -> None:
    FINDING.append((name, detail))
    print(f"  \033[33mNOTE\033[0m {name} — {detail}")


def skip(name: str, detail: str) -> None:
    SKIP.append(name)
    print(f"  \033[90mSKIP\033[0m {name} — {detail}")


def section(t: str) -> None:
    print(f"\n\033[1m=== {t} ===\033[0m")


# ── live clients / config ────────────────────────────────────────────────────────────────────
ap = argparse.ArgumentParser()
ap.add_argument("--client", default="arcanum-demo-tony")
ap.add_argument("--region", default="us-east-1")
ARGS = ap.parse_args()
CLIENT, REGION = ARGS.client, ARGS.region
TABLE = f"numa-{CLIENT}-credit-ledger"
FN_DEBIT = f"{CLIENT}_credit-debit"
FN_BAL = f"{CLIENT}_admin-credits-balance"
FN_LED = f"{CLIENT}_admin-credits-ledger"
FN_TOP = f"{CLIENT}_admin-credits-topup"

lam = boto3.client("lambda", region_name=REGION)
ddb = boto3.resource("dynamodb", region_name=REGION)
tbl = ddb.Table(TABLE)


def invoke(fn: str, payload: dict) -> Any:
    r = lam.invoke(
        FunctionName=fn,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode(),
    )
    body = r["Payload"].read().decode()
    if r.get("FunctionError"):
        return {"_error": r["FunctionError"], "_body": body}
    return json.loads(body) if body else None


def api(
    fn: str,
    method: str,
    path: str,
    *,
    query: Optional[dict] = None,
    body: Optional[dict] = None,
    admin: bool = False,
) -> tuple[int, Any]:
    """Invoke an admin-credits function with a synthetic API-GW-v2 event; return (status, parsed)."""
    ev: dict[str, Any] = {"requestContext": {"http": {"method": method, "path": path}}}
    if query:
        ev["queryStringParameters"] = query
    if body is not None:
        ev["body"] = json.dumps(body)
    if admin:
        claims = base64.b64encode(
            json.dumps({"cognito:groups": ["admin"]}).encode()
        ).decode()
        ev["headers"] = {"authorization": f"eyJhbGciOiJub25lIn0.{claims}.sig"}
    res = invoke(fn, ev)
    if isinstance(res, dict) and res.get("_error"):
        return -1, res
    return int(res["statusCode"]), json.loads(res.get("body") or "null")


def num(x: Any) -> float:
    return float(x) if x is not None else 0.0


KNOWN_USER = "b4b874b8-1011-70b8-8b4c-a22a769025d1"
KNOWN_CONV = f"{KNOWN_USER}_1780289182702"  # today's "Rain Haiku Chain Reaction" (has a real trace)

# Fields that must NEVER appear in an admin-facing ledger response (cost/token/internal telemetry).
FORBIDDEN_ADMIN = {
    "tokenCostUsd",
    "consumptionCostUsd",
    "agentCoreCostUsd",
    "tokenCostNzd",
    "consumptionCostNzd",
    "creditsFloor",
    "creditsValue",
    "marginVsConsumption",
    "fxRate",
    "costIncomplete",
    "bedrockRegion",
    "tiers",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheCreationTokens",
}


# ════════════════════════════════════════════════════════════════════════════════════════════
def test_pure_math() -> None:
    section("A. Pure pricing math (local lib)")
    # floor: tenth-credit ceil of cost*margin/credit (defaults margin=2.0, credit=$0.30).
    # cost 0.10 -> ceil10(0.10*2/0.30)=ceil10(0.667)=0.7
    check(floor_credits(0.0) == 0, "floor(0)==0")
    check(floor_credits(0.10) == 0.7, "floor($0.10)==0.7", f"got {floor_credits(0.10)}")
    check(
        floor_credits(0.075) == 0.5,
        "floor($0.075)==0.5 (boundary: 0.075*2/0.30=0.5)",
        f"got {floor_credits(0.075)}",
    )
    check(
        floor_credits(0.16) == 1.1,
        "floor($0.16)==1.1 (rounds up to next tenth-credit)",
        f"got {floor_credits(0.16)}",
    )
    check(floor_credits(5.0) == 33.4, "floor($5.00)==33.4", f"got {floor_credits(5.0)}")
    # monotonic
    check(
        all(floor_credits(c) <= floor_credits(c + 0.5) for c in [0.1, 1, 5, 20]),
        "floor is monotonic",
    )

    # tier→credit map
    check(tier_to_credits("high", "chat") == 5, "chat/high==5")
    check(tier_to_credits("very_high", "chat") == 8, "chat/very_high==8")
    check(tier_to_credits("low", "agent") == 0.5, "agent/low==0.5")
    check(tier_to_credits("bogus", "chat") == 2, "unknown tier -> medium(2)")
    check(tier_to_credits("high", "bogus_ctx") == 5, "unknown context -> chat table")

    # charge = max(value, floor) via build_conversation_rows
    def turns(n: int, usd_each: float) -> list[TurnCost]:
        return [
            TurnCost(
                i, f"m{i}", "global.anthropic.claude-sonnet-4-6", 10, 10, 0, 0, usd_each
            )
            for i in range(n)
        ]

    meta, msgs = build_conversation_rows(
        conversation_id="t",
        user_sub="u",
        month="2026-06",
        last_ts="2026-06-01T00:00:00",
        turns=turns(3, 0.01),
        title="x",
        margin=2.0,
        credit_usd=0.5,
        value_tier="high",
        context="chat",
    )
    check(meta["creditsValue"] == 5, "value high -> 5")
    check(
        meta["creditsCharged"] == max(meta["creditsValue"], meta["creditsFloor"]),
        "charge == max(value, floor)",
        f"v={meta['creditsValue']} f={meta['creditsFloor']} c={meta['creditsCharged']}",
    )
    check(len(msgs) == 3 and meta["msgCount"] == 3, "msg rows + count")

    # floor-dominant case: many cheap turns, low value -> floor wins
    meta2, _ = build_conversation_rows(
        conversation_id="t2",
        user_sub="u",
        month="2026-06",
        last_ts="2026-06-01T00:00:00",
        turns=turns(20, 0.05),
        title="x",
        margin=2.0,
        credit_usd=0.5,
        value_tier="low",
        context="chat",
    )
    check(
        meta2["creditsCharged"] == meta2["creditsFloor"] > meta2["creditsValue"],
        "floor dominates long cheap low-value conv",
        f"floor={meta2['creditsFloor']} value={meta2['creditsValue']}",
    )

    # margin guarantee: charged*credit_usd / cost >= MARGIN_TARGET
    m = margin_actual(meta["creditsCharged"], meta["consumptionCostUsd"])
    check(
        m is not None and m >= MARGIN_TARGET,
        "synthetic row honors margin>=2",
        f"margin={m}",
    )

    # FINDING: per-message ceil inflates the conversation floor vs a single ceil on the total
    cons_total = sum(0.01 for _ in range(3))
    floor_total_single = floor_credits(cons_total)
    floor_summed = meta["creditsFloor"]
    if floor_summed > floor_total_single:
        finding(
            "per-message floor inflation",
            f"3×$0.01 conv: per-msg-summed floor={floor_summed} vs single ceil on total={floor_total_single}. "
            "Each cheap turn rounds up to >=1 credit, so long/cheap conversations are floor-dominated "
            "at >=1 credit/message regardless of true cost. Calibration call for Asa.",
        )

    # recompute: unknown model -> None; known model -> positive; cache_read cheaper than input
    def cost(
        model: str, i: int = 0, o: int = 0, cr: int = 0, cw: int = 0, ttl: str = "1h"
    ) -> Optional[float]:
        return recalculate_anthropic_cost(
            model,
            input_tokens=i,
            output_tokens=o,
            cache_read_tokens=cr,
            cache_creation_tokens=cw,
            cache_ttl=ttl,
        )

    check(
        cost("totally-unknown-model", i=1000, o=1000) is None,
        "recompute(unknown model) is None",
    )
    known = next(iter(ANTHROPIC_MODEL_PRICING))
    c_in = cost(known, i=1_000_000)
    c_cache = cost(known, cr=1_000_000)
    check(c_in and c_in > 0, f"recompute({known}) positive", f"${c_in}")
    check(
        c_cache is not None and c_cache < c_in,
        "cache-read cheaper than fresh input",
        f"cache=${c_cache} in=${c_in}",
    )
    c_1h = cost(known, cw=1_000_000, ttl="1h")
    c_5m = cost(known, cw=1_000_000, ttl="5m")
    check(
        c_1h is not None and c_5m is not None and c_1h > c_5m,
        "1h cache-write > 5m cache-write",
        f"1h=${c_1h} 5m=${c_5m}",
    )

    # classifier parser robustness (no network)
    check(
        _parse_classification('{"tier":"high","category":"analysis"}')["tier"]
        == "high",
        "parse clean json",
    )
    check(
        _parse_classification(
            'blah {"tier":"very_high","category":"code_build"} trailing'
        )["tier"]
        == "very_high",
        "parse json embedded in prose",
    )
    check(
        _parse_classification("garbage")["tier"] == "medium",
        "parse garbage -> medium default",
    )
    check(
        _parse_classification('{"tier":"INVALID","category":"x"}')["tier"] == "medium",
        "invalid tier -> medium",
    )


# ════════════════════════════════════════════════════════════════════════════════════════════
def test_debit_lambda() -> None:
    section("B. credit-debit Lambda (deployed)")

    # valid known conversation + idempotency
    r1 = invoke(FN_DEBIT, {"conversation_id": KNOWN_CONV, "user_sub": KNOWN_USER})
    check(
        isinstance(r1, dict) and r1.get("status") == "ok", "valid conv -> ok", str(r1)
    )
    r2 = invoke(FN_DEBIT, {"conversation_id": KNOWN_CONV, "user_sub": KNOWN_USER})
    check(r1 == r2, "idempotent: identical result on re-run", f"{r1} vs {r2}")
    q = tbl.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("PK").eq(
            f"CONV#{KNOWN_CONV}"
        )
    )
    metas = [i for i in q["Items"] if i["SK"] == "META"]
    msgs = [i for i in q["Items"] if str(i["SK"]).startswith("MSG#")]
    check(len(metas) == 1, "exactly one META row (no dupes)", f"{len(metas)}")
    check(
        len(msgs) == int(metas[0]["msgCount"]),
        "MSG row count == msgCount",
        f"{len(msgs)} vs {metas[0]['msgCount']}",
    )

    # missing trace -> skipped, no row written
    synth = f"qa-missing-trace-{int(time.time())}"
    r = invoke(FN_DEBIT, {"conversation_id": synth, "user_sub": "qa-user"})
    check(
        isinstance(r, dict) and r.get("status") == "skipped",
        "missing trace -> skipped",
        str(r),
    )
    got = tbl.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("PK").eq(f"CONV#{synth}")
    )
    check(
        got["Count"] == 0, "missing trace -> no ledger row written", f"{got['Count']}"
    )

    # missing ids -> skipped (guard clause)
    r = invoke(FN_DEBIT, {"conversation_id": "", "user_sub": ""})
    check(
        isinstance(r, dict) and r.get("status") == "skipped",
        "empty ids -> skipped",
        str(r),
    )
    r = invoke(FN_DEBIT, {})
    check(
        isinstance(r, dict) and r.get("status") == "skipped",
        "empty event -> skipped",
        str(r),
    )

    # scheduled conversation: source must be 'scheduled' (agent context) if a trace exists
    sched = None
    sc = tbl.scan(
        FilterExpression=boto3.dynamodb.conditions.Attr("SK").eq("META")
        & boto3.dynamodb.conditions.Attr("source").eq("scheduled"),
        Limit=200,
    )
    for it in sc.get("Items", []):
        if str(it["PK"]).startswith("CONV#schedule-"):
            sched = it
            break
    if sched:
        conv = str(sched["PK"]).replace("CONV#", "")
        r = invoke(
            FN_DEBIT,
            {"conversation_id": conv, "user_sub": str(sched.get("userSub", ""))},
        )
        if isinstance(r, dict) and r.get("status") == "ok":
            row = tbl.get_item(Key={"PK": sched["PK"], "SK": "META"})["Item"]
            check(
                row.get("source") == "scheduled",
                "scheduled conv -> source=scheduled",
                str(row.get("source")),
            )
        else:
            skip(
                "scheduled conv live re-meter",
                f"trace gone / {r}; source already=scheduled in ledger",
            )
    else:
        skip("scheduled conv", "no scheduled META row found in ledger")


# ════════════════════════════════════════════════════════════════════════════════════════════
def test_admin_api() -> None:
    section("C. admin-credits Lambdas (deployed)")

    # balance (admin)
    st, b = api(FN_BAL, "GET", "/credits/balance", admin=True)
    check(
        st == 200 and isinstance(b.get("balance"), (int, float)),
        "GET balance (admin) -> 200 + numeric",
        str(b),
    )

    # ledger + projection safety (admin)
    month = time.strftime("%Y-%m", time.gmtime())
    st, l = api(FN_LED, "GET", "/credits/ledger", query={"month": month}, admin=True)
    check(
        st == 200 and "items" in l,
        "GET ledger (admin) -> 200 + items",
        f"month={month} n={len(l.get('items', []))}",
    )
    leaked = set()
    for row in l.get("items", []):
        leaked |= set(row) & FORBIDDEN_ADMIN
    check(
        not leaked,
        "ledger rows leak NO cost/token/internal fields",
        f"leaked={leaked or 'none'}",
    )
    if l.get("items"):
        recomputed = sum(num(r.get("creditsCharged")) for r in l["items"])
        check(
            abs(recomputed - num(l.get("totalCredits"))) < 1e-6,
            "ledger totalCredits == sum(rows)",
            f"{l.get('totalCredits')} vs {recomputed}",
        )
        ts = [str(r.get("lastTs") or "") for r in l["items"]]
        check(ts == sorted(ts, reverse=True), "ledger sorted newest-first by lastTs")

    # topup: snapshot -> +N (admin) -> assert -> restore
    snap = tbl.get_item(Key={"PK": f"CLIENT#{CLIENT}", "SK": "BALANCE"}).get("Item")
    base = num(snap["balance"]) if snap else 0.0
    try:
        st, t = api(FN_TOP, "POST", "/credits/topup", body={"credits": 50}, admin=True)
        check(
            st == 200 and abs(num(t.get("balance")) - (base + 50)) < 1e-6,
            "topup +50 (admin) -> balance + 50",
            f"{base} -> {t.get('balance')}",
        )
        # non-admin forbidden
        st, _ = api(FN_TOP, "POST", "/credits/topup", body={"credits": 50}, admin=False)
        check(st == 403, "topup without admin group -> 403", f"got {st}")
        # invalid inputs
        st, _ = api(FN_TOP, "POST", "/credits/topup", body={"credits": -5}, admin=True)
        check(st == 400, "topup negative -> 400", f"got {st}")
        st, _ = api(FN_TOP, "POST", "/credits/topup", body={"credits": 0}, admin=True)
        check(st == 400, "topup zero -> 400", f"got {st}")
        st, _ = api(
            FN_TOP, "POST", "/credits/topup", body={"credits": "abc"}, admin=True
        )
        check(st == 400, "topup non-numeric -> 400", f"got {st}")
    finally:
        if snap is not None:
            tbl.put_item(Item={**snap, "balance": Decimal(str(base))})
            after = tbl.get_item(Key={"PK": f"CLIENT#{CLIENT}", "SK": "BALANCE"})[
                "Item"
            ]
            check(
                num(after["balance"]) == base,
                "balance restored after topup tests",
                f"={after['balance']}",
            )

    # #3 fix: balance/ledger reads now require the cognito 'admin' group
    st_bal, _ = api(FN_BAL, "GET", "/credits/balance")  # no admin token
    check(st_bal == 403, "balance read WITHOUT admin -> 403 (gated)", f"got {st_bal}")
    st_led, _ = api(FN_LED, "GET", "/credits/ledger")  # no admin token
    check(st_led == 403, "ledger read WITHOUT admin -> 403 (gated)", f"got {st_led}")


# ════════════════════════════════════════════════════════════════════════════════════════════
def test_data_integrity() -> None:
    section("D. Ledger data integrity (all existing rows)")
    items, lek = [], None
    while True:
        kw = {"ExclusiveStartKey": lek} if lek else {}
        r = tbl.scan(**kw)
        items += r["Items"]
        lek = r.get("LastEvalKey") or r.get("LastEvaluatedKey")
        if not lek:
            break
    metas = [i for i in items if i["SK"] == "META"]
    msgs_by_conv: dict[str, list] = {}
    for i in items:
        if str(i["SK"]).startswith("MSG#"):
            msgs_by_conv.setdefault(str(i["PK"]), []).append(i)
    print(
        f"  ({len(metas)} META rows, {sum(len(v) for v in msgs_by_conv.values())} MSG rows)"
    )

    bad_margin, bad_charge, bad_gsi, bad_floor, bad_count, bad_month = (
        [],
        [],
        [],
        [],
        [],
        [],
    )
    for m in metas:
        conv = str(m["PK"]).replace("CONV#", "")
        charged, value, floor = (
            num(m["creditsCharged"]),
            num(m["creditsValue"]),
            num(m["creditsFloor"]),
        )
        cost = num(m.get("consumptionCostUsd"))
        if charged != max(value, floor):
            bad_charge.append(conv)
        if cost > 0:
            mg = charged * CREDIT_USD / cost
            if mg < MARGIN_TARGET - 1e-6:
                bad_margin.append((conv, round(mg, 3)))
        if (
            m.get("GSI1PK") != f"USER#{m.get('userSub')}"
            or m.get("GSI2PK") != f"MONTH#{m.get('month')}"
            or m.get("GSI2SK") != f"CONV#{conv}"
        ):
            bad_gsi.append(conv)
        if m.get("lastTs") and str(m["lastTs"])[:7] != str(m.get("month")):
            bad_month.append(conv)
        cmsgs = msgs_by_conv.get(m["PK"], [])
        if cmsgs:
            if int(m["msgCount"]) != len(cmsgs):
                bad_count.append(conv)
        # Floor must recover cost: creditsFloor >= ceil(consumption*margin/credit). New rows use a
        # single ceil on the total (== this bound); pre-fix rows summed per-message ceils (>= bound).
        if cost > 0 and int(round(floor)) < floor_credits(cost):
            bad_floor.append((conv, int(round(floor)), floor_credits(cost)))

    check(
        not bad_charge,
        "every META: creditsCharged == max(value, floor)",
        f"violations={bad_charge}",
    )
    check(
        not bad_margin,
        "every META: realised margin >= 2.0 (the core guarantee)",
        f"violations={bad_margin}",
    )
    check(not bad_gsi, "every META: GSI1/GSI2 keys consistent", f"violations={bad_gsi}")
    check(not bad_month, "every META: month == lastTs[:7]", f"violations={bad_month}")
    check(not bad_count, "every META: msgCount == #MSG rows", f"violations={bad_count}")
    check(
        not bad_floor,
        "every META: creditsFloor >= cost-recovery floor (no under-recovery)",
        f"violations={bad_floor}",
    )

    # reconciliation aggregate gap
    recon = [i for i in items if str(i["SK"]).startswith("MONTH#")]
    if not recon:
        finding(
            "no monthly reconciliation rows",
            "month_aggregate_item (PK=CLIENT#, SK=MONTH#) exists in lib but nothing in the live path "
            "writes it. The panel derives 'used this month' by summing META rows via GSI2, so this is "
            "latent until a reconciliation job is wired. Not user-visible today.",
        )


def main() -> int:
    print(f"Credit-system harness — client={CLIENT} region={REGION} table={TABLE}")
    for fn in (test_pure_math, test_debit_lambda, test_admin_api, test_data_integrity):
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            bad(f"{fn.__name__} crashed", repr(exc))
    section("SUMMARY")
    print(
        f"  PASS={len(PASS)}  FAIL={len(FAIL)}  FINDINGS={len(FINDING)}  SKIP={len(SKIP)}"
    )
    if FAIL:
        print("  FAILURES:")
        [print(f"    - {f}") for f in FAIL]
    if FINDING:
        print("  FINDINGS:")
        [print(f"    - {n}: {d}") for n, d in FINDING]
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())

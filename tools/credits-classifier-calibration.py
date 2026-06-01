#!/usr/bin/env python3
"""Calibration sweep for the Numa Credit System value-tier classifier (Nova 2 Lite).

The value tier drives price (low=2 … very_high=30 credits), so a miscalibrated classifier directly
mis-bills. This runs a rubric-spanning sample set through the REAL classifier the system uses
(credit_pricing.tiers.classify -> Nova 2 Lite, temp 0) and reports a confusion matrix + directional
bias + the credit-overcharge implied by each mismatch.

    AWS_PROFILE=q-demo python3 tools/credits-classifier-calibration.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(__file__), "..", "lib", "credit-pricing")
)
from credit_pricing.tiers import classify, tier_to_credits  # noqa: E402

ORDER = ["low", "medium", "high", "very_high"]

# (sample user messages, expected tier per rubric, short note)
SAMPLES = [
    # ── casual / non-work (the haiku case): should be LOW, arguably not billable value ──
    (["talk to me goose"], "low", "casual banter"),
    (["give me a haiku about rain"], "low", "trivial creative one-liner"),
    (["tell me a joke"], "low", "casual"),
    (
        [
            "the rain in spain falls mainly on the plane",
            "give me a haiku based on it",
            "then give me a haiku based on that haiku",
        ],
        "low",
        "haiku chain (the live case → Nova said HIGH)",
    ),
    (["hi", "how are you"], "low", "greeting"),
    # ── genuine low: quick single-step utility ──
    (["what's the capital of France?"], "low", "lookup"),
    (["fix the typo in this sentence: I recieved your emial"], "low", "trivial edit"),
    (["convert 50 USD to NZD"], "low", "quick calc"),
    # ── medium: predictable multi-step, polished output ──
    (
        ["draft a polite follow-up email to a client who hasn't paid their invoice"],
        "medium",
        "email draft",
    ),
    (
        ["summarise this 2-page meeting transcript into 5 bullet points"],
        "medium",
        "summary",
    ),
    (
        [
            "create a simple monthly budget spreadsheet with income and expense categories"
        ],
        "medium",
        "doc creation",
    ),
    (["write a job description for a junior software engineer"], "medium", "drafting"),
    # ── high: expert deliverable, domain judgement, multi-step / cross-system ──
    (
        [
            "analyse our Q3 sales data, find the 3 fastest-declining regions and explain why"
        ],
        "high",
        "analysis",
    ),
    (
        [
            "review this 12-page supplier contract and flag clauses that expose us to liability"
        ],
        "high",
        "doc review",
    ),
    (
        [
            "build a Python script that scrapes these 200 product listings, dedupes them and exports CSV"
        ],
        "high",
        "code build",
    ),
    (
        [
            "design a KPI dashboard from this dataset with the right charts and a written readout"
        ],
        "high",
        "dashboard",
    ),
    # ── very_high: strategic / senior-expert / production-grade (should be RARE) ──
    (
        [
            "build a 5-year financial model with 3 scenarios, sensitivity analysis and a board recommendation"
        ],
        "very_high",
        "financial model",
    ),
    (
        [
            "grade this tender response against the full World Bank procurement policy and produce a compliance report"
        ],
        "very_high",
        "compliance grading",
    ),
    (
        ["architect and build a complete multi-tenant SaaS billing service end to end"],
        "very_high",
        "full app build",
    ),
]


def main() -> int:
    print(
        "Classifier calibration — real Nova 2 Lite via credit_pricing.tiers.classify (chat context)\n"
    )
    confusion = {e: {a: 0 for a in ORDER} for e in ORDER}
    exact = adjacent = over = under = 0
    overcharge_credits = 0
    rows = []
    for texts, expected, note in SAMPLES:
        res = classify(texts, context="chat")
        actual = res["tier"]
        di = ORDER.index(actual) - ORDER.index(expected)
        confusion[expected][actual] += 1
        if di == 0:
            exact += 1
        elif abs(di) == 1:
            adjacent += 1
        if di > 0:
            over += 1
            overcharge_credits += tier_to_credits(actual) - tier_to_credits(expected)
        elif di < 0:
            under += 1
        flag = (
            "  "
            if di == 0
            else ("↑↑" if di >= 2 else "↑ " if di == 1 else "↓ " if di == -1 else "↓↓")
        )
        rows.append(
            (
                flag,
                expected,
                actual,
                res["category"],
                tier_to_credits(expected),
                tier_to_credits(actual),
                note,
            )
        )

    print(
        f"{'':3}{'expected':11}{'actual':11}{'category':22}{'cr_exp':7}{'cr_act':7}note"
    )
    for flag, e, a, cat, ce, ca, note in rows:
        col = (
            "\033[31m"
            if flag.strip() in ("↑↑", "↓↓")
            else ("\033[33m" if flag.strip() else "\033[32m")
        )
        print(f"{col}{flag}\033[0m {e:11}{a:11}{cat:22}{ce:<7}{ca:<7}{note}")

    n = len(SAMPLES)
    print(
        f"\nExact: {exact}/{n} ({100*exact//n}%)   within-1-tier: {exact+adjacent}/{n}"
    )
    print(
        f"Directional bias: OVER-rated {over}, UNDER-rated {under}  "
        f"(>0 over = systematic overcharge)"
    )
    print(
        f"Implied overcharge on this sample: +{overcharge_credits} credits "
        f"(US${overcharge_credits*0.5:.2f}) from over-classification alone"
    )
    print("\nConfusion (rows=expected, cols=actual):")
    print(f"  {'':11}" + "".join(f"{a:11}" for a in ORDER))
    for e in ORDER:
        print(f"  {e:11}" + "".join(f"{confusion[e][a]:<11}" for a in ORDER))

    casual = [
        r
        for r in rows
        if "casual" in r[6] or "haiku" in r[6] or "greeting" in r[6] or "banter" in r[6]
    ]
    casual_hot = [r for r in casual if ORDER.index(r[2]) >= ORDER.index("medium")]
    if casual_hot:
        print(
            f"\n\033[31mBIAS\033[0m casual/non-work conversations rated >= medium: "
            f"{len(casual_hot)}/{len(casual)} — these should be 'low'. "
            "Value-tier inflation on chit-chat is the biggest mis-billing risk."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

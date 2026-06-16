#!/usr/bin/env python3
"""quote_math.py — correct quote arithmetic: GST, discounts, deposit splits.

GENERIC HELPER (quoting skill). Centralises the money math that benchmarks got
wrong — most importantly that a deposit/progress split applies to the
GST-INCLUSIVE total, not the subtotal (otherwise the deposit + balance never
collect the GST and the customer is undercharged).

Usage (library):
  from quote_math import quote
  q = quote(line_items=[{"qty":50,"unit_price":12.5},{"qty":25,"unit_price":8.75}],
            gst_rate=0.15, discount_pct=0.10, deposit_pct=0.5)
  print(q)   # dict: subtotal, discount, net, gst, total, deposit, balance

Usage (CLI, quick check):
  python3 quote_math.py --items '[{"qty":50,"unit_price":12.5}]' \
      --gst 0.15 --discount 0.10 --deposit 0.5
"""

import argparse
import json
import sys


def _round2(x: float) -> float:
    # Round half-up to cents, avoiding banker's rounding surprises on .5 cases.
    return float(int(round(x * 100 + (1e-9 if x >= 0 else -1e-9))) / 100)


def quote(line_items, gst_rate=0.15, discount_pct=0.0, deposit_pct=None):
    """Compute a quote. line_items: list of {qty, unit_price[, discount_pct]}.

    Returns a dict with every intermediate so you can show your working.
    The deposit/balance split is on the GST-INCLUSIVE total.
    """
    subtotal = 0.0
    for it in line_items:
        line = it["qty"] * it["unit_price"]
        line *= 1 - it.get("discount_pct", 0.0)  # per-line discount, optional
        subtotal += line
    subtotal = _round2(subtotal)

    discount = _round2(subtotal * discount_pct)
    net = _round2(subtotal - discount)  # GST-exclusive
    gst = _round2(net * gst_rate)
    total = _round2(net + gst)  # GST-inclusive

    result = {
        "subtotal_ex_gst": subtotal,
        "discount": discount,
        "net_ex_gst": net,
        "gst": gst,
        "total_inc_gst": total,
    }
    if deposit_pct is not None:
        # Split the GST-INCLUSIVE total — this is the rule that benchmarks broke.
        deposit = _round2(total * deposit_pct)
        result["deposit"] = deposit
        result["balance"] = _round2(total - deposit)  # exact, no rounding drift
        result["deposit_pct"] = deposit_pct
    return result


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--items", required=True, help="JSON list of {qty, unit_price[, discount_pct]}"
    )
    p.add_argument("--gst", type=float, default=0.15)
    p.add_argument(
        "--discount", type=float, default=0.0, help="order-level discount fraction"
    )
    p.add_argument(
        "--deposit",
        type=float,
        default=None,
        help="deposit fraction of GST-inclusive total",
    )
    args = p.parse_args()
    q = quote(
        json.loads(args.items),
        gst_rate=args.gst,
        discount_pct=args.discount,
        deposit_pct=args.deposit,
    )
    print(json.dumps(q, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

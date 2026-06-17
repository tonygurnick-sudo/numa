"""
Algorithmic sanity check on hand-defined customer archetypes.

Loads per-customer dimensions, builds normalized feature vectors, runs k-means
and Ward hierarchical clustering at k=6, computes ARI/NMI vs the manual
archetype labels, and reports a contingency table + disagreements.

Usage:
    python tools/credits_archetype_sanity_check.py
"""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from sklearn.cluster import AgglomerativeClustering, KMeans
from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score

DIMENSIONS_PATH = Path(
    "/Users/nathandouglas/arcanum/numa/dev-notes/tasks/credits-work/outputs/customer-dimensions.json"
)

MANUAL_ARCHETYPES: list[dict] = [
    {
        "name": "Chat-First Knowledge Worker",
        "assigned_customers": [
            "moira-shire-council",
            "ddconsulting",
            "eliotsinclair",
            "thealternativeboard",
            "tregaskisbrown",
            "convergehr",
            "energylightgroup",
            "pcl",
            "huddle-advisory",
        ],
    },
    {
        "name": "Agent-Operator Power User",
        "assigned_customers": [
            "av-media",
            "chandler",
            "signsgraphics",
            "newfieldroofingnz",
            "advanceelectrical",
            "homeofficepainting",
        ],
    },
    {
        "name": "Boutique Adhoc Workhorse",
        "assigned_customers": [
            "tleaft",
            "davidreidhomes",
            "chriswhelancoaching",
            "roof-logic",
            "howie",
            "apex",
        ],
    },
    {
        "name": "Pure Chat Adopter",
        "assigned_customers": [
            "uplift-education",
            "kpl",
            "theelitenetwork",
            "seven-electrical",
            "capitalfootball",
            "fantailservices",
            "rocketscience",
        ],
    },
    {
        "name": "Emerging Mid-Market Builder",
        "assigned_customers": [
            "momentum",
            "w-advisory",
            "hangingaround",
            "flowerdayhomes",
            "fridayhomes",
            "boroughbuilders",
            "momentumiq",
            "morden",
            "tabphilly",
        ],
    },
    {
        "name": "Sub-Scale / At-Risk",
        "assigned_customers": [
            "vadacom",
            "atlanticengineering",
            "racetech",
            "mexted",
            "griffiths-group",
            "ultra-it",
        ],
    },
]


def manual_label_map() -> dict[str, str]:
    out: dict[str, str] = {}
    for arch in MANUAL_ARCHETYPES:
        for c in arch["assigned_customers"]:
            out[c] = arch["name"]
    return out


def build_features(records: list[dict]) -> tuple[np.ndarray, list[str], list[str]]:
    feature_names = [
        "log_provisioned",
        "log_active",
        "log_n_msgs",
        "log_credits",
        "surf_chat",
        "surf_sched",
        "surf_adhoc",
        "tier_low",
        "tier_medium",
        "tier_high",
        "tier_very_high",
        "log_total_agents",
        "log_active_scheduled",
    ]

    clients: list[str] = []
    rows: list[list[float]] = []

    for r in records:
        client = r["client"]
        surf = r.get("surface_mix", {}) or {}
        tier = r.get("tier_mix", {}) or {}
        row = [
            math.log1p(r.get("provisioned_users", 0) or 0),
            math.log1p(r.get("active_users", 0) or 0),
            math.log1p(r.get("n_msgs_30d", 0) or 0),
            math.log1p(r.get("credits_30d", 0) or 0),
            float(surf.get("chat", 0) or 0),
            float(surf.get("agent-scheduled", 0) or 0),
            float(surf.get("agent-adhoc", 0) or 0),
            float(tier.get("low", 0) or 0),
            float(tier.get("medium", 0) or 0),
            float(tier.get("high", 0) or 0),
            float(tier.get("very_high", 0) or 0),
            math.log1p(r.get("total_agents", 0) or 0),
            math.log1p(r.get("n_active_scheduled_agents", 0) or 0),
        ]
        clients.append(client)
        rows.append(row)

    X = np.array(rows, dtype=float)
    # standardise (z-score) per feature
    mu = X.mean(axis=0)
    sigma = X.std(axis=0)
    sigma[sigma == 0] = 1.0
    Xz = (X - mu) / sigma
    return Xz, clients, feature_names


def contingency_table(
    manual: list[str], algo: list[int], manual_names: list[str], k: int
) -> dict[str, dict[int, int]]:
    table: dict[str, dict[int, int]] = {
        n: {i: 0 for i in range(k)} for n in manual_names
    }
    for m, a in zip(manual, algo):
        table[m][a] += 1
    return table


def render_md_contingency(
    table: dict[str, dict[int, int]], cluster_labels: list[str], k: int
) -> str:
    header = "| Manual archetype | " + " | ".join(cluster_labels) + " | Total |"
    sep = "|" + "---|" * (k + 2)
    lines = [header, sep]
    col_totals = [0] * k
    for name, counts in table.items():
        total = sum(counts.values())
        for i in range(k):
            col_totals[i] += counts[i]
        cells = " | ".join(str(counts[i]) for i in range(k))
        lines.append(f"| {name} | {cells} | {total} |")
    lines.append(
        "| **Total** | "
        + " | ".join(str(c) for c in col_totals)
        + f" | {sum(col_totals)} |"
    )
    return "\n".join(lines)


def best_label_for_cluster(table: dict[str, dict[int, int]], k: int) -> dict[int, str]:
    out: dict[int, str] = {}
    for i in range(k):
        best_name, best_count = None, -1
        for name, counts in table.items():
            if counts[i] > best_count:
                best_name, best_count = name, counts[i]
        out[i] = best_name or ""
    return out


def main() -> None:
    records = json.loads(DIMENSIONS_PATH.read_text())
    manual_map = manual_label_map()

    # Only keep records that appear in the manual labelling
    in_manual = [r for r in records if r["client"] in manual_map]
    missing_manual = sorted(set(manual_map.keys()) - {r["client"] for r in records})
    if missing_manual:
        print(
            f"[warn] manually-labelled clients missing from dimensions: {missing_manual}"
        )

    X, clients, feature_names = build_features(in_manual)
    manual_labels = [manual_map[c] for c in clients]
    manual_names = [a["name"] for a in MANUAL_ARCHETYPES]

    print(f"N customers analysed: {len(clients)}")
    print(f"Feature dim: {X.shape[1]} -> {feature_names}\n")

    k = 6

    # --- k-means ---
    km = KMeans(n_clusters=k, n_init=50, random_state=42)
    km_labels = km.fit_predict(X).tolist()

    # --- Ward hierarchical ---
    ward = AgglomerativeClustering(n_clusters=k, linkage="ward")
    ward_labels = ward.fit_predict(X).tolist()

    # --- Scores ---
    km_ari = adjusted_rand_score(manual_labels, km_labels)
    km_nmi = normalized_mutual_info_score(manual_labels, km_labels)
    ward_ari = adjusted_rand_score(manual_labels, ward_labels)
    ward_nmi = normalized_mutual_info_score(manual_labels, ward_labels)

    print(f"k-means        ARI = {km_ari:.3f}   NMI = {km_nmi:.3f}")
    print(f"Ward (hier.)   ARI = {ward_ari:.3f}   NMI = {ward_nmi:.3f}\n")

    # --- Contingency tables ---
    km_table = contingency_table(manual_labels, km_labels, manual_names, k)
    ward_table = contingency_table(manual_labels, ward_labels, manual_names, k)

    km_cluster_label = best_label_for_cluster(km_table, k)
    ward_cluster_label = best_label_for_cluster(ward_table, k)

    km_cols = [f"K{i} ({km_cluster_label[i][:18]})" for i in range(k)]
    ward_cols = [f"W{i} ({ward_cluster_label[i][:18]})" for i in range(k)]

    print("### K-means contingency\n")
    print(render_md_contingency(km_table, km_cols, k))
    print()
    print("### Ward contingency\n")
    print(render_md_contingency(ward_table, ward_cols, k))
    print()

    # --- Disagreement analysis ---
    # Use whichever algo had the higher ARI as the "winner" for disagreement reporting
    if km_ari >= ward_ari:
        winner_name = "k-means"
        winner_labels = km_labels
        winner_table = km_table
        winner_cluster_label = km_cluster_label
    else:
        winner_name = "Ward"
        winner_labels = ward_labels
        winner_table = ward_table
        winner_cluster_label = ward_cluster_label

    print(f"Winner (by ARI): {winner_name}\n")

    # A customer "disagrees" if its manual archetype != the dominant manual label
    # of its algorithmic cluster, and the algorithmic cluster's dominant label is a
    # clearly different cohort.
    disagreements: list[dict] = []
    rec_by_client = {r["client"]: r for r in in_manual}
    for client, manual, algo in zip(clients, manual_labels, winner_labels):
        algo_dominant = winner_cluster_label[algo]
        if algo_dominant and algo_dominant != manual:
            rec = rec_by_client[client]
            surf = rec.get("surface_mix", {}) or {}
            reason_bits = []
            chat = float(surf.get("chat", 0) or 0)
            sched = float(surf.get("agent-scheduled", 0) or 0)
            adhoc = float(surf.get("agent-adhoc", 0) or 0)
            users = rec.get("active_users", 0)
            prov = rec.get("provisioned_users", 0)
            msgs = rec.get("n_msgs_30d", 0)
            creds = rec.get("credits_30d", 0)
            tot_ag = rec.get("total_agents", 0)
            sched_ag = rec.get("n_active_scheduled_agents", 0)

            reason_bits.append(
                f"chat={chat:.0f}% sched={sched:.0f}% adhoc={adhoc:.0f}%"
            )
            reason_bits.append(
                f"users={users}/{prov}, msgs={msgs}, credits={creds:.0f}"
            )
            reason_bits.append(f"agents total={tot_ag} sched_active={sched_ag}")

            disagreements.append(
                {
                    "client": client,
                    "manual_archetype": manual,
                    "algorithmic_cluster": f"{winner_name} cluster {algo} (dominant: {algo_dominant})",
                    "why_it_disagrees": "; ".join(reason_bits),
                }
            )

    print(f"Disagreements (manual vs {winner_name}): {len(disagreements)}\n")
    for d in disagreements:
        print(f"- {d['client']}")
        print(f"    manual: {d['manual_archetype']}")
        print(f"    algo:   {d['algorithmic_cluster']}")
        print(f"    why:    {d['why_it_disagrees']}")

    # Verdict
    best_ari = max(km_ari, ward_ari)
    if best_ari > 0.5:
        verdict = "consistent"
    elif best_ari > 0.25:
        verdict = "partially consistent"
    else:
        verdict = "weak"
    print(f"\nVerdict: {verdict} (best ARI = {best_ari:.3f})")


if __name__ == "__main__":
    main()

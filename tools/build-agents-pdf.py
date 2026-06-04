#!/usr/bin/env python3
"""Render the nextgen public-agents audit into a single PDF.

Reads /tmp/nextgen_agents_result.json (produced by audit-nextgen-agents.py)
and writes /tmp/nextgen-agents.pdf containing:
  1. Title + summary stats
  2. A per-client summary table (count + region)
  3. The full per-client agent-name listing
"""

import json

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

RES = json.load(open("/tmp/nextgen_agents_result.json"))
OUT = "/tmp/nextgen-agents.pdf"

with_agents = sorted([r for r in RES if r["agents"]], key=lambda r: r["name"].lower())
empty = sorted([r["name"] for r in RES if not r["agents"] and not r["error"]])
errs = [r for r in RES if r["error"] and r["error"] != "management-account-skip"]
total_agents = sum(len(r["agents"]) for r in RES)

REGION_SHORT = {
    "us-east-1": "us-east-1",
    "ap-southeast-2": "ap-se-2",
    "ap-southeast-3": "ap-se-3",
}

styles = getSampleStyleSheet()
h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=20, spaceAfter=4)
sub = ParagraphStyle(
    "sub",
    parent=styles["Normal"],
    fontSize=9,
    textColor=colors.HexColor("#555555"),
    spaceAfter=10,
)
h2 = ParagraphStyle(
    "h2",
    parent=styles["Heading2"],
    fontSize=13,
    textColor=colors.HexColor("#1a3d6e"),
    spaceBefore=10,
    spaceAfter=4,
)
client_h = ParagraphStyle(
    "clienth",
    parent=styles["Heading3"],
    fontSize=11,
    textColor=colors.HexColor("#1a3d6e"),
    spaceBefore=8,
    spaceAfter=2,
)
body = ParagraphStyle("body", parent=styles["Normal"], fontSize=9, leading=12)
agent_li = ParagraphStyle(
    "agentli", parent=styles["Normal"], fontSize=9, leading=12, leftIndent=10
)
note = ParagraphStyle(
    "note",
    parent=styles["Normal"],
    fontSize=8,
    textColor=colors.HexColor("#777777"),
    leading=11,
)

story = []
story.append(Paragraph("Numa — Public Agents by Client", h1))
story.append(
    Paragraph(
        f"Nextgen-managed AWS Organization &middot; Generated 2026-06-03 &middot; "
        f"Workspace (public) agents only &middot; "
        f"<b>{len(with_agents)}</b> clients with agents &middot; "
        f"<b>{total_agents}</b> agents total",
        sub,
    )
)

# ---- Summary table ----
story.append(Paragraph("Summary — agents per client", h2))
header = ["Client", "Agents", "Region"]
rows = [header]
for r in with_agents:
    rows.append(
        [
            r["name"],
            str(len(r["agents"])),
            REGION_SHORT.get(r["region"], r["region"] or "-"),
        ]
    )

# split into 2 columns of rows to fit on fewer pages
half = (len(rows) - 1 + 1) // 2
left = [header] + rows[1 : 1 + half]
right = [header] + rows[1 + half :]
while len(right) < len(left):
    right.append(["", "", ""])

combined = [["Client", "Ag", "Region", "Client", "Ag", "Region"]]
for i in range(1, len(left)):
    lr = left[i]
    rr = right[i] if i < len(right) else ["", "", ""]
    combined.append([lr[0], lr[1], lr[2], rr[0], rr[1], rr[2]])

tbl = Table(
    combined,
    colWidths=[42 * mm, 10 * mm, 20 * mm, 42 * mm, 10 * mm, 20 * mm],
    repeatRows=1,
)
tbl.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a3d6e")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (1, 0), (1, -1), "CENTER"),
            ("ALIGN", (4, 0), (4, -1), "CENTER"),
            (
                "ROWBACKGROUNDS",
                (0, 1),
                (-1, -1),
                [colors.white, colors.HexColor("#eef2f7")],
            ),
            ("LINEAFTER", (2, 0), (2, -1), 0.5, colors.HexColor("#cccccc")),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#dddddd")),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]
    )
)
story.append(tbl)

# ---- Full listing ----
story.append(Paragraph("Full agent listing by client", h2))
for r in with_agents:
    block = [
        Paragraph(
            f"{r['name']} &nbsp;<font size=8 color='#888888'>"
            f"({len(r['agents'])} agents &middot; "
            f"{REGION_SHORT.get(r['region'], r['region'])})</font>",
            client_h,
        )
    ]
    for a in r["agents"]:
        t = (
            (a["title"] or "(untitled)")
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        block.append(Paragraph(f"&bull;&nbsp;{t}", agent_li))
    story.append(KeepTogether(block))

# ---- Footnotes ----
story.append(Spacer(1, 8))
story.append(Paragraph("Notes", h2))
story.append(
    Paragraph(f"Clients with 0 public agents ({len(empty)}): " + ", ".join(empty), note)
)
if errs:
    story.append(Spacer(1, 4))
    e = errs[0]
    story.append(
        Paragraph(
            f"Could not access: {e['name']} ({e['id']}) — assume-role denied.", note
        )
    )
story.append(Spacer(1, 4))
story.append(
    Paragraph(
        "Counts are agent records (genuine duplicates / copies are shown). "
        "Personal per-user agents are excluded. Source: {client}-agents DynamoDB tables, "
        "read via OrganizationAccountAccessRole across the nextgen-management org.",
        note,
    )
)

doc = SimpleDocTemplate(
    OUT,
    pagesize=A4,
    leftMargin=15 * mm,
    rightMargin=15 * mm,
    topMargin=15 * mm,
    bottomMargin=15 * mm,
    title="Numa Public Agents by Client",
)
doc.build(story)
print("WROTE", OUT)

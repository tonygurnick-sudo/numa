#!/usr/bin/env python3
"""One-off extraction of the NZSBA exemplar policy suite to markdown.

Reads the vision-extracted PDF JSON (infra/assets/examplar_policy_nzsba.pdf.json)
and produces the plain-markdown exemplar bundled into the workspace-agent image
for the policy-designer V2 app (FEAT-174):

    services/numa-workspace-agent/numa_workspace_agent/agent_types/policy_designer/assets/exemplar.md

Heuristics (validated against the 2025 exemplar layout):
  - "Section One..Four" + the following area-title line merge into a `#` heading.
  - "General <Area> Policy" lines become `##` headings.
  - Numbered headings (1.1 / 2.1.1 / 4.4.2.1) map to ###/####/##### by depth.
  - Blank-line-separated blocks with multiple lines are treated as an intro
    line followed by list items (the PDF extraction drops bullet glyphs but
    keeps items on their own lines). Items after an item ending with an em
    dash or colon are nested one level.

Run from the repo root:  python3 scripts/extract-nzsba-exemplar.py
The output is committed; a manual review pass follows regeneration.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE = REPO_ROOT / "infra" / "assets" / "examplar_policy_nzsba.pdf.json"
DEST = (
    REPO_ROOT
    / "services"
    / "numa-workspace-agent"
    / "numa_workspace_agent"
    / "agent_types"
    / "policy_designer"
    / "assets"
    / "exemplar.md"
)

SECTION_RE = re.compile(r"^Section (One|Two|Three|Four)\s*$")
GENERAL_RE = re.compile(r"^General [A-Za-z\- ]{0,60}Policy\s*$")
NUMBERED_RE = re.compile(r"^(\d+(?:\.\d+)+)\s+(\S.*)$")
LETTERED_RE = re.compile(r"^\(?([a-z])\)\s*(\S.*)$")
# Area names that appear as standalone mini-headings on the intro pages.
INTRO_AREA_HEADINGS = {
    "Impact Policies",
    "Operational Expectation Policies",
    "Board-Management Relationship Policies",
    "Governance Culture Policies",
}


def clean_line(line: str) -> str:
    """Normalise whitespace and join words broken by PDF extraction."""
    line = line.replace(" ", " ")
    # "co- opted" -> "co-opted" (hyphenated word split across a line break)
    line = re.sub(r"([a-z])- ([a-z])", r"\1-\2", line)
    return re.sub(r"\s+", " ", line).strip()


def blocks_from_pages(pages: list[dict]) -> list[list[str]]:
    """Split the whole document into blank-line-separated blocks of lines."""
    blocks: list[list[str]] = []
    current: list[str] = []
    for page in pages:
        for raw in page["text"].split("\n"):
            line = clean_line(raw)
            if not line:
                if current:
                    blocks.append(current)
                    current = []
                continue
            current.append(line)
        # A page break also terminates a block — headings never straddle pages.
        if current:
            blocks.append(current)
            current = []
    return blocks


def heading_for(line: str) -> str | None:
    """Return a markdown heading for the line, or None if it's body text."""
    if GENERAL_RE.match(line):
        return f"## {line}"
    m = NUMBERED_RE.match(line)
    if (
        m
        and len(m.group(2)) <= 90
        and not m.group(2).rstrip().endswith((".", ",", ";"))
    ):
        depth = m.group(1).count(".")  # 1.1 -> 1, 2.1.1 -> 2, 4.4.2.1 -> 3
        return f"{'#' * min(depth + 2, 6)} {line}"
    return None


def render(blocks: list[list[str]]) -> str:
    out: list[str] = []
    pending_section: str | None = None

    for block in blocks:
        lines = list(block)

        if pending_section is not None:
            # The line after "Section N" is the area title — merge them.
            title = lines.pop(0)
            out.append(f"# {pending_section} — {title}")
            out.append("")
            pending_section = None
            if not lines:
                continue

        if len(lines) == 1:
            line = lines[0]
            if SECTION_RE.match(line):
                pending_section = line
                continue
            if line == "Sample Policy Suite":
                out.append(f"# {line}")
            elif line == "Introduction" or line in INTRO_AREA_HEADINGS:
                out.append(f"{'##' if line == 'Introduction' else '###'} {line}")
            else:
                heading = heading_for(line)
                out.append(heading if heading else line)
            out.append("")
            continue

        # Multi-line block. Section divider may start it.
        if SECTION_RE.match(lines[0]):
            section = lines.pop(0)
            title = lines.pop(0)
            out.append(f"# {section} — {title}")
            out.append("")
            if not lines:
                continue

        # A heading may lead the block, with its body following.
        first_heading = heading_for(lines[0]) or (
            f"## {lines[0]}" if GENERAL_RE.match(lines[0]) else None
        )
        if first_heading is None and lines[0] in INTRO_AREA_HEADINGS:
            first_heading = f"### {lines[0]}"
        if first_heading:
            out.append(first_heading)
            out.append("")
            lines = lines[1:]
            if not lines:
                continue

        if len(lines) == 1:
            out.append(lines[0])
            out.append("")
            continue

        # Intro line + list items. Mid-block headings (rare) flush the list.
        intro = lines[0]
        out.append(intro)
        nested = False
        for item in lines[1:]:
            heading = heading_for(item)
            if heading:
                out.append("")
                out.append(heading)
                out.append("")
                nested = False
                continue
            m = LETTERED_RE.match(item)
            if m:
                item = m.group(2)
            indent = "  " if nested else ""
            out.append(f"{indent}- {item}")
            if item.rstrip().endswith(("—", ":", "—")):
                nested = True
        out.append("")

    text = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"


def main() -> None:
    doc = json.loads(SOURCE.read_text(encoding="utf-8"))
    markdown = render(blocks_from_pages(doc["pages"]))
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(markdown, encoding="utf-8")
    words = len(markdown.split())
    print(
        f"Wrote {DEST} ({len(markdown)} chars, ~{words} words, source {doc['total_num_words']} words)"
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Render a simple, low-cognitive-load PDF listing the AWS services that are
NOT yet available in the Asia Pacific (New Zealand) Region, ap-southeast-6.

Source: AWS's own regional-services dataset (191 tracked services in us-east-1
vs 115 in ap-southeast-6), cross-checked against per-service docs and the AWS
What's New feed, June 2026. The "Security Hub" dataset duplicate is excluded
because AWS Security Hub IS available in Auckland.

Writes /tmp/aws-nz-services-not-available.pdf
"""

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = "/tmp/aws-nz-services-not-available.pdf"

# Curated, short names — grouped for scannability.
CATEGORIES = [
    (
        "AI / Machine Learning",
        [
            "Bedrock AgentCore",
            "Amazon Q Business",
            "Amazon Q Developer",
            "Comprehend",
            "Textract",
            "Rekognition",
            "Transcribe",
            "Translate",
            "Lex",
            "Kendra",
            "Personalize",
            "SageMaker Ground Truth",
            "Braket",
        ],
    ),
    (
        "Databases",
        [
            "Aurora DSQL",
            "DocumentDB",
            "Keyspaces",
            "MemoryDB",
            "DynamoDB Accelerator (DAX)",
            "RDS Custom for Oracle",
            "RDS Custom for SQL Server",
            "Oracle Database@AWS",
        ],
    ),
    (
        "Developer Tools",
        [
            "CodePipeline",
            "CodeArtifact",
            "CodeCommit",
            "CloudShell",
            "DevOps Agent",
            "Signer",
            "Fault Injection Service",
        ],
    ),
    (
        "Compute & Hosting",
        [
            "Amplify",
            "App Runner",
            "Lightsail",
            "GameLift",
            "Elastic VMware Service",
            "Outposts",
            "S3 on Outposts",
        ],
    ),
    (
        "Analytics & Integration",
        [
            "AppSync",
            "AppFlow",
            "DataZone",
            "B2B Data Interchange",
            "Managed Grafana",
            "Managed Prometheus",
            "Managed Airflow (MWAA)",
            "QuickSight",
        ],
    ),
    (
        "Media",
        [
            "MediaConnect",
            "MediaConvert",
            "MediaLive",
            "MediaPackage",
            "MediaTailor",
            "Interactive Video (IVS)",
            "Kinesis Video Streams",
            "Chime SDK",
        ],
    ),
    (
        "IoT",
        [
            "IoT Core",
            "IoT Device Management",
            "IoT Device Defender",
            "IoT Greengrass",
            "IoT SiteWise",
        ],
    ),
    (
        "Security & Identity",
        [
            "Inspector",
            "Detective",
            "Security Lake",
            "Shield Advanced",
            "Audit Manager",
            "Payment Cryptography",
            "Verified Access",
            "Wickr",
        ],
    ),
    (
        "Networking & Other",
        [
            "Client VPN",
            "VPC Lattice",
            "Ground Station",
            "Elastic Disaster Recovery",
            "Resilience Hub",
            "Deadline Cloud",
            "Location Service",
            "Managed Blockchain",
            "Connect (contact centre)",
            "WorkSpaces",
            "WorkSpaces Applications",
        ],
    ),
]

# Balance into 3 columns of roughly equal height.
COLUMNS = [
    ["AI / Machine Learning", "Developer Tools", "Compute & Hosting"],
    ["Networking & Other", "Databases", "IoT"],
    ["Media", "Security & Identity", "Analytics & Integration"],
]

total = sum(len(s) for _, s in CATEGORIES)
cat_map = dict(CATEGORIES)

styles = getSampleStyleSheet()
NAVY = colors.HexColor("#1a3d6e")
h1 = ParagraphStyle(
    "h1", parent=styles["Title"], fontSize=19, spaceAfter=2, textColor=NAVY
)
sub = ParagraphStyle(
    "sub",
    parent=styles["Normal"],
    fontSize=9,
    textColor=colors.HexColor("#666666"),
    spaceAfter=2,
)
cat = ParagraphStyle(
    "cat",
    parent=styles["Normal"],
    fontSize=11,
    textColor=NAVY,
    fontName="Helvetica-Bold",
    spaceBefore=8,
    spaceAfter=3,
)
item = ParagraphStyle(
    "item",
    parent=styles["Normal"],
    fontSize=9.5,
    leading=14,
    textColor=colors.HexColor("#222222"),
)
foot = ParagraphStyle(
    "foot",
    parent=styles["Normal"],
    fontSize=8,
    textColor=colors.HexColor("#888888"),
    leading=11,
    spaceBefore=10,
)


def col_flowables(cat_names):
    flow = []
    for name in cat_names:
        flow.append(Paragraph(name, cat))
        for svc in cat_map[name]:
            s = svc.replace("&", "&amp;")
            flow.append(
                Paragraph(f'<font color="#9bb0cc">•</font>&nbsp;&nbsp;{s}', item)
            )
    return flow


story = [
    Paragraph("AWS New Zealand — Services Not Yet Available", h1),
    Paragraph(
        "Asia Pacific (Auckland) &middot; region <b>ap-southeast-6</b> "
        f"&middot; {total} services &middot; June 2026",
        sub,
    ),
    Spacer(1, 6),
]

grid = Table(
    [[col_flowables(COLUMNS[0]), col_flowables(COLUMNS[1]), col_flowables(COLUMNS[2])]],
    colWidths=[60 * mm, 60 * mm, 60 * mm],
)
grid.setStyle(
    TableStyle(
        [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
        ]
    )
)
story.append(grid)

story.append(
    Paragraph(
        "No public ETAs &mdash; AWS does not publish per-service launch dates for a region; "
        "availability is announced only after the fact. The region is filling in steadily "
        "(several services per month), so treat each as &ldquo;not yet&rdquo; rather than "
        "&ldquo;never.&rdquo; Verify live in the AWS Capabilities by Region tool before relying on any one service.",
        foot,
    )
)

SimpleDocTemplate(
    OUT,
    pagesize=A4,
    leftMargin=15 * mm,
    rightMargin=15 * mm,
    topMargin=15 * mm,
    bottomMargin=14 * mm,
    title="AWS New Zealand — Services Not Yet Available",
).build(story)
print("WROTE", OUT)

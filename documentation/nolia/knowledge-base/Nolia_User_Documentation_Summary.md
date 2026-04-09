# Nolia User Documentation Summary

**Last Updated:** 09 February 2026

## What is Nolia?

Nolia is an AI-powered procurement management platform designed for implementing agencies working with Multilateral Development Banks (MDBs). It streamlines document creation, validation, and vendor response assessment by leveraging Knowledge Bases containing policies, guidelines, templates, and project-specific information.

---

## Core Capabilities

### 1. **Knowledge Base Management** (Section 3)

The foundation of Nolia's intelligence. Three types of Knowledge Bases work together:

- **Global KBs**: Document-type-specific policies and standards (e.g., TER guidelines, ToR for Goods, CER standards). Based on MDB requirements from organizations like World Bank or Asian Development Bank.
- **Project KBs**: Project-specific documentation (e.g., Indonesia Health Systems Strengthening Project, including appraisal docs, procurement plans, ESC plans).
- **Procurement Activity KBs**: Activity-specific details (e.g., Cathlab equipment procurement, including business case, requirements, budget, RFx documents, rubrics).

**Knowledge Base Pairing**: Different tasks require different KB combinations:

- TER/CER Validation: Global KB + Procurement Activity KB
- ToR Validation: Global KB + Project KB
- Vendor Assessment: Global KB + Procurement Activity KB

---

### 2. **Document Creation** (Section 4)

AI-powered generation of procurement documents including:

- Terms of Reference (ToR) for Goods, Works, Consulting Services, Individual Contractors
- Requests for Quotation (RFQ)
- Requests for Bid/Proposal (RFB/RFP)
- Expression of Interest documents

---

### 3. **Document Validation** (Section 5)

Upload and validate critical procurement documents such as:

- **Technical Evaluation Reports (TERs)**
- **Combined Evaluation Reports (CERs)**
- Terms of Reference
- RFx documents

Nolia checks compliance against relevant Knowledge Bases and provides detailed validation reports highlighting issues, recommendations, and compliance gaps.

---

### 4. **Vendor Response Assessment** (Section 6)

Evaluate vendor responses to procurement activities in two phases:

- **Technical Evaluation**: Assess technical merit and compliance
- **Combined Evaluation**: Technical + Financial assessment

Features include individual assessment reports, scoring, and side-by-side comparison of multiple vendor responses.

---

## User Roles & Permissions (Section 2)

**Super Admin**: First account created; full access to all features; cannot be deleted.

**Admin**: Same privileges as Super Admin; can create/manage users and access all sections; can be deleted.

**Operator**: Limited access to Dashboard, Validate Documents, and own profile; cannot access Knowledge Bases or User Management.

---

## Navigation & Dashboard (Section 1)

**Main Navigation**:

- Dashboard: Home page with analytics, KB cards, usage metrics, quick access
- Knowledge Bases: Manage Global, Project, and Procurement Activity KBs
- Create Documents: Access document templates
- Procure: Evaluate and compare vendor responses
- Validate Documents: Upload and validate TERs, CERs, and other docs
- Analytics: View metrics and query data
- User Management: Manage user accounts and permissions (Admin only)

**Dashboard Features**:

- Analytics chart showing Documents Verified, Knowledge Bases, Responses Evaluated (12-month view)
- KB summary cards (Global, Project, Procurement Activity)
- Usage tracking (AI token usage vs monthly allocation)
- Quick access cards for common tasks

---

## Key Workflows

### Creating a Knowledge Base

1. **Global KB** (2-step): Basic info + documents → Output templates
2. **Project KB** (1-step): Project details + documentation
3. **Procurement Activity KB** (3-step): Pre-RFx docs → RFx document → Supporting docs

_Processing time: 20-30 minutes_

### Validating a Document

1. Upload document (TER, CER, ToR, or RFx)
2. Select relevant Knowledge Bases (pairing depends on document type)
3. Review validation report with compliance checks, issues, and recommendations
4. Download report or take corrective action

### Assessing Vendor Responses

1. Navigate to Procure section
2. Select Procurement Activity
3. Upload vendor response documents
4. Choose evaluation phase (Technical or Combined)
5. Review individual assessment reports and scores
6. Compare multiple responses side-by-side

---

## Important Notes

- **Knowledge Base Status**: Processing → Complete → Active (ready to use)
- **Active KBs Only**: Only active KBs appear in dropdowns for validation/assessment
- **Priority Rule**: When conflicts exist, Procurement Activity/Project KBs take priority over Global KBs (more specific = higher priority)
- **File Limits**: Up to 10MB per file; PDF, DOC, DOCX, XLS, XLSX accepted
- **Usage Monitoring**: Track AI token usage to avoid exceeding monthly allocation

---

## Support Resources

- User Documentation: Access via profile menu
- Contact support if usage limits are approaching
- Verification required for new user invitations

---

_This summary covers Sections 1-7 of the full Nolia User Guide for Implementing Agencies._

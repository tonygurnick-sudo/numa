ELIGIBILITY_ASSESSMENT_PROMPT = """
# RFP Eligibility Assessment

You are a professional procurement assessor evaluating RFP submissions according to eligibility requirements.

## Task
Carefully assess the application against the eligibility and 'do not want' criteria in the RFP reference document.

## Application Document
{application_content}

## RFP Reference Document
{rfp_reference_content}

## Assessment Instructions
{assessment_instructions}

## Output Requirements
Your output must be well-formatted markdown with:

1. A clear, professional heading: "# Eligibility Assessment"
2. A brief introduction explaining the purpose of this assessment (2-3 sentences)
3. A comprehensive eligibility criteria table:

```markdown
| Eligibility Criteria | Status | Detailed Justification |
|----------------------|--------|------------------------|
| [Criterion 1]        | Met/Not Met | [Clear explanation with specific evidence from application] |
| [Criterion 2]        | Met/Not Met | [Clear explanation with specific evidence from application] |
```

4. A 'Do Not Want' criteria table (if any such criteria exist):

```markdown
| 'Do Not Want' Criteria | Status | Detailed Justification |
|------------------------|--------|------------------------|
| [Criterion 1]          | Present/Not Present | [Clear explanation with specific evidence from application] |
| [Criterion 2]          | Present/Not Present | [Clear explanation with specific evidence from application] |
```

5. A clear recommendation section with:
   - Bold heading: "## Recommendation"
   - A clear verdict: "**ELIGIBLE**" or "**NOT ELIGIBLE**"
   - A concise justification (3-5 sentences)

6. Ensure all judgments are evidence-based, citing specific details from the application document.

## Markdown Formatting Guidelines:

- Use structured hierarchical headings:
  - `# Main Title` for the assessment document title
  - `## Section Headings` for major sections
  - `### Subsection Headings` for subsections
  - `#### Minor Headings` for smaller content blocks

- Use proper formatting elements:
  - **Bold text** for emphasis on important findings or key points
  - *Italic text* for secondary emphasis or specialized terms
  - `code formatting` for specific policy sections or technical requirements
  - > Blockquotes to highlight direct quotes from RFP documents

- Use structured lists consistently:
  - Use bullet points with `-` for unordered lists
  - Use numbered lists (1., 2., 3.) for sequential items or priorities
  - Maintain consistent indentation for nested lists

- Use tables for organized data presentation:
  | Column 1 | Column 2 | Column 3 |
  |----------|----------|----------|
  | Data     | Data     | Data     |
  - Ensure proper alignment with consistent column widths
  - Include header rows for all tables

- Use formatting for specific elements:
  - [⚠️ RISK] indicators for procurement risks or concerns
  - [✓ COMPLIANCE] markers for compliant elements
  - [❌ NON-COMPLIANCE] indicators for non-compliant elements
  - [⭐ HIGHLIGHT] for standout features or opportunities

- Document structure:
  - Create visually structured documents with clear section separation
  - Use horizontal rules (---) to separate major document sections
  - Follow a consistent formatting pattern throughout
  - Maintain a professional, readable layout

Do not include any introductory text like "Here is my assessment" - start directly with the assessment content.
"""

RFP_ASSESSMENT_PROMPT = """
# RFP Submission Assessment

You are a thorough procurement assessor evaluating RFP submissions against complex criteria.

## Documents
### Application Document
{application_content}

### RFP Reference Document
{rfp_reference_content}

### Eligibility Assessment
{eligibility_assessment}

### Assessment Instructions
{assessment_instructions}

## Task
Conduct a comprehensive assessment of the application against all evaluation criteria in the RFP reference document. The application has already passed the eligibility screening.

Focus on accuracy and thoroughness. Your assessment will influence procurement decisions with significant financial and organizational impact.

## Output Format
Your output must be well-structured markdown following this exact format:

```markdown
# RFP Assessment Report

## Executive Summary
[2-3 sentences summarizing the application and overall assessment]

## Evaluation Criteria Assessment

| Criteria | Score | Weight | Weighted Score | Justification |
|----------|-------|--------|---------------|---------------|
| [Criterion 1] | [X/10] | [Y%] | [Calculated] | [Evidence-based justification] |
| [Criterion 2] | [X/10] | [Y%] | [Calculated] | [Evidence-based justification] |
| **TOTAL** | | **100%** | **[Total Score]/10** | |

## Key Strengths
- [Specific strength with evidence]
- [Specific strength with evidence]
- [Specific strength with evidence]

## Areas of Concern
- [Specific concern with evidence]
- [Specific concern with evidence]
- [Specific concern with evidence]

## Clarification Questions
- [Specific question that would help evaluate the application]
- [Specific question that would help evaluate the application]
- [Specific question that would help evaluate the application]

## Recommendation
**[RECOMMENDED / RECOMMENDED WITH RESERVATIONS / NOT RECOMMENDED]**

[3-5 sentences explaining the recommendation, supported by evidence from the assessment]
```

## Markdown Formatting Guidelines:

- Use structured hierarchical headings:
  - `# Main Title` for the assessment document title
  - `## Section Headings` for major sections
  - `### Subsection Headings` for subsections
  - `#### Minor Headings` for smaller content blocks

- Use proper formatting elements:
  - **Bold text** for emphasis on important findings or key points
  - *Italic text* for secondary emphasis or specialized terms
  - `code formatting` for specific policy sections or technical requirements
  - > Blockquotes to highlight direct quotes from RFP documents

- Use structured lists consistently:
  - Use bullet points with `-` for unordered lists
  - Use numbered lists (1., 2., 3.) for sequential items or priorities
  - Maintain consistent indentation for nested lists

- Use tables for organized data presentation:
  | Column 1 | Column 2 | Column 3 |
  |----------|----------|----------|
  | Data     | Data     | Data     |
  - Ensure proper alignment with consistent column widths
  - Include header rows for all tables

- Use formatting for specific elements:
  - [⚠️ RISK] indicators for procurement risks or concerns
  - [✓ COMPLIANCE] markers for compliant elements
  - [❌ NON-COMPLIANCE] indicators for non-compliant elements
  - [⭐ HIGHLIGHT] for standout features or opportunities

- Document structure:
  - Create visually structured documents with clear section separation
  - Use horizontal rules (---) to separate major document sections
  - Follow a consistent formatting pattern throughout
  - Maintain a professional, readable layout

- Special formatting:
  - Use ```diff formatting for showing changes or comparisons:
    ```diff
    - Original text or requirements
    + Suggested improvements or modifications
    ```
  - Use [square brackets and italics] for inline explanations or notes
  - Use indented paragraphs (three spaces) for detailed explanations

Do not include any introductory text - start directly with the assessment content following this markdown structure.
"""

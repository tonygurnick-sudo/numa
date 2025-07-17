# Core prompt for the ToR assessment (Output 1)
TOR_ASSESSMENT_PROMPT = """# Terms of Reference (ToR) Assessment Task

Please act as an expert assessor for Terms of Reference documents. You are assessing the document contained in the ToR Document section using the assessment template provided. Strictly use the template in Assessment Template as the output format.

## ToR Document
```
{document_content}
```

## Assessment Template
```
{assessment_template}
```

## Markdown Formatting Guidelines:
- Start directly with the template structure provided in Assessment Template
- Maintain all headings, sections, and tables exactly as shown in the template
- Use **bold** for emphasis on important findings, requirements, or decisions
- Use `code formatting` for specific sections being referenced
- Use > blockquotes to highlight direct quotes from the ToR document
- Use proper table formatting with | characters and header rows for all tables
- Use bullet points with - for listing multiple items within a section
- Create a visually structured document with clear section separation
- Ensure tables are aligned properly with consistent column widths
- When filling fields with [bracketed placeholders], replace them entirely with your assessment content

As you assess the ToR document:
1. Be thorough and detailed in your evaluation
2. Provide evidence from the ToR document to support your assessment
3. Be objective and balanced in your evaluation
4. Make specific, actionable recommendations
5. Follow the Assessment Template format exactly
6. Check each element against best practices for ToR documents

Do not add any introduction or summary outside the template structure - start directly with the Terms of Reference (ToR) Assessment Template format.
"""

# Core prompt for the ToR suggestions (Output 2)
TOR_SUGGESTIONS_PROMPT = """# Terms of Reference (ToR) Suggested Changes Task

Please act as an expert consultant for Terms of Reference documents. You are reviewing the document and the assessment findings to provide specific suggested changes.

Your task is to identify areas for improvement based on the assessment findings and provide specific, actionable suggestions in **bold** format. Do not rewrite the entire document - only highlight the suggested changes based on the assessment.

## ToR Document
```
{document_content}
```

## Assessment Findings
```
{assessment_findings}
```

## Suggestions Template
```
{suggestions_template}
```

## Guidelines for Suggestions:
- Base all suggestions on the specific findings from the Assessment Findings section
- Use the exact template structure provided in Suggestions Template
- Use proper markdown table formatting with clear structure
- Only include rows for sections where the assessment identified issues
- Create one comprehensive table with all suggested changes

## Table Column Requirements:
- **Section Column**: Use the exact section name or field name from the ToR (e.g., "Duration", "Background", "Selection Criteria")
- **Suggested Change Column**: Brief description of what needs to be changed/added in **bold** format
- **Proposed Change Column**: Exact text that can be copied and pasted, OR example in brackets if specific value is unknown

## Proposed Change Column Guidelines:
- If you know the exact content needed, provide the complete text ready to copy/paste
- If you don't know the specific value, provide an example in brackets like [12 months], [January 2025], [example@email.com]
- For missing sections, provide the complete section structure with example content
- For unclear text, provide the improved version ready to use
- Make all content actionable and ready to implement

## Markdown Formatting Requirements:
- Use # for main heading: "Terms of Reference Suggested Changes"
- Use ## for section headings: "Suggested Changes", "Summary"
- Use proper markdown table formatting with | separators
- Use **bold** for all text in the "Suggested Change" column
- Add --- horizontal rule between main table and summary
- Keep table columns aligned and properly formatted
- Use 📋 emoji for summary section

As you create suggestions:
1. Review the "Areas for Improvement" section from the assessment
2. Review the "Recommendations" section from the assessment
3. Address any elements marked as ❌ in the assessment
4. For each identified issue, create one table row with:
   - Section name (exact from ToR)
   - Brief description of change needed (in bold)
   - Exact text to implement OR example in brackets
5. Fill in the Summary table with actual counts of changes needed

Do not add any introduction or summary outside the template structure - start directly with the "# Terms of Reference Suggested Changes" heading.
"""

# Assessment template structure (Output 1)
TOR_ASSESSMENT_TEMPLATE = """Terms of Reference (ToR) Assessment Template
TOR Assessment for: [Job Title]
1. Structure and Content Assessment
2. Compliance & Clarity Check
Element Status Comments
Project Background ✅ / ❌[input]
Position Title ✅ / ❌[input]
Location ✅ / ❌[input]
Duration ✅ / ❌[input]
Expected Start Date ✅ / ❌[input]
Reporting Arrangements ✅ / ❌[input]
Job Objectives ✅ / ❌[input]
Key Tasks and Responsibilities ✅ / ❌[input]
Qualifications and Experience ✅ / ❌[input]
Selection Criteria — Mandatory ✅ / ❌[input]
Selection Criteria — Desirable ✅ / ❌[input]
Skills and Competencies ✅ / ❌[input]
Reporting Requirements ✅ / ❌[input]
Application Process ✅ / ❌[input]
Deadline for Expressions of Interest ✅ / ❌[input]
Guideline Compliant Comments
Clear and specific job description [Y/N] [input]
Realistic qualifications [Y/N] [input]
Non-discriminatory language [Y/N] [input]
Transparent selection criteria [Y/N] [input]
Alignment with project objectives [Y/N] [input]
Page  of 1 5
Official Use Only
3. Quality Assessment
4. Key Strengths
●XXX
●XXX
●XXX
5. Areas for Improvement
●XXX
●XXX
●XXX
6. Recommendations
1. XXX
2. XXX
3. XXX
7. Conclusion
XXX
8. References
1. XXX
2. XXX
3. XXX"""

# Suggestions template structure (Output 2)
TOR_SUGGESTIONS_TEMPLATE = """# Terms of Reference Suggested Changes

## Suggested Changes

| Section | Suggested Change | Proposed Change |
|---------|------------------|-----------------|
| [Section Name] | **[Brief description of what needs to be changed/added]** | [Exact text/content that can be copied and pasted, or example in brackets like [12 months] if specific value unknown] |
| [Section Name] | **[Brief description of what needs to be changed/added]** | [Exact text/content that can be copied and pasted, or example in brackets like [12 months] if specific value unknown] |
| [Section Name] | **[Brief description of what needs to be changed/added]** | [Exact text/content that can be copied and pasted, or example in brackets like [12 months] if specific value unknown] |

---

## Summary

| 📋 CHANGES SUMMARY |
|:------------------:|
| **[X] total changes required** |
| **[X] missing elements to add** |
| **[X] existing sections to improve** |"""

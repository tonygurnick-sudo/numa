INITIAL_ANALYSIS_PROMPT = """You are an expert at understanding policy documents and running an initial analysis to understand the context of a document.

Here is a policy document uploaded by our user:
{policy_content}

Based on the keywords, structure, content and additional context here:
{policy_context}

## Markdown Formatting Guidelines:
- Use `# Title` for the document title
- Use `## Classification` for the classification section
- Use `## Description` for the description section
- Use `## Considerations for Review` for the considerations section
- Use bullet points with `-` for listing multiple items under each section

Please analyze the document and return the following in markdown format:
- Title
- Classification
- Description
- Considerations for review"""

POLICY_REVIEW_PROMPT = """You are an expert at reviewing policy documents.

Here is a policy document:
{policy_content}

Our team has also provided following for your consideration when reviewing the document:
Classification and description:
{initial_analysis}

Review the policy document and provide a detailed analysis and recommendations in markdown format.

## Markdown Formatting Guidelines:
- Use `# Policy Review` as the main title
- Use `## Analysis` for the analysis section
- Use `### Key Points and Objectives` for the first analysis subsection
- Use `### Clarity and Comprehensiveness` for the second analysis subsection
- Use `### Gaps and Areas for Improvement` for the third analysis subsection
- Use `## Recommendations` for the recommendations section
- Use `## Legislative Compliance and Recommendations` for the legislative section (if applicable)
- Use bullet points with `-` for listing multiple items under each section
- Use blockquotes with `>` for referencing specific policy text
- Use **bold** for emphasis on important points

Your review should cover:

## Analysis:
1. Summary of the key points and objectives of the policy
2. Evaluation of the clarity, comprehensiveness and enforceability of the policy
3. Identification of any potential gaps, ambiguities or areas that need improvement

## Recommendations:
A list of specific recommendations for enhancing or revising the policy to make it more effective

## Legislative Compliance and Recommendations (if applicable):
The user may have also uploaded relevant legislation to review against here as well:
{legislation_content}

If legislation is provided, please review the policy document and give feedback on:
- Compliance: Does the policy comply with all relevant legal obligations and legislative requirements?
- Recommendations: Are there any recommendations for improving or strengthening the policy to ensure legal compliance?

Please highlight specific sections of the policy document where necessary. If not legislation is provided to review against the policy, state 'Not Applicable'."""

RECOMMENDED_UPDATES_PROMPT = """Here is a policy document:
{policy_content}

Here is a review of the policy that contains the recommended changes for enhancement:
{policy_review}

## Markdown Formatting Guidelines:
- Use `# Recommended Policy Updates` as the main title
- Use `## General Updates` for the main updates section
- Use `## Legislative Compliance Updates` for the legislative-specific updates (if applicable)
- Use numbered lists (`1.`, `2.`, etc.) for each distinct update recommendation
- Use **bold** to highlight section names being referenced
- Use `>` for quoting existing policy text
- Use `**CURRENT:**` and `**PROPOSED:**` to clearly differentiate current vs. recommended text

Based on the recommended changes from the policy review, please generate specific updates for the policy document. For each update:
1. Specify which section to update or if creating a new section
2. Provide the current text (when applicable)
3. Provide the recommended new/modified text
4. Include a brief explanation for the change

Please don't re-generate the entire policy, but instead output a structured list of specific updates. If Legislative Compliance recommendations are provided, present these as a separate section."""

UPDATED_POLICY_PROMPT = """You are an expert policy writer specializing in policy revision and documentation.

Below is the current policy document:
{policy_content}

Our review team has provided these recommended updates:
{recommended_updates}

## Markdown Formatting Guidelines:
- Maintain the original document's heading hierarchy using markdown syntax:
  - `# ` for main titles
  - `## ` for section headings
  - `### ` for subsection headings
  - `#### ` for further subsections
- Use **bold** for emphasis and important terms
- Use *italics* for definitions or citations
- Use bullet points with `-` for lists
- Use numbered lists (`1.`, `2.`, etc.) for sequential steps or prioritized items
- Use tables with pipe syntax `|` for tabular data
- Use blockquotes with `>` for special notes or callouts
- Maintain proper indentation for nested lists and content

Please generate a complete, revised version of the policy that incorporates all recommended changes. The updated policy should:

1. Include ALL sections of the original policy (even unchanged sections)
2. Seamlessly integrate the recommended updates into the appropriate sections
3. Maintain consistent tone, formatting, and organizational structure throughout
4. Be formatted in clean, well-structured markdown
5. Preserve the document's original section numbering and hierarchy
6. Ensure all hyperlinks, references, and cross-references remain functional

Return the complete, revised policy as a single markdown document that could immediately replace the original.
"""

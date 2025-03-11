CLAUSE_IDENTIFICATION_PROMPT = """You are an expert in contract analysis with deep knowledge of legal clauses and contract structures.

Here is a contract document uploaded by our user:
{contract_content}

## Task:
Identify and classify all key clauses in this contract. Focus on standard and non-standard clauses that are important for understanding the contract's terms, obligations, and potential risks.

## Markdown Formatting Guidelines:
- Use `# Contract Clause Identification` as the main title
- Use `## Identified Clauses` as the section heading
- For each clause:
  - Use `### [Clause Type]` as the subheading (e.g., "### Indemnification Clause")
  - Use blockquotes with `>` to quote the exact text of the clause from the contract
  - Below each quoted clause, provide a brief description of the clause's purpose
  - Use bullet points with `-` for listing any notable features of the clause
- Use **bold** for emphasis on important parts within clauses

Your output should be well-structured, highlighting each identified clause clearly with its accompanying explanation. Be comprehensive in identifying all relevant clauses.

Do not include any introductory text - start directly with the markdown content.
"""

HIGHLIGHTING_EXPLANATION_PROMPT = """You are an expert in contract analysis with the ability to explain complex legal concepts in simple terms.

Here is a contract document:
{contract_content}

I've also identified the key clauses in this contract:
{identified_clauses}

## Task:
Create an annotated version of this contract with inline explanations of important terms and clauses. Your goal is to make this contract understandable to non-legal professionals.

## Markdown Formatting Guidelines:
- Start with the full contract text
- For each important term or clause:
  - Wrap the term or clause in **bold** text
  - Immediately after each bolded term, add an explanation in [square brackets and italics], like: **term** [*explanation in simple language*]
- For longer clauses that need explanation:
  - Place the entire clause in a blockquote using `>`
  - Follow the blockquote with an explanation indented using `   *` (three spaces followed by an asterisk)
- Use headings (`##`, `###`) to maintain the original document structure
- Include a "Key Terms Glossary" section at the end with definitions of recurring terms

Your output should maintain the flow and structure of the original contract while adding helpful explanations that a non-lawyer would understand.

Do not include any introductory text - start directly with the annotated contract.
"""

RISK_ASSESSMENT_PROMPT = """You are an expert in contract risk assessment with deep knowledge of legal risks, compliance issues, and business implications.

Here is a contract document:
{contract_content}

I've also identified and explained the key clauses in this contract:
{highlighted_explanations}

## Task:
Perform a comprehensive risk assessment of this contract. Create a document with two main parts:
1. Risk annotations integrated directly into the contract text
2. A risk scoring table summarizing all identified risks

## Markdown Formatting Guidelines:

For the risk annotations section:
- Start with the heading `# Contract with Risk Annotations`
- Include the full contract text
- For each identified risk:
  - Place a risk indicator immediately after the problematic text: [⚠️ RISK]
  - Follow this with an explanation of the risk in [*italicized square brackets*]
  - Use different risk indicators based on severity:
    - [⚠️ RISK] - Medium risk
    - [🔴 HIGH RISK] - High risk
    - [⚠️ COMPLIANCE ISSUE] - Potential compliance problem
    - [⚠️ VAGUE LANGUAGE] - Ambiguous terms that create uncertainty

For the risk scoring table:
- After the annotated contract, add a horizontal rule `---`
- Use `# Risk Assessment Summary` as the section heading
- Create a markdown table with these columns:
  | Section/Clause | Risk Description | Risk Category | Severity (1-10) | Potential Impact | Mitigation Suggestion |
- For each risk previously identified in the document, create a row in this table
- Sort risks by severity score (highest to lowest)
- Use severity scores where:
  - 1-3: Low risk that should be noted but unlikely to cause issues
  - 4-6: Medium risk that should be addressed during negotiation
  - 7-8: High risk that requires significant revision
  - 9-10: Critical risk that could make the contract unacceptable

Your risk assessment should be thorough but focused on genuinely significant issues. Don't flag standard or appropriate clauses as risky without good reason.

Do not include any introductory text before the annotated contract.
"""

IMPROVEMENT_SUGGESTIONS_PROMPT = """You are an expert contract negotiator with deep knowledge of industry standards and best practices within Oceania.

Here is the original contract:
{contract_content}

Here is a comprehensive risk assessment of the contract:
{risk_assessment}

## Task:
Generate a revised version of this contract with specific text suggestions addressing the identified risks and improving terms to reflect current market standards. Create a document that shows the original text alongside proposed changes and explanations.

## Markdown Formatting Guidelines:
- Use `# Contract Improvement Suggestions` as the main title
- For each proposed change:
  - Use `## Change [number]: [Brief description]` as a section heading
  - Use a markdown diff-style format to show changes:
    ```diff
    - Original text that should be removed or modified
    + Suggested new text to replace it
    ```
  - Below each diff, provide a brief explanation labeled as `Rationale: [explanation for the change]`
  - If the change addresses a specific risk, include `Addresses Risk: [risk description from the scoring table]`
- After all specific changes, include a `## Summary of Improvements` section that explains the overall impact of these changes
- Use bold and italics for emphasis where appropriate

Your suggestions should be practical, balanced, and aligned with current market standards. Focus on meaningful improvements that address the highest-priority risks while maintaining the basic structure and intent of the agreement.

Do not include any introductory text - start directly with the markdown content.
"""

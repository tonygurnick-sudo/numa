DOCUMENT_SUMMARY_PROMPT = """Summarize the document(s) based on the following requirements:

- Highlight key points and details while tailoring the summary to the document type and user's needs specified in {focus_area}.
- Identify and summarize key themes, sections, or topics.
- Extract critical information such as dates, names, numerical data, or actions where applicable.
- Provide an overview in concise bullet points and/or a short narrative paragraph.
- If the documents are specialized (e.g. financial reports, legal contracts), adapt the format and tone to industry norms.
- The desired level of detail is {summary_level}.

## Formatting Guidelines:
- Use **one `#` title header** for the document title (e.g., `# Financial Report Summary`).
- Use `##` for major sections (e.g., `## Key Findings`, `## Compliance Analysis`).
- Use `###` for specific areas within sections.
- Use `-` for bullet points summarising key information.
- Use `>` for direct quotes from the document.
- Use tables where applicable for comparing current vs. recommended content.

Document content:
{document_content}

Return the summary following these markdown conventions to ensure clarity and structured presentation."""

DOCUMENT_SUMMARY_PROMPT = """Summarize the document(s) based on the following requirements:

- Highlight key points and details while tailoring the summary to the document type and user's needs specified in {focus_area}.
- Identify and summarize key themes, sections, or topics.
- Extract critical information such as dates, names, numerical data, or actions where applicable.
- Provide an overview in concise bullet points and/or a short narrative paragraph.
- If the documents are specialized (e.g. financial reports, legal contracts), adapt the format and tone to industry norms.
- The desired level of detail is {summary_level}.

## Markdown Formatting Guidelines:

Follow this exact header hierarchy:

1. Then `### [Document Title] Summary`
2. Then `#### [Main Section]` (e.g., Key Points and Details)
3. Then `##### [Subsection]` (e.g., Introduction)
-  Use `-` for bullet points under each section
-  Use `>` for direct quotes from the document
-  Use tables where applicable for comparing content

Document content:
{document_content}

Return the summary following these markdown conventions to ensure clarity and structured presentation."""

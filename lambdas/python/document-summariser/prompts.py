DOCUMENT_SUMMARY_PROMPT = """Summarize the document(s) based on the following requirements:

- Highlight key points and details while tailoring the summary to the document type and user's needs specified in {focus_area}.
- Identify and summarize key themes, sections, or topics.
- Extract critical information such as dates, names, numerical data, or actions where applicable.
- Provide an overview in concise bullet points and/or a short narrative paragraph.
- If the documents are specialized (e.g. financial reports, legal contracts), adapt the format and tone to industry norms.
- The desired level of detail is {summary_level}.

Document content:
{document_content}

Present the summary in markdown format for a clear, structured output suitable for quick review."""

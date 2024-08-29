requirement_enrichment_prompt = """As part of a workflow we want to make sure that documents are complete buy checking it contains a list of requirements. You are an expert at taking these raw requirements for checking a set of documents completeness, and enriching them with additional context and clarity.
-----------------------------------
Here are summaries of the documents that you can use as context when enriching the requirements:
{doc_summaries}
-----------------------------------
Here are the users raw requirements that they want to use to check the completness of the documents:
{requirements}
-----------------------------------
Please enrich the requirements for document completeness with additional context and clarity, so that it is easier for our team to check the completeness of the documents.
Enriched Requirements:
"""  # noqa: E501

document_summary_prompt = """Here is either all or the start of a document. Please concisely summarise the contents and context of the document.
{document_text}
Summary:"""  # noqa: E501

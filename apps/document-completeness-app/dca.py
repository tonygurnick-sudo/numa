from dataclasses import dataclass
from typing import Any, List, Tuple, TypedDict

import structlog
from claude_tools import requirement_enrichment_tools
from prompts import document_summary_prompt, requirement_enrichment_prompt
from services.bedrock import BedrockClaude3Model

logger = structlog.get_logger(__name__)


@dataclass
class ModelMetadata:
    input_tokens: int
    output_tokens: int


@dataclass
class DocumentPage:
    page_number: int = 0
    num_words: int = 0
    text: str = ""


@dataclass
class Document:
    name: str = ""
    num_pages: int = 0
    total_num_words: int = 0
    text: List[DocumentPage] = []
    summary: str = ""


class Requirements(TypedDict):
    """
    A dictionary type for requirements.

    Fields:
    - requirement_name: str
    - requirement_description: str
    """

    requirement_name: str
    requirement_description: str


def run_model(
    model: BedrockClaude3Model, prompt: str
) -> Tuple[Any | None, ModelMetadata]:
    """Run the LLM model with the given document and prompt. Return values even if model fails."""
    try:
        response = model.run(query=prompt)
    except Exception:
        logger.exception(f"Error running llm extraction for prompt: {prompt}")
        result = None
        metadata = ModelMetadata(input_tokens=0, output_tokens=0)
        return result, metadata

    result = response.response[0]

    if "input" in result:
        logger.info("Model tool response found:", result=result["input"])
        final_result = result["input"]
    elif "text" in result:
        logger.info("Model text response found:", result=result["text"])
        final_result = result["text"]
    else:
        raise ValueError("Unexpected response format from LLM model.")
    requirements_metadata = ModelMetadata(
        input_tokens=response.metadata.get("input_tokens", 0),
        output_tokens=response.metadata.get("output_tokens", 0),
    )
    return final_result, requirements_metadata


def document_summary_agent(documents: List[Document]) -> List[Document]:
    """Get a summary of the document using up to the first 3 pages."""
    text_first_3_pages = ""
    for doc in documents:
        try:
            for page in doc.text[:3]:
                text_first_3_pages += page.text + " "
            model = BedrockClaude3Model()
            prompt = document_summary_prompt.format(document_text=text_first_3_pages)
            summary_result, summary_metadata = run_model(model, prompt)
            logger.info(
                "Bedrock Usage - Summary:",
                input_tokens=summary_metadata.input_tokens,
                output_tokens=summary_metadata.output_tokens,
            )
            doc.summary = summary_result if summary_result else ""
        except Exception:
            logger.exception("Error summarizing document", document=doc.name)
            doc.summary = ""
    return documents


def requirement_enrichment(
    requirements_raw: str, documents: List[Document]
) -> List[Requirements]:
    """
    Uses an LLM to enrich the raw requirements text by adding additional context.
    """
    # Get summaries from documents
    doc_summaries = "\n\n".join([doc.summary for doc in documents])
    # TODO: figure out how many documents to include in the prompt if we have many many docs.
    model_args = {
        "tools": requirement_enrichment_tools,
        "tool_choice": {"type": "tool", "name": "print_requirements"},
        "max_tokens": 4096,
    }
    model = BedrockClaude3Model(model_args=model_args)
    prompt = requirement_enrichment_prompt.format(
        doc_summaries=doc_summaries, requirements=requirements_raw
    )
    requirements_result, requirements_metadata = run_model(model, prompt)
    logger.info(
        "Bedrock Usage - Requirements:",
        input_tokens=requirements_metadata.input_tokens,
        output_tokens=requirements_metadata.output_tokens,
    )

    # Assumes claude tool usage was successful
    enriched_requirements = (
        requirements_result.get("requirements", []) if requirements_result else []
    )

    return enriched_requirements


def document_completeness_agent(extracted_text: str) -> str:
    """
    Simulated Document Completeness Agent (DCA).
    This function performs a basic gap analysis on the extracted text.
    """
    requirements = ["Requirement 1", "Requirement 2", "Requirement 3"]
    gaps = []

    # Simulate gap analysis by checking if the requirements are mentioned in the extracted text
    for req in requirements:
        if req.lower() not in extracted_text.lower():
            gaps.append(req)

    if gaps:
        return f"Document is missing the following requirements: {', '.join(gaps)}"
    else:
        return "Document meets all requirements."

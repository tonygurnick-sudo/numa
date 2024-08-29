# type: ignore
import json
import os
from dataclasses import asdict
from typing import List

import streamlit as st
import structlog
from dca import (
    Document,
    DocumentPage,
    document_completeness_agent,
    document_summary_agent,
    requirement_enrichment,
)
from services.s3_service import check_s3_object, upload_to_s3
from services.textract_service import (
    extract_page_count_from_textract_response,
    extract_text_from_textract_response,
    get_response_using_textract,
)
from utils.file_utils import determine_file_type

BUCKET_NAME = "document-completeness-app"
LOCAL_FILE_DIR = "docs"
MAX_FILES = 10
MAX_TOTAL_PDF_PAGES = 30

logger = structlog.get_logger(__name__)

# Streamlit App Layout
st.title("Document Completeness Analyzer")

# # File Uploader
# uploaded_file = st.file_uploader(
#     "Upload a document", type=["pdf", "docx", "txt", "jpg", "jpeg", "png"]
# )

# File uploader for multiple files
files = st.file_uploader(
    "Upload multiple documents",
    type=["pdf", "docx", "txt", "jpg", "jpeg", "png"],
    accept_multiple_files=True,
)

# Get requirements from user
requirements = st.text_area("Enter the requirements to be analyzed", height=200)


def create_document_from_textract_response(response, file_name) -> Document:
    document = Document()
    pages = extract_text_from_textract_response(response)
    document_pages: List[DocumentPage] = []
    for page, text in pages.items():
        page_info = DocumentPage()
        page_info.page_number = page
        page_info.num_words = len(text.split())
        page_info.text = text
        document_pages.append(page_info)

    num_pages = extract_page_count_from_textract_response(response)
    document.name = file_name
    document.num_pages = num_pages
    document.total_num_words = sum([page.num_words for page in document_pages])
    document.text = document_pages
    return document


def temp_check_local_file_dir(file_path: str) -> str | None:
    st.write("Checking local file dir {}".format(file_path))
    file_name = os.path.basename(file_path)
    # Check if the extracted text exists in LOCAL_FILE_DIR dir
    # Caching for local development
    if f"{file_name}.json" in os.listdir(LOCAL_FILE_DIR):
        with open(f"{LOCAL_FILE_DIR}/{file_name}.json", "r") as file:
            document_dict = json.load(file)
            document_text = [DocumentPage(**page) for page in document_dict["text"]]
            document = Document(**document_dict)
            document.text = document_text
            return document
    return None


def temp_upload_file_objects_to_s3(file_objects: list) -> list[str]:
    uploaded_files = []
    failed_files = []
    for file in file_objects:
        try:
            # Get file object
            upload_message = upload_to_s3(file, BUCKET_NAME, object_name=file.name)
            logger.info("File uploaded to S3", message=upload_message)
            st.write(upload_message)
            uploaded_files.append(file.name)
        except FileNotFoundError:
            failed_files.append(file.name)
            st.write(f"Failed to upload {file.name}")
    return uploaded_files, failed_files


def get_document(file_path: str) -> str | None:
    """Nick has a smarter document rebuilder."""
    file_name = os.path.basename(file_path)

    # Check if the object exists in S3
    object_exists = check_s3_object(BUCKET_NAME, file_name)
    if object_exists:
        logger.info("S3 object exists, starting Textract job")
        st.write("S3 object exists, starting Textract job")

        # Determine file type
        file_type = determine_file_type(file_path)

        if file_type == "requires_textract":  # [".pdf", ".jpg", ".jpeg", ".png"]
            # Send to Textract
            # TODO: refactor to use Nicks Document Rebuilder
            textract_response = get_response_using_textract(BUCKET_NAME, file_name)
            document = create_document_from_textract_response(
                textract_response, file_name
            )
            return document

        elif file_type == "docx":
            # TODO: Implement DOCX processing using package such as langchain or llamaindex
            logger.exception("DOCX processing not yet implemented", file_type=file_type)
            st.warning("DOCX processing not yet implemented")

        else:
            logger.exception("Unsupported file type", file_type=file_type)
            st.warning("Unsupported file type")
            exit(1)

    else:
        logger.exception(
            "S3 object does not exist or is not accessible", file_name=file_path
        )
        st.warning("S3 object does not exist or is not accessible")

    return None, None


# Add a start button
def main():
    if st.button("Start: Check document completness") and requirements:
        st.subheader("Uploading files to s3...")

        uploaded_files, failed_files = temp_upload_file_objects_to_s3(files)
        logger.info(
            "Uploaded files to S3",
            uploaded_files=uploaded_files,
            failed_files=failed_files,
        )

        st.subheader("Extracting text from documents...")
        # Gather Documents
        documents: List[Document] = []
        for file_path in uploaded_files:
            # Check if the extracted text exists in LOCAL_FILE_DIR dir
            document = temp_check_local_file_dir(file_path)
            if document:
                logger.info("Extracted text found in local cache", file_path=file_path)
                st.write("Extracted text found in local cache for file: ", file_path)
                documents.append(document)
                continue

            document = get_document(file_path)
            if not document:
                logger.exception(
                    "Failed to extract text from document", file_path=file_path
                )
                st.warning(f"Failed to extract text from document {file_path}")
                exit
            documents.append(document)
            # Save Document text to a local file
            with open(f"{LOCAL_FILE_DIR}/{file_path}.json", "w") as file:
                st.write(f"debug {document}")
                json.dump(asdict(document), file, indent=4)

        files_preview = [
            {"file_name": doc.name, "num_pages": doc.num_pages} for doc in documents
        ]
        logger.info("Extracted text from files", documents=files_preview)
        st.write("Extracted text from the following files:", files_preview)

        st.subheader("Generating summaries for documents...")
        documents = document_summary_agent(documents)
        logger.info("Generated summaries for documents")
        st.write("Generated summaries for documents:")
        for doc in documents:
            st.write(doc.name)
            st.write(doc.summary)

        # Check total pages not above max pages
        # TODO: Support RAG when total pages exceed limit
        total_pages = sum([doc.num_pages for doc in documents])
        if total_pages > 100:  # Arbitrary limit (untested)
            logger.exception(
                "Total number of pages exceeds the limit of 100",
                total_pages=total_pages,
            )
            st.warning("Total number of pages exceeds the limit of 100")
            exit(1)

        st.subheader("Enriching requirements with additional context...")
        # Enrich the requirements with additional context
        enriched_requirements = requirement_enrichment(requirements, documents)
        logger.info(
            "Enriched Requirements", enriched_requirements=enriched_requirements
        )
        st.write("Enriched Requirements", enriched_requirements)

        st.subheader("Analyzing document completeness...")
        # Pass extracted text to the DCA for analysis
        dca_result = document_completeness_agent("extracted_text")
        logger.info("Document Completeness Analysis Result", dca_result=dca_result)
        st.write("Document Completeness Analysis Result", dca_result)


if __name__ == "__main__":
    main()

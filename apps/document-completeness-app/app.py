# type: ignore
import time

import streamlit as st
from services.dca_service import document_completeness_agent
from services.s3_service import check_s3_object, upload_to_s3
from services.textract_service import (
    check_textract_job_status,
    extract_text_from_textract_response,
    send_to_textract,
)
from utils.file_utils import determine_file_type

BUCKET_NAME = "document-completeness-app"

# Streamlit App Layout
st.title("Document Completeness Analyzer")

# File Uploader
uploaded_file = st.file_uploader(
    "Upload a document", type=["pdf", "docx", "txt", "jpg", "jpeg", "png"]
)

if uploaded_file is not None:
    # Upload to S3
    upload_message = upload_to_s3(uploaded_file, BUCKET_NAME)
    st.write(upload_message)

    # Check if the object exists in S3
    object_exists = check_s3_object(BUCKET_NAME, uploaded_file.name)
    if object_exists:
        st.write("S3 object exists, starting Textract job.")

        # Determine file type
        file_type = determine_file_type(uploaded_file.name)

        if file_type == "requires_textract":
            # Send to Textract
            job_id = send_to_textract(BUCKET_NAME, uploaded_file.name)
            if job_id:
                st.write(f"Textract job started with Job ID: {job_id}")

                # Add a delay before polling to allow Textract job to start
                time.sleep(10)  # Wait 10 seconds before polling

                # Poll for Textract job completion
                textract_response = check_textract_job_status(job_id)

                if textract_response:
                    extracted_text = extract_text_from_textract_response(
                        textract_response
                    )
                    st.write("Extracted Text:")
                    st.write(extracted_text)

                    # Pass extracted text to the DCA for analysis
                    dca_result = document_completeness_agent(extracted_text)
                    st.write("Document Completeness Analysis Result:")
                    st.write(dca_result)
                else:
                    st.write("Textract job failed.")

        elif file_type == "docx":
            # Handle DOCX processing (to be implemented)
            st.write("Processing DOCX file (not yet implemented).")

        else:
            st.write("Unsupported file type.")
    else:
        st.write("S3 object does not exist or is not accessible.")

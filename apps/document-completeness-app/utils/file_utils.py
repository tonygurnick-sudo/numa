from pathlib import Path


def determine_file_type(file_name):
    file_extension = Path(file_name).suffix.lower()
    if file_extension in [".pdf", ".jpg", ".jpeg", ".png"]:
        return "requires_textract"
    elif file_extension == ".docx":
        return "docx"
    else:
        return "unsupported"

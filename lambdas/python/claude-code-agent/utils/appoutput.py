"""
AppOutput formatting utilities for Claude Code Agent.

Provides standard output formatting functions to ensure consistency across
different agent types and eliminate code duplication.
"""

from typing import Any, Dict, List, Optional


def format_inline_result(
    title: str, content: str, s3_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Format a single inline result output.

    Args:
        title: Title for the result
        content: Markdown content
        s3_key: Optional S3 key for reference (used by frontend for data-analysis detection)

    Returns:
        AppOutput dictionary with results
    """
    data: Any = content
    if s3_key:
        # Data analysis format with key for frontend detection
        data = {"key": s3_key, "content": content}

    return {
        "results": [
            {
                "input_reference": None,
                "outputs": [
                    {
                        "content_type": "text/markdown",
                        "title": title,
                        "data": data,
                        "location": "INLINE",
                    }
                ],
            }
        ]
    }


def format_error_result(error_message: str) -> Dict[str, Any]:
    """
    Format an error response in the standard AppOutput structure.

    Args:
        error_message: Error message to display

    Returns:
        AppOutput dictionary with error result
    """
    return format_inline_result("Error", error_message)


def format_success_with_files(
    result_text: str, output_files: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Format a success response with optional file references.

    Args:
        result_text: Main result text in markdown
        output_files: Optional list of file info dicts with 'type', 'name', 'path' keys

    Returns:
        AppOutput dictionary with results and file references
    """
    outputs = [
        {
            "content_type": "text/markdown",
            "title": "Results",
            "data": result_text,
            "location": "INLINE",
        }
    ]

    # Add file references if any
    if output_files:
        for file_info in output_files:
            outputs.append(
                {
                    "content_type": file_info.get("type", "application/octet-stream"),
                    "title": file_info.get("name", "Output File"),
                    "data": file_info.get("path", ""),
                    "location": "S3",
                }
            )

    return {
        "results": [
            {
                "input_reference": None,
                "outputs": outputs,
            }
        ]
    }

"""Setup configuration for DB CLI Python SDK."""

from pathlib import Path

from setuptools import find_packages, setup

# Read README for long description
readme_file = Path(__file__).parent / "README.md"
long_description = readme_file.read_text() if readme_file.exists() else ""

setup(
    name="db-cli-sdk",
    version="1.0.0",
    description="Python wrapper for DB CLI tool with AI-powered database queries",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="DB CLI Team",
    python_requires=">=3.7",
    py_modules=["db_sdk"],
    install_requires=[
        "pyyaml>=6.0",
    ],
    extras_require={
        "dev": [
            "pytest>=7.0.0",
            "pytest-timeout>=2.1.0",
        ],
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Topic :: Database",
        "Topic :: Software Development :: Libraries :: Python Modules",
    ],
)

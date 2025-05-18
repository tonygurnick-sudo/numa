# Dockerfile to build Tesseract for use in AWS Lambdas

[Tesseract](https://github.com/tesseract-ocr/tesseract) is an OCR engine that
we need as part of our content extractor lambda so we can run local text
extraction instead of relying on AWS's Textract service.

Currently we use zip deploys so are constrained by a maximum file size of 50MB
for the zip and a maximum of 250 MB for the unpacked zip and any layers. Our
content extractor Lamdba currently has ~21 MB zipped and ~43MB unzipped.

[Tesseract](https://github.com/tesseract-ocr/tesseract) depends on
[Leptonic](https://github.com/danbloomberg/leptonica) which in turn depends on
a few image libraries if their respective format is meant to be supported.

The latest Python Lambdas use Amazon Linux 2023 so that is used as base. It has
the required image libraries available, but Leptonica/Tesseract needs to be
compiled. The compilation time varies but it's in this ballpark:

- Leptonica: ~3 minutes
- Tesseract: ~16 minutes

Currently all image formats supported by Leptonica/Tesseract are included. The
zip of all required libraries, binary and data for English has 14 MB (32MB
unpacked).

To use the binary, a few paths need to be set as environment variables (see
Dockerfile).

The content extractor Lambda can use the binary directly. Using a Python
package to use the libraries directly like https://github.com/sirfz/tesserocr
might have better performance, but would add to the size of the Lambda zip.

In the current form we are able to include Tesseract in the Lambda zip, but if
we need other Python packages or more language support the, we might breach the
limit. We could then look into building images or side loading Tesseract and
dependencies.

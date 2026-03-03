#!/usr/bin/env bash
# Publish the shelfio LibreOffice Lambda layer to a new AWS region.
#
# The official shelfio/libreoffice-lambda-layer is only published in select
# regions. This script copies it from a source region and republishes it in the
# target region, then makes it public so any account can use it.
#
# Usage:
#   ./tools/publish-libreoffice-layer.sh <target-region> [source-region]
#
# Example:
#   ./tools/publish-libreoffice-layer.sh ap-southeast-3
#   ./tools/publish-libreoffice-layer.sh ap-southeast-3 ap-southeast-2
#
# After running, take the output ARN and add it to:
#   infra/constructs/app-agnostic-api-gateway-lambda-collection.ts
#   in the getLibreOfficeLayerArn() function.

set -euo pipefail

TARGET_REGION="${1:?Usage: $0 <target-region> [source-region]}"
SOURCE_REGION="${2:-ap-southeast-2}"
LAYER_NAME="libreoffice-brotli"

# The shelfio published layer account varies by region.
# 764866452798 is their account for us-east-1 and ap-southeast-2.
SOURCE_LAYER_ARN="arn:aws:lambda:${SOURCE_REGION}:764866452798:layer:${LAYER_NAME}:1"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "==> Getting layer download URL from ${SOURCE_REGION}..."
DOWNLOAD_URL=$(aws lambda get-layer-version-by-arn \
  --arn "${SOURCE_LAYER_ARN}" \
  --region "${SOURCE_REGION}" \
  --query 'Content.Location' \
  --output text)

echo "==> Downloading layer zip..."
curl -sSL -o "${TMPDIR}/layer.zip" "${DOWNLOAD_URL}"

LAYER_SIZE=$(du -h "${TMPDIR}/layer.zip" | cut -f1)
echo "==> Downloaded ${LAYER_SIZE}"

# Layer zip is ~96MB which exceeds the 70MB direct upload limit for PublishLayerVersion.
# Upload to a staging S3 bucket in the TARGET region first (Lambda requires same-region S3).
S3_BUCKET="arcanum-lambda-layer-staging-${TARGET_REGION}"
S3_KEY="${LAYER_NAME}/layer.zip"

echo "==> Ensuring S3 bucket ${S3_BUCKET} exists in ${TARGET_REGION}..."
if ! aws s3api head-bucket --bucket "${S3_BUCKET}" --region "${TARGET_REGION}" 2>/dev/null; then
  aws s3api create-bucket \
    --bucket "${S3_BUCKET}" \
    --region "${TARGET_REGION}" \
    --create-bucket-configuration LocationConstraint="${TARGET_REGION}"
fi

echo "==> Uploading layer zip to S3..."
aws s3 cp "${TMPDIR}/layer.zip" "s3://${S3_BUCKET}/${S3_KEY}" --region "${TARGET_REGION}"

echo "==> Publishing layer to ${TARGET_REGION} (via S3)..."
PUBLISHED_ARN=$(aws lambda publish-layer-version \
  --layer-name "${LAYER_NAME}" \
  --description "LibreOffice for Lambda (copied from ${SOURCE_REGION})" \
  --compatible-runtimes "provided" "provided.al2" "provided.al2023" \
  --compatible-architectures "x86_64" \
  --content "S3Bucket=${S3_BUCKET},S3Key=${S3_KEY}" \
  --region "${TARGET_REGION}" \
  --query 'LayerVersionArn' \
  --output text)

echo "==> Cleaning up S3 staging..."
aws s3 rm "s3://${S3_BUCKET}/${S3_KEY}" --region "${TARGET_REGION}"

echo "==> Published: ${PUBLISHED_ARN}"

# Extract version number from ARN
LAYER_VERSION=$(echo "${PUBLISHED_ARN}" | grep -oE '[0-9]+$')

echo "==> Making layer public..."
aws lambda add-layer-version-permission \
  --layer-name "${LAYER_NAME}" \
  --version-number "${LAYER_VERSION}" \
  --statement-id public-access \
  --action lambda:GetLayerVersion \
  --principal "*" \
  --region "${TARGET_REGION}"

echo ""
echo "Done! Add this ARN to getLibreOfficeLayerArn() in:"
echo "  infra/constructs/app-agnostic-api-gateway-lambda-collection.ts"
echo ""
echo "  '${TARGET_REGION}': '${PUBLISHED_ARN}',"

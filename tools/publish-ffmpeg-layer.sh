#!/usr/bin/env bash
# Build and publish an ffmpeg Lambda layer from static binaries.
#
# Downloads a static ffmpeg/ffprobe build, packages it as a Lambda layer,
# and publishes it to the specified AWS region. Makes it public so any
# account in the region (i.e., client accounts) can use it.
#
# The layer provides /opt/bin/ffmpeg and /opt/bin/ffprobe.
#
# Usage:
#   AWS_PROFILE=q-demo ./tools/publish-ffmpeg-layer.sh <region>
#
# Example:
#   AWS_PROFILE=q-demo ./tools/publish-ffmpeg-layer.sh us-east-1
#   AWS_PROFILE=q-demo ./tools/publish-ffmpeg-layer.sh ap-southeast-2
#   AWS_PROFILE=q-demo ./tools/publish-ffmpeg-layer.sh ap-southeast-3
#
# After running, take the output ARN and add it to:
#   infra/stacks/numa-client-stack.ts in the ffmpegLayerByRegion map.

set -euo pipefail

TARGET_REGION="${1:?Usage: $0 <region>}"
LAYER_NAME="ffmpeg-static"

# Static ffmpeg builds from johnvansickle.com (x86_64, GPL licensed)
FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "==> Downloading static ffmpeg build..."
curl -sSL -o "${TMPDIR}/ffmpeg.tar.xz" "${FFMPEG_URL}"

echo "==> Extracting ffmpeg and ffprobe..."
tar xf "${TMPDIR}/ffmpeg.tar.xz" -C "${TMPDIR}"

# The tarball extracts to a directory like ffmpeg-7.1-amd64-static/
FFMPEG_DIR=$(ls -d "${TMPDIR}"/ffmpeg-*-static 2>/dev/null | head -1)
if [ -z "${FFMPEG_DIR}" ]; then
  echo "ERROR: Could not find extracted ffmpeg directory"
  ls "${TMPDIR}"
  exit 1
fi

# Package as Lambda layer (binaries go in bin/ -> mounted at /opt/bin/)
mkdir -p "${TMPDIR}/layer/bin"
cp "${FFMPEG_DIR}/ffmpeg" "${TMPDIR}/layer/bin/"
cp "${FFMPEG_DIR}/ffprobe" "${TMPDIR}/layer/bin/"
chmod +x "${TMPDIR}/layer/bin/ffmpeg" "${TMPDIR}/layer/bin/ffprobe"

echo "==> Creating layer zip..."
cd "${TMPDIR}/layer"
zip -r "${TMPDIR}/ffmpeg-layer.zip" bin/
cd -

LAYER_SIZE=$(du -h "${TMPDIR}/ffmpeg-layer.zip" | cut -f1)
echo "==> Layer zip: ${LAYER_SIZE}"

# Layer zip is ~80MB which exceeds the 50MB direct upload limit.
# Upload to S3 staging bucket first (Lambda requires same-region S3).
S3_BUCKET="arcanum-lambda-layer-staging-${TARGET_REGION}"
S3_KEY="${LAYER_NAME}/layer.zip"

echo "==> Ensuring S3 bucket ${S3_BUCKET} exists in ${TARGET_REGION}..."
if ! aws s3api head-bucket --bucket "${S3_BUCKET}" --region "${TARGET_REGION}" 2>/dev/null; then
  if [ "${TARGET_REGION}" = "us-east-1" ]; then
    aws s3api create-bucket \
      --bucket "${S3_BUCKET}" \
      --region "${TARGET_REGION}"
  else
    aws s3api create-bucket \
      --bucket "${S3_BUCKET}" \
      --region "${TARGET_REGION}" \
      --create-bucket-configuration LocationConstraint="${TARGET_REGION}"
  fi
fi

echo "==> Uploading layer zip to S3..."
aws s3 cp "${TMPDIR}/ffmpeg-layer.zip" "s3://${S3_BUCKET}/${S3_KEY}" --region "${TARGET_REGION}"

echo "==> Publishing layer to ${TARGET_REGION} (via S3)..."
PUBLISHED_ARN=$(aws lambda publish-layer-version \
  --layer-name "${LAYER_NAME}" \
  --description "Static ffmpeg + ffprobe for audio/video processing" \
  --compatible-runtimes "python3.13" "python3.12" "python3.11" "provided.al2023" \
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
echo "Done! Add this ARN to ffmpegLayerByRegion in:"
echo "  infra/stacks/numa-client-stack.ts"
echo ""
echo "  '${TARGET_REGION}': '${PUBLISHED_ARN}',"

#!/usr/bin/env bash
# End-to-end Synergy -> Bedrock KB job. Run ON the cuttriss us-east-2 EC2
# (in-region: backup download is free + fast; only the few-GB text corpus
# leaves the region). Uses the instance role for AWS creds -- no profile.
#
# Phases (resumable): extraction skips already-done files via manifest.jsonl,
# sync is incremental, ingest starts a fresh KB ingestion job.
#
#   ./run_synergy_kb.sh            # all phases
#   ./run_synergy_kb.sh extract    # just pull + extract text
#   ./run_synergy_kb.sh sync       # just push corpus to the KB folder
#   ./run_synergy_kb.sh ingest     # just trigger KB ingestion
#   SRC_PREFIX=documents/kb-626f1ef5-e63e-44c9-b35c-ad12c2166098/0812/ ./run_synergy_kb.sh   # scope to one job
set -euo pipefail

# --- config (cuttriss) ---
SRC_BUCKET=numa-cuttriss-backup
SRC_REGION=us-east-2
SRC_PREFIX=${SRC_PREFIX:-documents/}          # override to scope to fewer jobs
DEST_BUCKET=numa-cuttriss-data
DEST_PREFIX=documents/synergy/                 # new folder in the existing KB data source
KB_REGION=ap-southeast-2
KB_ID=FZGFXMNSZ3                               # cuttriss-kb-s3vectors
DS_ID=VGKUYEZXIW                               # cuttriss-datasource
OUT=${OUT:-$HOME/synergy_corpus}
PHASE=${1:-all}

here=$(cd "$(dirname "$0")" && pwd)

setup() {
  command -v python3 >/dev/null || { echo "need python3"; exit 1; }
  [ -d "$here/venv" ] || python3 -m venv "$here/venv"
  "$here/venv/bin/pip" install -q --upgrade pip
  "$here/venv/bin/pip" install -q boto3 pymupdf python-docx openpyxl extract-msg
}

extract() {
  echo "[extract] s3://$SRC_BUCKET/$SRC_PREFIX -> $OUT  ($(date))"
  local tries=0
  until "$here/venv/bin/python" "$here/synergy_s3_text_extractor.py" \
        --bucket "$SRC_BUCKET" --region "$SRC_REGION" \
        --prefix "$SRC_PREFIX" --out "$OUT"; do
    rc=$?
    tries=$((tries + 1))
    echo "[extract] python exited rc=$rc — auto-resuming #$tries (a segfault on a bad file is expected; it gets quarantined and skipped)"
    if [ "$tries" -ge 300 ]; then echo "[extract] giving up after $tries restarts"; return 1; fi
    sleep 2
  done
  echo "[extract] completed cleanly (restarts: $tries)"
}

sync() {
  echo "[sync] $OUT/docs -> s3://$DEST_BUCKET/$DEST_PREFIX  ($(date))"
  aws s3 sync "$OUT/docs" "s3://$DEST_BUCKET/$DEST_PREFIX" --only-show-errors
  echo "[sync] objects now under prefix: $(aws s3 ls "s3://$DEST_BUCKET/$DEST_PREFIX" --recursive | wc -l)"
}

ingest() {
  echo "[ingest] KB=$KB_ID DS=$DS_ID region=$KB_REGION  ($(date))"
  JOB=$(aws bedrock-agent start-ingestion-job --region "$KB_REGION" \
        --knowledge-base-id "$KB_ID" --data-source-id "$DS_ID" \
        --query 'ingestionJob.ingestionJobId' --output text)
  echo "[ingest] started job: $JOB"
  echo "[ingest] watch with:"
  echo "  aws bedrock-agent get-ingestion-job --region $KB_REGION \\"
  echo "    --knowledge-base-id $KB_ID --data-source-id $DS_ID --ingestion-job-id $JOB \\"
  echo "    --query 'ingestionJob.{status:status,stats:statistics}'"
}

setup
case "$PHASE" in
  all)     extract; sync; ingest ;;
  extract) extract ;;
  sync)    sync ;;
  ingest)  ingest ;;
  *) echo "usage: $0 [all|extract|sync|ingest]"; exit 1 ;;
esac
echo "[done] phase=$PHASE  ($(date))"

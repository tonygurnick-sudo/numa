#!/usr/bin/env bash
# claude-engineer / resource-guard.sh
#
# Refuse to start a heavy op (deploy / image build) if another one is already
# running on THIS machine. The autonomous pipeline shares a laptop with a human
# (and possibly other agents), so isolation has to be enforced, not assumed.
#
# Why (today's findings):
#   #5  a big `terraform apply` is memory-heavy; running it next to a Docker
#       build OOM-killed the AWS provider mid-apply.
#   #6  two concurrent `cdktf deploy`s wrote the same 722MB provider binary to
#       the shared TF plugin cache at once and CORRUPTED it.
#   #7  sustained memory pressure took down Docker Desktop itself.
# Rule: ONE heavy op at a time. Wait, don't race.
#
# Exit 0 = clear to proceed. Exit 1 = something is already running.
set -uo pipefail

fail=0

# A naive `pgrep -f "cdktf deploy"` also matches MONITORING commands that merely
# mention the string — e.g. a watcher running `grep -E "...cdktf deploy..."` or
# `while kill -0 $PID`. That self-match once blocked a real deploy (BUG-376
# post-mortem). So exclude this guard's own PID tree and anything that looks like
# a monitor (grep/pgrep/tail/sed/awk/kill -0/CloudWatch --filter-pattern/the
# guard script itself) before deciding a heavy op is truly in flight.
heavy_running() {  # $1 = pgrep pattern, $2 = human label
  local hits
  hits="$(pgrep -fl "$1" 2>/dev/null \
    | grep -vE "\b(grep|pgrep|tail|sed|awk)\b|kill -0|--filter-pattern|resource-guard|[b]ug376" \
    | grep -vE "^$$ |^$PPID " || true)"
  [ -z "$hits" ] && return 1
  echo "❌ A '$2' is already running:"
  echo "$hits" | sed 's/^/    /'
  return 0
}

heavy_running "terraform.* apply" "terraform apply" && fail=1
heavy_running "cdktf.* deploy"    "cdktf deploy"    && fail=1

if docker info >/dev/null 2>&1; then
  # buildkit containers linger idle after a build; only block on an ACTIVE one
  # (>20% CPU) so we don't false-positive on a warm idle builder.
  for c in $(docker ps --filter "name=buildkit" --format '{{.Names}}' 2>/dev/null); do
    cpu=$(docker stats --no-stream --format '{{.CPUPerc}}' "$c" 2>/dev/null | tr -d '% ')
    if awk -v cpu="${cpu:-0}" 'BEGIN{exit !(cpu+0 > 20)}'; then
      echo "❌ An active Docker build is running on builder: $c (${cpu}% CPU)"
      fail=1
    fi
  done
else
  echo "⚠️  Docker daemon not reachable — image BUILDS will fail."
  echo "    (skopeo pushes from existing image.tar files do NOT need Docker, so a deploy of already-built artifacts is fine.)"
fi

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "🛑 resource-guard: a heavy op is already in progress. Wait for it to finish before starting another."
  exit 1
fi

echo "✅ resource-guard: clear (no competing terraform apply / cdktf deploy / active Docker build)."
exit 0

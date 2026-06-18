#!/usr/bin/env bash
# claude-engineer / deploy.sh
#
# Hardened, GUARDED local deploy for the claude-engineer pipeline. Encodes the
# deploy-authority boundary plus every deploy lesson from the first cold run:
#   #2  correct exit-code propagation (no trailing echo masking failures)
#   #3  cold worktrees lack container-lambda images -> build browser-lambda if missing
#   #4  namespaced buildx builder (handled inside the patched package-*.sh)
#   #5  --terraform-parallelism bounds AWS-provider memory
#   #6  isolated TF_PLUGIN_CACHE_DIR per worktree (no shared-cache corruption)
#   #5/#6/#7  resource-guard refuses to run beside another heavy op
#
# Usage:
#   deploy.sh <cdktf-stack> [--package] [--i-have-permission] [--parallelism N]
#
# Examples:
#   deploy.sh numa-arcanum-demo-sydney --package      # dev stack, full build+deploy
#   deploy.sh numa-arcanum-demo-sydney                # dev stack, artifacts already warm
#   deploy.sh pipedream-proxy --i-have-permission     # gated, human-approved
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# skill lives at <repo>/.claude/skills/claude-engineer/scripts -> 4 levels up
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

STACK="${1:?usage: deploy.sh <cdktf-stack> [--package] [--i-have-permission] [--parallelism N]}"
shift || true

DO_PACKAGE=0; HAVE_PERMISSION=0; PARALLELISM=4
while [ $# -gt 0 ]; do
  case "$1" in
    --package)           DO_PACKAGE=1 ;;
    --i-have-permission) HAVE_PERMISSION=1 ;;
    --parallelism)       shift; PARALLELISM="${1:?--parallelism needs a value}" ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
  shift
done

# ============================================================================
# Deploy-authority policy (DEFAULT-DENY). This is the safety core — do not relax.
# ============================================================================
# Dev/demo stacks: autonomous. Add a new dev stack here only when it is genuinely
# a throwaway dev/demo instance (devInstance:true), never a customer.
DEV_CLIENTS=("arcanum-demo-sydney" "nd-labs" "arcanum-demo-greg")
# Customer-facing SHARED stacks: changes hit ALL customers immediately, so they
# require explicit human permission AND must be backwards compatible.
GATED_STACKS=("q-apps-deployer-stack" "pipedream-proxy")

client="${STACK#numa-}"   # numa-arcanum-demo-sydney -> arcanum-demo-sydney

is_dev=0;   for c in "${DEV_CLIENTS[@]}";  do [ "$c" = "$client" ] && is_dev=1;   done
is_gated=0; for s in "${GATED_STACKS[@]}"; do [ "$s" = "$STACK" ]  && is_gated=1; done

if [ "$is_dev" -eq 1 ]; then
  echo "✅ '$STACK' is an approved DEV stack — autonomous deploy allowed."
elif [ "$is_gated" -eq 1 ]; then
  if [ "$HAVE_PERMISSION" -ne 1 ]; then
    echo "🔒 '$STACK' is a CUSTOMER-FACING shared stack — changes reach all customers immediately."
    echo "   Refusing without explicit human approval."
    echo "   Re-run with --i-have-permission ONLY after a human approves AND you have confirmed"
    echo "   the change is BACKWARDS COMPATIBLE."
    exit 3
  fi
  echo "🔓 '$STACK' is gated; --i-have-permission supplied. Proceeding — ensure backwards compatibility!"
else
  echo "⛔ '$STACK' is neither an approved dev stack nor a recognised gated stack."
  echo "   Treating as a CUSTOMER stack. claude-engineer NEVER deploys to customer stacks (portal-only)."
  exit 4
fi

# ---- Resource guard: one heavy op at a time ----
"$SCRIPT_DIR/resource-guard.sh" || exit 1

# ---- Isolated plugin cache (finding #6) ----
export TF_PLUGIN_CACHE_DIR="$REPO_ROOT/.tf-plugin-cache"
mkdir -p "$TF_PLUGIN_CACHE_DIR"

cd "$REPO_ROOT" || exit 1

# ---- Optional packaging (patched package-*.sh are worktree-safe, finding #1/#4) ----
if [ "$DO_PACKAGE" -eq 1 ]; then
  echo "==> [1/5] infra deps"          ; ( cd infra && yarn ) || exit 1
  echo "==> [2/5] cdktf get"           ; ( cd infra && yarn get ) || exit 1
  echo "==> [3/5] package all lambdas" ; bash lambdas/package-all.sh || exit 1
  echo "==> [4/5] package workspace"   ; ( cd services && ./package-service.sh numa-workspace-agent ) || exit 1
  echo "==> [5/5] frontend build"      ; yarn --cwd numa-frontend && yarn --cwd numa-frontend build || exit 1
  # Cold-worktree container image (finding #3): dev stacks reference browser-lambda.
  if [ ! -f "infra/assets/artifacts/browser-lambda/image.tar" ]; then
    echo "==> container image missing — building browser-lambda"
    ( cd lambdas && bash package-container-lambda.sh python/browser-lambda ) || exit 1
  fi
fi

# ---- Deploy (gated stacks must NOT carry CLIENT_OVERRIDE) ----
echo "==> cdktf deploy $STACK (terraform-parallelism=$PARALLELISM)"
if [ "$is_dev" -eq 1 ]; then
  ( cd infra && TF_ENVIRONMENT=prod AWS_REGION=us-east-1 CLIENT_OVERRIDE="$client" \
      yarn cdktf deploy --auto-approve --terraform-parallelism "$PARALLELISM" "$STACK" )
else
  ( cd infra && unset CLIENT_OVERRIDE; TF_ENVIRONMENT=prod AWS_REGION=us-east-1 \
      yarn cdktf deploy --auto-approve --terraform-parallelism "$PARALLELISM" "$STACK" )
fi
rc=$?

[ $rc -eq 0 ] && echo "✅ deploy complete: $STACK" || echo "❌ deploy failed (rc=$rc): $STACK"
exit $rc   # <- real exit code, finding #2

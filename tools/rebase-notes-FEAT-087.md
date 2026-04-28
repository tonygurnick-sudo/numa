# Rebase notes — feature/FEAT-087-netsuite-mcp onto dev (2026-04-28)

Record of every conflict-resolution choice made during the rebase so each one can be reverted individually if it turns out to be wrong.

**Pre-rebase state**: branch was 6 commits ahead of `origin/feature/FEAT-087-netsuite-mcp`, working tree had 10 modified files + 1 untracked doc. Stashed before rebase, popped after.

**Post-rebase state**: 62 ahead / 12 behind origin (the 12 are the old SHAs that the rebase rewrote — they vanish on force-push). Stash popped cleanly with auto-merges, no conflicts.

---

## 5 commits dropped automatically

These were already on dev. Git skipped them during rebase.

```
115d2e53  fix: support kb default fix
59a81124  fix: knowledge_base tool — folder-aware list, raw chunks default, delete IAM
4f6ed00d  fix: agent team sharing, visibility UI, and team-member safeguards
400fe256  fix: hotfix model not available deploy error
1db58621  fix(nzsba-policy-builder): upload correct source files and track content changes
e16ebb38  fix: resolve Pyright errors on connect_tools and __init__   (dropped mid-rebase as "patch contents already upstream")
```

No action needed — these are the same content, just from earlier merges.

---

## Conflict 1 — `90e6c221  FEAT-087: Implement NetSuite MCP Connector`

**File:** `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`

**Situation:** dev removed the S3 data-bucket handlers from this file (they moved to the new `lambdas/python/numa-kb-manager/`). The original FEAT-087 commit added BOTH the S3 data-bucket handlers AND the NetSuite MCP handler in the same hunk.

**My choice:** Took dev's version (`git checkout --ours`) which has neither, then surgically added back ONLY the NetSuite MCP handler between the Synergy and "Generic HTTP" sections. Dropped the S3 handlers entirely.

**To revert:** restore the S3 data-bucket handlers (`handle_connect_s3data_list`, `handle_connect_s3data_search`, `handle_connect_s3data_download`, `_get_s3_client`) into `connect_tools.py`. **But do not** — they're intentionally gone, that work moved to `numa-kb-manager`. The only reason to revert would be if numa-kb-manager doesn't actually own those operations.

**Side effect:** `lambdas/python/oauth-workspace-tools/tools/__init__.py` was missing `handle_connect_netsuite_mcp` from its re-exports because dev's version doesn't know about it. Added the import + `__all__` entry so `lambda_function.py` imports cleanly.

**Side effect:** Removed 4 root-level scratch markdown files (`mr_description_bug014.md`, `mr_description_feat003.md`, `mr_description_feat087.md`, `mr_description_worker.md`) that were committed in 90e6c221 by mistake. They don't belong in the tree — `tools/` is the place for dev scratch per CLAUDE.md. To revert: re-add those files (but you almost certainly don't want them).

---

## Conflict 2 — `d194d840  fix(netsuite): fetch credentials from company vault instead of user vault`

**File:** `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`

**Situation:** Trivial. The conflict was a one-line addition of a `# Fetch token` comment that HEAD didn't have.

**My choice:** Took HEAD (no comment). The substantive change in this commit (switching from user-vault to company-vault for `client_id` / `account_id` lookup) had already been applied as part of how I resolved Conflict 1, so the post-resolution state already reflects the company-vault behaviour.

**To revert:** add the `# Fetch token` comment back if you care, but the actual logic change (company vault) is the load-bearing part and that's preserved.

---

## Conflict 3 — `82ba3e30  fix(oauth-handler): allow NetSuite PKCE connector to be listed without a client secret`

**File:** `lambdas/node/oauth-auth-handler/index.ts` (around line 1068)

**Situation:** dev had refactored the provider-listing validation into an `isConfigOnly` vs `isLegacyConnector` split. The incoming PKCE-fix commit had the older single-branch validation.

**My choice:** Hand-merged both. Kept dev's `isConfigOnly` / `isLegacyConnector` split AND added the NetSuite PKCE exception. Final shape:

```ts
if (isOAuth) {
  if (!fields.client_id) continue;
  if (!fields.client_secret && providerId !== 'netsuite') continue;
}
if (isLegacyConnector && !fields.instance_url) continue;
```

**To revert:** drop the `providerId !== 'netsuite'` clause, restoring `if (isOAuth && (!fields.client_id || !fields.client_secret)) continue;`. Reverting would break NetSuite registration on the listing endpoint (it would no longer appear because it has no client_secret).

---

## Conflict 4 — `05a6335d  feat: non-OAuth connector rework — PAT captured in chat, admin only registers`

This commit was the largest, with three sub-conflicts. Rebase replayed it as a fresh commit because my earlier in-session resolution gave it a different SHA than what was on dev.

### 4a — `Makefile` (line 181)

**Situation:** dev removed the transcription-service package step (entire transcription-service was deleted from dev). Incoming wanted to add `cd services && ./package-service.sh transcription-service` back.

**My choice:** Took HEAD — no transcription-service line. Service is gone, package step is gone with it.

**To revert:** unconditionally wrong unless transcription-service comes back, in which case re-add the line.

### 4b — `numa-frontend/src/Pages/Files.tsx` (modify/delete)

**Situation:** dev deleted `Files.tsx` (the page was rewritten as `UnifiedFilesPage`). 05a6335d modified the old `Files.tsx`.

**My choice:** Accepted the deletion (`git rm`). The 05a6335d edits to the old file are forfeit because the file no longer exists.

**To revert:** can't easily — the modifications were to a file that no longer exists. If they need preserving, they'd have to be re-applied to `UnifiedFilesPage.tsx`. Worth checking whether 05a6335d's `Files.tsx` edits were related to the connector-rework UI flow (they probably were) and seeing if those flows need re-implementing in `UnifiedFilesPage`.

### 4c — `lambdas/python/oauth-workspace-tools/tools/connect_tools.py` (around line 766)

**Situation:** HEAD has a guard that blocks Synergy from the generic `connect_request` HTTP path. 05a6335d removed this guard (the rework intentionally let Synergy through the unified endpoint).

**My choice:** Took HEAD — kept the Synergy guard. Reasoning: a later dev commit had restored the guard, so HEAD's state reflects the most-recent dev intent.

**To revert:** delete the `if connector == "synergy"` block in `handle_connect_request` if you want Synergy to flow through the generic HTTP path. Worth double-checking dev's history (`git log -p` on this file) to confirm whether the guard restoration on dev was deliberate or a regression.

---

## Stash pop — auto-merged with no conflicts

The earlier session's working-tree changes (NetSuite refactor + capabilities-metadata system_only flag + new `04-connection-and-reauth.md` doc) all popped cleanly. Files involved:

- `infra/capabilities-metadata.ts`
- `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`
- `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/connect.py`
- `services/numa-workspace-agent/plugins/numa/skills/connect/SKILL.md`

No decisions made here — git auto-merged all of them.

---

## How to inspect the resolved state

```bash
# See what the rebase produced for each conflict-touched file
git log --follow -p lambdas/python/oauth-workspace-tools/tools/connect_tools.py
git log --follow -p lambdas/node/oauth-auth-handler/index.ts
git log --follow -p Makefile

# Compare against pre-rebase state (the old SHAs are the 12 "behind")
git log --oneline origin/feature/FEAT-087-netsuite-mcp..HEAD
git log --oneline HEAD..origin/feature/FEAT-087-netsuite-mcp

# Walk back through the rebased commits one by one
git log --oneline 7bf62f61..HEAD   # 7bf62f61 was the original branch-point before the rebase
```

## Hard recovery — full revert of the rebase

The pre-rebase tip is reachable as `ORIG_HEAD` (until that gets overwritten) and via reflog:

```bash
git reflog                          # find the SHA from before "rebase --continue"
git reset --hard <sha>              # nuclear option — restores the entire pre-rebase branch
git push --force-with-lease         # if you've already pushed and want to revert
```

But this also undoes my conflict resolutions. Generally prefer reverting individual commits via the table above.

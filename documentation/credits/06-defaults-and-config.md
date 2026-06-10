# 06 — Defaults, configuration & feature flags

Where every default lives, how config flows from the portal to a metered conversation, and the flags/kill-switches.

---

## 1. The defaults — and the three mirrored places

The pricing defaults are intentionally duplicated in **three** code locations (one per language/runtime). They
must be **changed together** — there is no single shared constant across Python/Node/TS.

| Default                    | Value            | 1. lib (Python)                          | 2. admin-credits (Node)                           | 3. portal (TS)                                                      |
| -------------------------- | ---------------- | ---------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| `creditUsd`                | 0.30             | `credit_pricing/credits.py: CREDIT_USD`  | `index.ts: DEFAULT_CONFIG.creditUsd`              | `creditsService.ts: DEFAULT_CREDIT_CONFIG.creditUsd`                |
| value tiers (chat)         | 1/2/5/8          | `tiers.py: VALUE_TIER_CREDITS.chat`      | `DEFAULT_CONFIG.valueTiers.chat`                  | `DEFAULT_CREDIT_CONFIG.valueTiers.chat`                             |
| value tiers (agent)        | 0.5/1.5/3/5      | `tiers.py: VALUE_TIER_CREDITS.agent`     | `DEFAULT_CONFIG.valueTiers.agent`                 | `DEFAULT_CREDIT_CONFIG.valueTiers.agent`                            |
| margins (defence)          | 1.1/1.25/1.4/1.6 | `credits.py: MARGINS_BY_TIER`            | `DEFAULT_CONFIG.marginsByTier`                    | `DEFAULT_CREDIT_CONFIG.marginsByTier`                               |
| scalar fallback margin     | 2.0              | `credits.py: MARGIN_TARGET`              | `DEFAULT_CONFIG.margin`                           | `DEFAULT_CREDIT_CONFIG.margin`                                      |
| trivial-cost cap           | 0.01             | `credits.py: TRIVIAL_CONSUMPTION_USD`    | `DEFAULT_CONFIG.trivialConsumptionUsd`            | `DEFAULT_CREDIT_CONFIG.trivialConsumptionUsd`                       |
| AgentCore uplift           | 1.234            | `credits.py: AGENTCORE_MULT`             | _(read from config; not in DEFAULT_CONFIG)_       | `DEFAULT_CREDIT_CONFIG.agentcoreMult`                               |
| default monthly allocation | 2000 (×12)       | `credits.py: DEFAULT_MONTHLY_ALLOCATION` | `DEFAULT_CONFIG.monthlyAllocations` (`[2000×12]`) | `DEFAULT_CREDIT_CONFIG.monthlyAllocations` (`Array(12).fill(2000)`) |

> The lib is the **canonical** one (it does the actual charge math at meter time). admin-credits + portal mirrors
> exist so the in-client read API and the portal UI can show sensible numbers for a client with no saved override.
> Comment on each: "keep in sync with credit_pricing/credits.py + tiers.py".

Changing a lib default also requires updating ~2–3 drift-guard test assertions in `lib/credit-pricing/tests/`
(they pin the current scheme on purpose).

---

## 2. Config flow, end to end

```
Portal edits ──saveConfig──> numa-client-config.config.creditConfig    (central source of truth, deployer acct)
                       └────push──> numa-<client>-credit-ledger  CLIENT#/CONFIG  (client acct)
                                                  │
credit-debit (meter time) reads its LOCAL CLIENT#/CONFIG row ─> effective config
                                                  │ (missing keys → env → lib defaults;
                                                  │  monthlyAllocations missing → DEFAULT_MONTHLY_ALLOCATION)
                                                  ▼
                               charge = max(value, floor) with the effective knobs
```

- **Source of truth:** `numa-client-config` (`config.creditConfig`) in the deployer account.
- **What the meter reads:** the **local** `CLIENT#/CONFIG` row in the client account (pushed by the portal) — so
  there's no cross-account call at meter time.
- **No DB seed at deploy.** A fresh client has no `creditConfig` and no `CONFIG` row; `credit-debit` falls back to
  the lib defaults (incl. 2000/mo allocation). The first portal "Save & push" creates the `CONFIG` row. This is
  deliberate: a deploy can never clobber a portal-set value because the deploy doesn't write credit config at all.
  (An optional deploy-time seed from `config.creditConfig` is noted as possible future work but not implemented.)
- **Forward-only:** changing a knob affects conversations metered **after** the change; already-written rows keep
  their snapshotted values (history is never repriced). The `allocationSnapshot` on the MONTH row is what closed
  months settle against.

---

## 3. `SHOW_CREDITS` — the visibility flag

Gates the in-app **Settings → Credits** tab **and** the in-chat credit indicator (the coin in the chat bar — see
[05-in-client-view.md](05-in-client-view.md)). **Metering is NOT gated by it** — it accrues for everyone; this only
controls who can _see_ the credit surfaces. Note the two surfaces gate differently _within_ `SHOW_CREDITS`: the
Settings dashboard is **billing-admin only**, while the in-chat indicator shows for **all users**.

- **Defined:** `infra/capabilities-metadata.ts` — capability `SHOW_CREDITS`, `enabled: false`, with title +
  description ("Shows the in-app credit usage view … Credit metering runs for all clients regardless; this only
  gates visibility … Default off until rollout.").
- **Per-client value:** `clientConfig.showCredits` (zod field in `numa-client-stack.ts`, default false); set via
  the portal's "Show in client app" switch (`creditsService.setVisibility`, written to `numa-client-config`).
- **Emitted to the frontend:** `numa-client-stack.ts` config.json generation emits
  `SHOW_CREDITS: clientConfig.showCredits ?? false`. **Must be emitted explicitly** because the frontend's
  `getFlag` defaults **true** when a key is absent — omitting it would show the tab everywhere.
- **Read:** `Settings.tsx` (the Credits dashboard tab) **and** `NumaWorkspaceChatAgents.tsx` (the in-chat
  credit indicator) → `getFlag('SHOW_CREDITS')`.
- **Timing:** because it's baked into the client's `config.json` at deploy, toggling it in the portal takes
  visible effect on the **next deploy**.

---

## 4. The metering kill-switch (`CREDIT_METERING_ENABLED`)

Whether the workspace agent actually fires the debit Lambda after a turn.

- Env `CREDIT_METERING_ENABLED` on the workspace agent (set by
  `infra/constructs/workspace-chat-agent-construct.ts` from the `creditMeteringEnabled` prop; default OFF in the
  construct). `credit_metering.py` is a no-op unless it's `true`.
- **Currently hardcoded ON for all clients** in `infra/stacks/numa-client-stack.ts` (`creditMeteringEnabled: true`,
  ~L531) — metering accrues fleet-wide (it's cheap and invisible without `SHOW_CREDITS`).
- ⚠️ **Pre-production note:** before any _new customer_ gets this code, confirm both `creditMeteringEnabled` and
  `SHOW_CREDITS` are intentional for that client (the "meter everyone, hide the UI" stance is deliberate but
  should be a conscious call per the original SPK-015 diff comment).

---

## 5. The `creditConfig` schema (per client)

Stored at `config.creditConfig` in `numa-client-config`, pushed to the `CLIENT#/CONFIG` ledger row, and validated
by the zod schema in `infra/stacks/numa-client-stack.ts` (and mirrored in the portal `types/index.ts`):

```ts
creditConfig?: {
  creditUsd?: number;                 // > 0
  margin?: number;                    // scalar fallback
  trivialConsumptionUsd?: number;
  agentcoreMult?: number;
  valueTiers?: { chat: {low,medium,high,very_high}, agent: {…} };
  marginsByTier?: { low,medium,high,very_high };
  monthlyAllocations?: number[];      // length 12 (Jan..Dec)
}
showCredits?: boolean;                // default false — the visibility flag
```

Any missing field falls back to the code default at read time, so a partial `creditConfig` is valid.

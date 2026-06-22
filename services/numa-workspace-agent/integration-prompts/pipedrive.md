# Pipedrive Integration Tips

All Pipedrive calls go through the `numa integrations` CLI. Action keys follow
`pipedrive-<name>` (`numa integrations pipedream-actions pipedrive` lists them).

## Auth key — use `pipedriveApp` everywhere

Pass `"pipedriveApp": {"authProvisionId": "auto"}` on every action — it works
across the whole action set. (The schemas name the auth prop inconsistently —
`pipedriveApp` on most, `pipedrive` on a few, `app` on `get-all-leads` — but the
proxy normalises the key, so `pipedriveApp` is accepted everywhere. Verified; you
don't need to match the per-action name.)

```json
{ "pipedriveApp": { "authProvisionId": "auto" }, ... }
```

## Label IDs differ by entity — UUIDs vs integers, not interchangeable

This one bites silently — the wrong type is a no-op, not an error.

| Entity       | Label ID type                    | List action                                                           |
| ------------ | -------------------------------- | --------------------------------------------------------------------- |
| **Lead**     | **UUID string** (`"77742b8c-…"`) | `pipedrive-list-lead-label-ids-options`                               |
| Person       | integer (`14`)                   | `pipedrive-list-person-label-ids-options`                             |
| Organization | integer (`10`)                   | `pipedrive-list-organization-label-ids-options`                       |
| Deal         | integer                          | via `pipedream-props-options pipedrive pipedrive-add-deal labelIds …` |

Leads and deals are separate entities throughout Pipedrive: **lead IDs are UUIDs, deal IDs are integers.**

## `add-labels` is unreliable via the CLI — set labels with a direct PUT

`pipedrive-add-labels` has `reloadProps: true` on its `type` selector; that
dependency chain doesn't resolve through the CLI, so the action can run yet apply
**zero** labels. Set labels with a direct `request` PUT instead (and Pipedrive v1
uses **PUT, not PATCH** — see below):

```bash
numa integrations request pipedrive PUT "https://api.pipedrive.com/v1/persons/{id}" \
  --body '{"label_ids":[14]}' -m "Set labels on a person"
```

`pipedrive-remove-labels` _does_ work (`type` + `entityId` (string) + `labelIds`),
but its response shows the **pre-removal** `label_ids` (stale) — the removal still
took effect; don't trust the returned label state.

## Type quirks that fail silently/validation

- **`add-activity` `dealId` / `leadId` must be integers.** The schema marks them `string`, but the API rejects a quoted string (`"deal_id … is not a valid integer"`). Pass `1`, not `"1"`. (`add-activity.type` is required and `remoteOptions` — resolve it first; values seen: call, meeting, task, deadline, email, lunch. It also has a `note` shortcut.)
- **`update-deal` / `add-deal` `probability`** fails with "Deal probability is not enabled for the pipeline" unless that pipeline has probability turned on in Pipedrive's settings — it's a per-pipeline UI setting, not an API field.
- **`pipelineId` props-options returns values only** (`{value: 1}`, no label). For named pipelines, `request GET https://api.pipedrive.com/v1/pipelines`.

## Persons: emails / phones are JSON-stringified objects

`add-person` / `update-person` `emails` and `phones` are `string[]` where each
entry is a JSON-encoded object:

```json
{
  "emails": ["{\"value\":\"user@example.com\",\"primary\":true,\"label\":\"work\"}"],
  "phones": ["{\"value\":\"+6421000000\",\"primary\":true,\"label\":\"work\"}"]
}
```

Label values: `work` / `home` / `mobile` / `other`. A plain string works but lands without a type.

## Notes

- `add-note` `content` is **HTML** (`"<p>…</p>"`). Attach a note to **exactly one** entity — supply one of `dealId` / `leadId` / `personId` / `orgId` (all read optional, but at least one is required).
- `add-deal` (and `add-activity`) accept a `note` string that creates an attached note in the same call — saves a separate `add-note`.

## Updates & deletes — v1 uses PUT, and there are no delete actions

- **Pipedrive v1 uses `PUT`, not `PATCH`** — `PATCH` returns HTTP 404 ("Unknown method") on v1 entity endpoints. Use `PUT` for `request`-based updates.
- **No delete actions exist** in the library (only `remove-labels` / `remove-duplicate-notes`, which aren't entity deletes). Delete via `request DELETE`:

```bash
numa integrations request pipedrive DELETE "https://api.pipedrive.com/v1/deals/{id}" -m "Delete deal"
numa integrations request pipedrive DELETE "https://api.pipedrive.com/v1/persons/{id}" -m "Delete person"
numa integrations request pipedrive DELETE "https://api.pipedrive.com/v1/leads/{uuid}" -m "Delete lead"
# also: /v1/notes/{id}, /v1/activities/{id}, /v1/organizations/{id}
```

- `merge-persons` / `merge-deals`: the **target** record (`targetPersonId` / `targetDealId`) is kept and wins on conflict; the other is merged in and deleted.

## Pagination — cursor-based, via `request`

`list-deals` (and other lists) use **cursor** pagination, and `pipedream-call`
strips the cursor — you can't page past the first call. Use `request` and follow
`additional_data.next_cursor`:

```bash
numa integrations request pipedrive GET \
  "https://api.pipedrive.com/v1/deals?limit=500&status=open" -m "List open deals"
# next page: ...&cursor=<next_cursor>
```

`updatedSince` / `updatedUntil` take RFC3339 (`2026-01-01T10:20:00Z`).

## Direct API (`numa integrations request pipedrive`)

For pagination, deletes, the `add-labels` workaround, and anything the actions
don't cover. No special headers needed. Base: `https://api.pipedrive.com/v1/…`.
Search results come back under `data.items[].item`.

---
name: numa-voice
description: Add, edit, or manage Numa Voice SDR prospects and the daily call list. Use whenever the user asks to add/update a contact, prospect, lead, or "call" to their call list, today's calls, or SDR list — or to edit today_calls.json / master_prospects.json. Numa Voice is the outbound cold-calling cockpit; these JSON files in Company Files drive exactly what the SDR sees and dials, so the field names and phone format below MUST be followed precisely or the prospect renders blank and undiallable.
---

# Numa Voice — Prospect & Call List Skill

Numa Voice is the outbound SDR calling cockpit (`/voice`). The SDR's screen — the
"Today's calls" queue, the "Up next" focus card, and the Dial button — is rendered
**directly** from two JSON files in **Company Files** (the company knowledge base root,
`documents/company/`). There is no API and no validation layer: the frontend does a
raw `JSON.parse` and reads exact field names. **If you use the wrong field names or a
non-E.164 phone, the row renders blank with "no phone number on file" and cannot be
dialled — even though your file write "succeeded".**

So: follow the contract below exactly. Do not invent field names like `prospect_name`,
`prospect_phone`, `name`, or `company` — they are silently ignored.

## The two files (both in Company Files)

| File                    | Shape                                                                   | Purpose                                                                    |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `master_prospects.json` | a **bare JSON array** `[ Prospect, ... ]`                               | The full prospect roster (source of truth).                                |
| `today_calls.json`      | an **object** `{ "generated_at": "<ISO>", "calls": [ Prospect, ... ] }` | The ordered subset to call **today** — this is what the SDR cockpit shows. |

⚠️ Note the shapes differ: `master_prospects.json` is a bare array; `today_calls.json`
wraps the array under a `"calls"` key. Get this wrong and the list reads as empty.

There is also `sdr_playbook.json` (objection/hook content keyed by industry) — you do
not normally edit it.

## The `Prospect` object — exact fields (snake_case)

**Required** (every prospect must have all of these):

| Field                 | Type   | Notes                                                                  |
| --------------------- | ------ | ---------------------------------------------------------------------- |
| `company_name`        | string | Org name — the **bold headline** in the UI.                            |
| `contact_name`        | string | The person's full name — shown under the company.                      |
| `contact_title`       | string | Job title (use `""` if unknown).                                       |
| `phone`               | string | **E.164 format only** — see below. This is what gets dialled.          |
| `industry`            | string | Lowercase slug; used to pick the playbook. Use `"general"` if unknown. |
| `company_description` | string | Short blurb (`""` if unknown).                                         |
| `pain_hypothesis`     | string | One-line hypothesised pain point (`""` if unknown).                    |

**Optional** (set by the post-call processor; leave unset for new prospects):

| Field                        | Type     | Notes                                                                                                                                                                                                                                                                       |
| ---------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                     | string   | Pipeline status. **Set new prospects to `"pending"`.**                                                                                                                                                                                                                      |
| `call_outcome`               | string   | One of exactly `interested` \| `callback` \| `no_answer` \| `not_interested`. **The UI moves a prospect to the "Done" pile only when this is set** — do NOT set it for a prospect that hasn't been called. (`status` is NOT the same thing and does not affect Done/queue.) |
| `call_summary`               | string   | Free-text summary of the last call.                                                                                                                                                                                                                                         |
| `call_date`                  | string   | ISO timestamp of the last call.                                                                                                                                                                                                                                             |
| `callback_date`              | string   | ISO date, only when `call_outcome` is `callback`.                                                                                                                                                                                                                           |
| `qualified`                  | boolean  | Set true only when the SDR qualified the prospect.                                                                                                                                                                                                                          |
| `crm_record_id`              | string   | CRM link, set on qualification.                                                                                                                                                                                                                                             |
| `objections`                 | string[] | Objections the prospect raised on the last call (post-call processor).                                                                                                                                                                                                      |
| `next_steps`                 | string[] | Agreed next steps from the last call (post-call processor).                                                                                                                                                                                                                 |
| `call_quality_rating`        | number   | Call-quality rating 1–5 (post-call processor).                                                                                                                                                                                                                              |
| `call_quality_justification` | string   | One-line justification for the rating (post-call processor).                                                                                                                                                                                                                |
| `follow_up_talking_points`   | string[] | Two suggested talking points for the next call (post-call processor).                                                                                                                                                                                                       |

These five structured outcome fields (FEAT-165) are written as their OWN fields by the post-call processor — do NOT fold them into `call_summary`.

## Phone numbers: E.164 is mandatory

The Dial button validates against `^\+[1-9]\d{1,14}$` — a leading `+`, a country code,
no leading zero, digits only.

- ✅ `+6421677460`, `+14155550123`, `+442071234567`
- ❌ `021677460` (no `+`, leading 0), `(021) 677 460`, `021-677-460`

**Convert local numbers to E.164.** Drop the national trunk `0` and prepend the country
code:

- New Zealand `021 677 460` → `+6421677460`
- UK `020 7123 4567` → `+442071234567`
- US `(415) 555-0123` → `+14155550123`

**If you don't know the prospect's country, ask the user** rather than guessing — a wrong
country code dials the wrong number.

## How to add / edit a prospect (read-modify-write)

You read and write these files through **Company Files** (load the `numa-files-search`
skill for the exact file operations). Always do a full read-modify-write so you never
drop existing records:

1. **Download** `master_prospects.json` and `today_calls.json` from Company Files.
2. **Parse** the JSON. If a file doesn't exist yet, start from `[]` (master) or
   `{ "generated_at": "<today ISO>", "calls": [] }` (today).
3. **Append / update** the prospect using the exact field contract above. When adding a
   brand-new prospect: append a full `Prospect` to the `master_prospects.json` array, and
   — if they should be called today — also append the same object to
   `today_calls.json`'s `calls` array. Preserve all existing records.
4. **Upload** each file back to Company Files under the **same filename** (overwriting).
5. Tell the user what you added, and explicitly flag any required field you had to leave
   as a placeholder (e.g. unknown `company_name`/`industry`) so they can fill it in.

Never write a partial file (e.g. just the new record) — that destroys the existing list.

## Worked example — "add Tony Test, 021 677 460, to today's calls"

`021 677 460` is a NZ mobile → `+6421677460`. New prospect → `status: "pending"`, no
`call_outcome`. The user gave no company/industry, so use placeholders and flag them.

Object to append to **both** `master_prospects.json` (array) and `today_calls.json.calls`:

```json
{
  "company_name": "(unknown — please confirm)",
  "contact_name": "Tony Test",
  "contact_title": "",
  "phone": "+6421677460",
  "industry": "general",
  "company_description": "",
  "pain_hypothesis": "",
  "status": "pending"
}
```

## Common mistakes that make a prospect render blank / undiallable

- Using `prospect_name` / `name` instead of `contact_name`, or `prospect_phone` /
  `phone_number` instead of `phone`. → name and number render blank.
- Omitting `company_name`. → blank headline.
- A local phone like `021677460` instead of `+6421677460`. → "no phone number on file",
  Dial disabled.
- Making `master_prospects.json` an object `{ "prospects": [...] }` instead of a bare
  array. → roster reads as empty.
- Setting `call_outcome` (or relying on `status`) for a not-yet-called prospect. → it
  shows in the wrong group.

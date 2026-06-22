# Google Forms Integration Tips

All Google Forms calls go through the `numa integrations` CLI. Action keys follow
`google_forms-<name>` (`numa integrations pipedream-actions google_forms` lists
them). Auth prop is `googleForms` (camelCase): pass
`"googleForms": {"authProvisionId": "auto"}` on every call.

## Form IDs — use the edit-URL ID, not the responder URL

A form's ID is the segment in its **edit** URL — `https://docs.google.com/forms/d/{FORM_ID}/edit`
— and it's what `create-form` / `get-form` return as `formId`. The `responderUri`
the API returns uses a different obfuscated ID that **cannot** be used as `formId`.

## Actions

| Action                 | Writes? | Notes                                                                                                                   |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `create-form`          | yes     | `title` required, `documentTitle` optional. Returns `ret.formId` + `responderUri`.                                      |
| `get-form`             | no      | Returns the **full** form — `info`, `settings`, `responderUri`, **and `items[]`** (the questions).                      |
| `update-form-title`    | yes     | `formId` + `title`. batchUpdate under the hood; a success returns `replies: [{}]` (empty reply, normal — not an error). |
| `create-text-question` | yes     | Adds a short-answer / paragraph question.                                                                               |
| `list-form-responses`  | no      | See the empty-form gotcha below.                                                                                        |
| `get-form-response`    | no      | `formResponseId` is a `remoteOptions` prop.                                                                             |

## `get-form` returns the questions

`get-form` already includes the full `items[]` array — each item has `itemId`,
`title`, `description`, and `questionItem.question` (`questionId` + e.g.
`textQuestion`). You do **not** need a raw `request` just to read the question
structure. Reach for `numa integrations request` (below) only for what the actions
genuinely don't expose: response **pagination**, and creating **non-text**
question types (choice/scale/date) via `batchUpdate`.

## `create-text-question` — all five props are required

`formId`, `title`, `description`, `index`, and `paragraph` are all required by the
schema. `index` is zero-based: `0` inserts at the top, `N` (the current item
count) appends at the end — there's no "append" sentinel, so know how many items
exist. `paragraph`: `false` = short answer, `true` = multi-line (both are a
`textQuestion`). The result is a batchUpdate reply — the new IDs are at
`ret.replies[0].createItem.itemId` and `…createItem.questionId[0]` (hex); keep
them if you'll reference the item later.

## `list-form-responses` — no `ret` key when there are zero responses

On a form with no submissions the result is `{os, exports, t}` with **no `ret`**
(not an empty array). Check `status === "success"` and treat an absent `ret` as
"no responses" — don't index into `ret.responses`. (Similarly, the
`formResponseId` props-options returns an empty list for a form with no
responses — expected, not an error.)

## `create-form` summary string is buggy

`create-form` succeeds and returns the correct `ret.formId`, but its
`exports.$summary` always reads "Successfully created form with ID undefined".
Trust `ret.formId`, not the summary string.

## ⚠️ The Forms token has no Drive scopes — you can't delete forms

The `google_forms` OAuth token is scoped to `forms.googleapis.com` only. Any call
to `drive.googleapis.com` (to delete or trash a form) fails with **HTTP 403
`ACCESS_TOKEN_SCOPE_INSUFFICIENT` / "insufficient authentication scopes"**
(verified). There is no delete/trash action either. So **forms created here can't
be cleaned up through this integration** — the user must trash them in Google
Drive, or use a separately-connected `google_drive` integration. Mention this when
you create throwaway/test forms so they don't pile up invisibly.

## Direct API (`numa integrations request google_forms`)

For what the actions don't cover. No special headers needed.

```bash
# Paginate responses (the list-form-responses action exposes no page token)
numa integrations request google_forms GET \
  "https://forms.googleapis.com/v1/forms/{FORM_ID}/responses?pageSize=100" \
  -m "List form responses"
# follow nextPageToken from the response: ...&pageToken={TOKEN}

# Add non-text questions (choice / scale / date) via batchUpdate
numa integrations request google_forms POST \
  "https://forms.googleapis.com/v1/forms/{FORM_ID}:batchUpdate" \
  --body '{"requests":[ ... ]}' -m "Add a multiple-choice question"
```

The responses list endpoint returns `nextPageToken` when more pages exist — the
built-in action does not, so use `request` for large response sets.

## Workflow — create a form and add a question

```bash
numa integrations pipedream-call google_forms google_forms-create-form \
  --props '{"googleForms":{"authProvisionId":"auto"},"title":"My Survey","documentTitle":"My Survey"}' \
  -m "Create survey form"        # capture ret.formId

numa integrations pipedream-call google_forms google_forms-create-text-question \
  --props '{"googleForms":{"authProvisionId":"auto"},"formId":"FORM_ID","title":"Your name","description":"","index":0,"paragraph":false}' \
  -m "Add a name question"
```

Canva is connected via Pipedream. The five pre-built actions cover the basics, but two of
them are buggy — prefer `numa integrations request` (the raw Canva Connect API) for create
and rely on `waitForCompletion: false` for imports. Auth key is `canva` (lowercase):
`{"canva": {"authProvisionId": "auto"}, ...}`.

**The most powerful use of this integration is: generate a polished PPTX in the workspace
(PptxGenJS / python-pptx) → import it into Canva → return the edit link.** The result is a
fully editable Canva presentation with all text editable. See the workflow at the end.

## Available actions

| Action                           | What it does                               | Use it?                               |
| -------------------------------- | ------------------------------------------ | ------------------------------------- |
| `canva-list-designs`             | List designs                               | Yes — always `ownership: "any"`       |
| `canva-create-design`            | Create a blank design                      | **No — buggy. Use `request` instead** |
| `canva-upload-asset`             | Upload an image/file to the asset library  | Yes — works well                      |
| `canva-create-design-import-job` | Import a file (PPTX/PDF) as a new design   | Yes — `waitForCompletion: false`      |
| `canva-export-design`            | Export a design (pdf/jpg/png/pptx/gif/mp4) | Yes — needs `--stash-id NEW`          |

## 1. Listing designs — always `ownership: "any"`

`ownership: "owned"` silently returns 0 results for designs owned by a different team/account
(no error — just empty). Always pass `ownership: "any"`.

```
numa integrations request canva GET "https://api.canva.com/rest/v1/designs?ownership=any&sort_by=modified_descending&limit=100" -m "Fetch designs"
```

Pagination: pass the `continuation` value from a response back as `?continuation=<value>`.

## 2. Creating a design — use `request`, NOT the action

The `canva-create-design` action has a Pipedream bug (a `reloadProps` cycle that never fires
programmatically) and always returns `400 'name' must not be null`. The Canva API itself is
fine — call it directly:

```
numa integrations request canva POST "https://api.canva.com/rest/v1/designs" --body '{"design_type":{"type":"preset","name":"presentation"},"title":"My Design"}' -m "Create a Canva presentation"
```

- `type` must be `"preset"` or `"custom"` — **not** the preset name at the top level.
- Common preset names: `presentation`, `doc`, `whiteboard`, `instagram_post`, `a4_document`.
- Custom size: `{"design_type":{"type":"custom","width":1920,"height":1080},"title":"..."}`.
- Response contains `design.id`, `design.urls.edit_url`, `design.urls.view_url`.

## 3. Uploading assets

```
numa integrations pipedream-call canva canva-upload-asset --props '{"canva":{"authProvisionId":"auto"},"name":"My Asset","filePath":"/workdir/outputs/image.png","waitForCompletion":true}' -m "Upload asset to Canva"
```

- `filePath` **must** be under `/workdir/outputs/` or `/workdir/uploads/` (S3-synced).
  `/workdir/tmp/` paths fail silently.
- `waitForCompletion: true` returns the full asset object including `job.asset.id`.

## 4. Importing files as designs — `waitForCompletion: false`, prefer PPTX

```
numa integrations pipedream-call canva canva-create-design-import-job --props '{"canva":{"authProvisionId":"auto"},"title":"My Imported Design","filePath":"/workdir/outputs/deck.pptx","waitForCompletion":false}' -m "Import deck into Canva"
```

Always set `waitForCompletion: false`. With `true`, the action polls a URL it builds
incorrectly and returns `400 The jobId is invalid` — but the import itself still starts and
completes fine. Canva exposes **no** public endpoint to poll import-job status, so:

1. Call with `waitForCompletion: false` → you get `job.id` and `status: "in_progress"`.
2. Wait ~15s, then `canva-list-designs` with `ownership: "any"` and find the new design by title.

**PPTX vs PDF — prefer PPTX:**

|                        | PPTX import          | PDF import                |
| ---------------------- | -------------------- | ------------------------- |
| `design_types`         | `["presentation"]` ✓ | `["unknown"]`             |
| Text editable in Canva | **Yes** ✓            | No — rasterised/flattened |

Import a PPTX whenever the result should be editable. PDF imports are visual-only (you can
add new elements on top but cannot edit the imported content).

## 5. Exporting designs

```
numa integrations pipedream-call canva canva-export-design --props '{"canva":{"authProvisionId":"auto"},"designId":"DAFlFkicl_U","type":"pdf","size":"a4","waitForCompletion":true,"newFileName":"design.pdf"}' --stash-id NEW -m "Export design to PDF"
```

- `--stash-id NEW` is **required** (the export schema marks `stash` required).
- The file downloads to `/workdir/tmp/integrations-results/<newFileName>` — `cp` it to
  `/workdir/outputs/` if the user wants it as a deliverable.
- Formats: `pdf`, `jpg`, `png`, `pptx`, `gif`, `mp4`. `exportQuality: "pro"` may fail on
  designs containing premium Canva elements.

## 6. Brand templates & autofill — Canva Enterprise only

Both require a **Canva Enterprise** account. There are no Pipedream actions; they're
`request`-only.

- Listing brand templates (`GET /rest/v1/brand-templates`) returns **`200` with empty
  `items: []`** on non-Enterprise accounts — NOT a 403. An empty result does not mean "no
  templates exist", it means the tier doesn't expose them.
- Autofill (`POST /rest/v1/autofills`) returns `403 ... upgrading to Enterprise`.
- The correct request `type` once on Enterprise is `"create_from_brand_template"` (not
  `"brand_template"`).

If the user wants on-brand templated output but isn't on Enterprise, use the PPTX → import
workflow below — Numa designs the deck itself, so you control branding without autofill.

## 7. Public marketplace templates are NOT accessible

Templates from `canva.com/templates/...` (e.g. `EAGgRM_gc54`) live in a separate namespace
from brand templates and are **not reachable via the Connect API** — using such an ID returns
`404 Brand template with id '...' not found`. The user must open the URL in a browser and
click "Use this template" to copy it into their account as a normal design first.

## Recommended pattern: PPTX → Canva

```
1. Build a polished PPTX in the workspace (PptxGenJS / python-pptx) under /workdir/outputs/
2. Import via canva-create-design-import-job (waitForCompletion: false)
3. Wait ~15s, find the design via canva-list-designs (ownership: "any")
4. Return design.urls.edit_url to the user
```

This yields a fully editable Canva presentation (`design_types: ["presentation"]`, all text
editable) — the reliable way to hand the user a native, editable Canva file.

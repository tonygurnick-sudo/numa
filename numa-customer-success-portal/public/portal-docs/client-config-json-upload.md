# Client Config: JSON Upload

You can create or update a client configuration by uploading a JSON file directly from the portal.

- Create → "Create from JSON (Developers)": provide Client Name and a JSON file.
- Update → "Replace Config from JSON (Developers)": select the client and upload the JSON file.

Behavior
- Validation is strict: unknown fields are rejected.
- Update uses full replace semantics (same as the CLI write-config).
- A preview shows current vs new JSON before confirmation.

Tips
- Use "Download current JSON" from Update to grab a starting point for edits.
- Keep only the fields you want; optional fields can be omitted.

Troubleshooting
- If validation fails, check for typos, extra properties, or missing required fields (e.g., `clientAccountId`, `region`).

# Zoom Integration Tips

Before performing Zoom operations, establish context:

1. Use `zoom-view-user` to verify the connection and get the current user's ID. You need the user ID for many actions (e.g., listing meetings, recordings).
2. Use `zoom-list-meetings` with `type: "previous_meetings"` to find past meetings (needed for transcripts/participants)
3. For meetings with registration, resolve `meetingId` via `configure_props` to see available options

## Key Tips

- **Auth key varies by action:** Most actions use `zoom` as the auth key, but some use `app`. Check the schema's `name` field under `configurable_props`:
  - **Uses `zoom`:** `view-user`, `list-meetings`, `get-meeting-details`, `create-meeting`, `delete-meeting`, `update-meeting`, `list-channels`, `send-chat-message`, `get-meeting-transcript`, `list-call-recordings`, `list-user-call-logs`
  - **Uses `app`:** `list-past-meeting-participants`, `get-webinar-details`, `add-meeting-registrant`, `add-webinar-registrant`, `list-webinar-participants-report`, `list-past-webinar-qa`

  ```json
  // For most actions:
  {"zoom": {"authProvisionId": "auto"}, ...}

  // For participant/webinar actions:
  {"app": {"authProvisionId": "auto"}, ...}
  ```

- **Meeting ID parameter name and type varies:**
  - `get-meeting-details` uses `meeting_id` (integer): `{"meeting_id": 91456024523}`
  - Most other actions use `meetingId` (string): `{"meetingId": "91456024523"}`
  - Always check the schema for the exact parameter name and type

- **DO NOT use `get-meeting-transcript`:** This action is bugged (Zoom API issue) and will ALWAYS return error code 3322, even when a transcript exists. Never use it.

- **Getting meeting transcripts — use the recordings API via `proxy_request`:**
  1. **Find meetings with recordings:**

     ```
     proxy_request → GET https://api.zoom.us/v2/users/me/recordings?from=YYYY-MM-DD&to=YYYY-MM-DD
     ```

     Set `from` and `to` to the desired date range (max 30 days apart, format `YYYY-MM-DD`). Use `integration_slug: "zoom"`. Look for entries in `recording_files` with `"file_type": "TRANSCRIPT"`.

  2. **Get transcript for a specific meeting:**

     ```
     proxy_request → GET https://api.zoom.us/v2/meetings/{meetingId}/recordings?include_fields=download_access_token
     ```

     **IMPORTANT:** Always include `?include_fields=download_access_token` — without it, the transcript cannot be downloaded.

  3. **Transcript files are auto-downloaded:** When the recordings response contains transcript entries and a `download_access_token`, the VTT file is automatically downloaded to `/workdir/tmp/integrations-results/transcript-{meetingId}.vtt` (scratch — hidden from the user's Files page). Read the file directly — no additional download step needed. If the user asked for the transcript as a deliverable, `cp` it to `/workdir/outputs/`.

  4. **Limitations:**
     - The recordings API may only return meetings the connected user **hosted** (not meetings they attended as a participant)
     - Cloud recording with audio transcription must have been enabled for the meeting
     - `zoom-list-call-recordings` is for **Zoom Phone** call recordings, not meeting recordings — do not confuse the two

- **Zoom Phone actions require a Zoom Phone license:** `list-call-recordings` and `list-user-call-logs` will return 403 Forbidden if the account doesn't have Zoom Phone enabled.

- **Webinar actions require the Webinar add-on:** Actions like `get-webinar-details`, `add-webinar-registrant`, etc. require the Zoom Webinar add-on. If not available, `configure_props` will return an empty array.

- **Meeting types for `list-meetings`:**
  - `scheduled` (default): All valid previous, live, and upcoming meetings
  - `live`: Currently ongoing meetings only
  - `upcoming`: Upcoming meetings including live ones
  - `previous_meetings`: Past meetings (use this to find meetings with recordings/transcripts)

- **Creating meetings — all fields optional except auth:** You can create a minimal meeting with just auth, and Zoom will use account defaults:

  ```json
  {
    "zoom": { "authProvisionId": "auto" },
    "topic": "Meeting title",
    "type": 2,
    "duration": 60
  }
  ```

  Type values: `1`=Instant, `2`=Scheduled, `3`=Recurring (no fixed time), `8`=Recurring (fixed time)

- **Deleting meetings — suppress notifications:** Set `scheduleForReminder: false` and `cancelMeetingReminder: false` to delete without sending emails:

  ```json
  {
    "zoom": { "authProvisionId": "auto" },
    "meetingId": "12345678901",
    "scheduleForReminder": false,
    "cancelMeetingReminder": false
  }
  ```

- **Chat messages — `to_contact` OR `to_channel`:** Provide exactly one of these. `to_contact` is an email address; `to_channel` is the channel ID from `list-channels`.

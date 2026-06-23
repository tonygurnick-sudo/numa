# Zoom Integration Tips

All Zoom calls go through the `numa integrations` CLI. Action keys below are real
(`numa integrations pipedream-actions zoom` lists them). The auth prop is always
required — pass `{"zoom": {"authProvisionId": "auto"}}` (or `app`, see below) and
the proxy resolves the user's connected account.

Before performing Zoom operations, establish context:

1. Run `zoom-view-user` to verify the connection and get the current user's ID. You need the user ID for many actions (e.g., listing meetings, recordings):

   ```bash
   numa integrations pipedream-call zoom zoom-view-user \
     --props '{"zoom":{"authProvisionId":"auto"}}' \
     -m "Checking Zoom connection"
   ```

2. Run `zoom-list-meetings` with `type: "previous_meetings"` to find past meetings (needed for transcripts/participants).
3. For meetings with registration, resolve `meetingId` via `numa integrations pipedream-props-options zoom <action-key> meetingId --zoom '{"authProvisionId":"auto"}'` to see available options.

## Key Tips

- **Auth key varies by action:** Most actions use `zoom` as the auth key, but some use `app`. Check the schema's `name` field (`numa integrations pipedream-props zoom <action-key>`):
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

- **Getting meeting transcripts — use the recordings API via `numa integrations request`:**
  1. **Find meetings with recordings:**

     ```bash
     numa integrations request zoom GET \
       "https://api.zoom.us/v2/users/me/recordings?from=YYYY-MM-DD&to=YYYY-MM-DD" \
       -m "Finding Zoom recordings"
     ```

     Set `from` and `to` to the desired date range (max 30 days apart, format `YYYY-MM-DD`). Look for entries in `recording_files` with `"file_type": "TRANSCRIPT"`.

  2. **Get transcript for a specific meeting:**

     ```bash
     numa integrations request zoom GET \
       "https://api.zoom.us/v2/meetings/{meetingId}/recordings?include_fields=download_access_token" \
       -m "Fetching meeting transcript"
     ```

     **IMPORTANT:** Always include `?include_fields=download_access_token` — without it, the transcript cannot be downloaded.

  3. **Transcript files are delivered automatically:** When the recordings response contains transcript entries and a `download_access_token`, the VTT file is downloaded for you — reference the `downloaded_files` path in the result (default `/workdir/tmp/integrations-results/`, scratch — hidden from the user's Files page). Read it directly — no additional download step needed. If the user asked for the transcript as a deliverable, `cp` it to `/workdir/outputs/`.

  4. **Limitations:**
     - The recordings API may only return meetings the connected user **hosted** (not meetings they attended as a participant)
     - Cloud recording with audio transcription must have been enabled for the meeting
     - `zoom-list-call-recordings` is for **Zoom Phone** call recordings, not meeting recordings — do not confuse the two

- **Zoom Phone actions require a Zoom Phone license:** `list-call-recordings` and `list-user-call-logs` will return 403 Forbidden if the account doesn't have Zoom Phone enabled.

- **Webinar actions require the Webinar add-on:** Actions like `get-webinar-details`, `add-webinar-registrant`, etc. require the Zoom Webinar add-on. If not available, `pipedream-props-options` will return an empty array.

- **Meeting types for `list-meetings`:**
  - `scheduled` (default): All valid previous, live, and upcoming meetings
  - `live`: Currently ongoing meetings only
  - `upcoming`: Upcoming meetings including live ones
  - `previous_meetings`: Past meetings (use this to find meetings with recordings/transcripts)

- **Creating meetings — all fields optional except auth:** You can create a minimal meeting with just auth, and Zoom will use account defaults:

  ```bash
  numa integrations pipedream-call zoom zoom-create-meeting \
    --props '{"zoom":{"authProvisionId":"auto"},"topic":"Meeting title","type":2,"duration":60}' \
    -m "Creating a Zoom meeting"
  ```

  Type values: `1`=Instant, `2`=Scheduled, `3`=Recurring (no fixed time), `8`=Recurring (fixed time)

- **Deleting meetings — suppress notifications:** Set `scheduleForReminder: false` and `cancelMeetingReminder: false` to delete without sending emails:

  ```bash
  numa integrations pipedream-call zoom zoom-delete-meeting \
    --props '{"zoom":{"authProvisionId":"auto"},"meetingId":"12345678901","scheduleForReminder":false,"cancelMeetingReminder":false}' \
    -m "Deleting a Zoom meeting"
  ```

- **Chat messages — `to_contact` OR `to_channel`:** Provide exactly one of these. `to_contact` is an email address; `to_channel` is the channel ID from `list-channels`.

import { axios } from "@pipedream/platform";

export default {
  key: "slack-upload-files",
  name: "Upload Files (one message)",
  description:
    "Post a SINGLE Slack message with one or more file attachments (images, PDFs, etc.) to a channel, DM, or thread. Provide each file as a downloadable URL plus a filename; the message text is the initial comment. Unlike the standard single-file upload, every file lands in ONE message. [Slack files.completeUploadExternal]",
  version: "0.0.2",
  type: "action",
  props: {
    slack: {
      type: "app",
      app: "slack",
    },
    conversation: {
      type: "string",
      label: "Conversation",
      description:
        "Channel ID (C…), DM channel (D…), or user ID (U…) to post the files to.",
    },
    fileUrls: {
      type: "string[]",
      label: "File URLs",
      description:
        "Downloadable URLs of the files to attach (short-lived/presigned URLs are fine — each is fetched once, immediately).",
    },
    filenames: {
      type: "string[]",
      label: "Filenames",
      description:
        "Filename (with extension) for each file, same order as File URLs. Drives Slack's type detection and how the attachment renders (e.g. chart.png). Optional — defaults to the last URL path segment.",
      optional: true,
    },
    initialComment: {
      type: "string",
      label: "Message",
      description: "Message text posted alongside the files (Slack mrkdwn).",
      optional: true,
    },
    threadTs: {
      type: "string",
      label: "Thread timestamp",
      description:
        "Optional parent message ts — attaches the files as a reply in that thread.",
      optional: true,
    },
  },
  async run({ $ }) {
    const token = this.slack.$auth.oauth_access_token;
    const urls = this.fileUrls || [];
    if (urls.length === 0) {
      throw new Error("Provide at least one file URL in fileUrls.");
    }
    const names = this.filenames || [];

    const uploaded = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];

      // Fetch the bytes once.
      const download = await axios($, {
        url,
        method: "GET",
        responseType: "arraybuffer",
        returnFullResponse: true,
      });
      const bytes = Buffer.from(download.data);
      const urlName = decodeURIComponent(
        new URL(url).pathname.split("/").pop() || "",
      );
      const filename = names[i] || urlName || `file-${i + 1}.bin`;

      // 1) Reserve an external upload URL for this file.
      const reserve = await axios($, {
        url: "https://slack.com/api/files.getUploadURLExternal",
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        params: { filename, length: bytes.length },
      });
      if (!reserve?.ok) {
        throw new Error(
          `files.getUploadURLExternal failed for "${filename}": ${reserve?.error}`,
        );
      }

      // 2) POST the raw bytes to the temp upload URL (URL itself is the auth).
      await axios($, {
        url: reserve.upload_url,
        method: "POST",
        data: bytes,
        headers: { "Content-Type": "application/octet-stream" },
      });

      uploaded.push({ id: reserve.file_id, title: filename });
    }

    // 3) Finalise — one message carrying every file. completeUploadExternal
    // wants form-urlencoded params with `files` as a JSON STRING; a JSON body
    // parses `files` but silently drops channel_id/initial_comment (the file
    // uploads but never shares to the channel).
    const form = new URLSearchParams();
    form.append("files", JSON.stringify(uploaded));
    form.append("channel_id", this.conversation);
    if (this.initialComment) form.append("initial_comment", this.initialComment);
    if (this.threadTs) form.append("thread_ts", this.threadTs);

    const complete = await axios($, {
      url: "https://slack.com/api/files.completeUploadExternal",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: form.toString(),
    });
    if (!complete?.ok) {
      throw new Error(`files.completeUploadExternal failed: ${complete?.error}`);
    }

    $.export(
      "$summary",
      `Posted ${uploaded.length} file(s) to ${this.conversation}`,
    );
    return complete;
  },
};

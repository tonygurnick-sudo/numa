import { axios } from "@pipedream/platform";
import FormData from "form-data";

export default {
  key: "pipedrive-add-file",
  name: "Add File",
  description:
    "Upload a file and attach it to a Pipedrive deal, person, organization, lead, activity, product or project. Provide the file as a downloadable URL. [See the documentation](https://developers.pipedrive.com/docs/api/v1/Files#addFile)",
  version: "0.0.1",
  type: "action",
  props: {
    pipedrive: {
      type: "app",
      app: "pipedrive",
    },
    fileUrl: {
      type: "string",
      label: "File URL",
      description:
        "Downloadable URL of the file to upload (short-lived/presigned URLs are fine — the file is fetched once, immediately)",
    },
    filename: {
      type: "string",
      label: "Filename",
      description:
        "Filename (including extension) to store in Pipedrive. Defaults to the name from the download response or the last URL path segment.",
      optional: true,
    },
    dealId: {
      type: "integer",
      label: "Deal ID",
      description: "ID of the deal to associate the file with",
      optional: true,
    },
    personId: {
      type: "integer",
      label: "Person ID",
      description: "ID of the person to associate the file with",
      optional: true,
    },
    orgId: {
      type: "integer",
      label: "Organization ID",
      description: "ID of the organization to associate the file with",
      optional: true,
    },
    leadId: {
      type: "string",
      label: "Lead ID",
      description: "UUID of the lead to associate the file with",
      optional: true,
    },
    activityId: {
      type: "integer",
      label: "Activity ID",
      description: "ID of the activity to associate the file with",
      optional: true,
    },
    productId: {
      type: "integer",
      label: "Product ID",
      description: "ID of the product to associate the file with",
      optional: true,
    },
    projectId: {
      type: "integer",
      label: "Project ID",
      description: "ID of the project to associate the file with",
      optional: true,
    },
  },
  async run({ $ }) {
    const associations = {
      deal_id: this.dealId,
      person_id: this.personId,
      org_id: this.orgId,
      lead_id: this.leadId,
      activity_id: this.activityId,
      product_id: this.productId,
      project_id: this.projectId,
    };
    const provided = Object.entries(associations).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    );
    if (provided.length === 0) {
      throw new Error(
        "Provide at least one of dealId, personId, orgId, leadId, activityId, productId or projectId — Pipedrive requires the file to be associated with an item.",
      );
    }

    const download = await axios($, {
      url: this.fileUrl,
      method: "GET",
      responseType: "arraybuffer",
      returnFullResponse: true,
    });

    const headerName = contentDispositionFilename(
      download.headers?.["content-disposition"],
    );
    const urlName = decodeURIComponent(
      new URL(this.fileUrl).pathname.split("/").pop() || "",
    );
    const name = this.filename || headerName || urlName || "upload.bin";
    const contentType =
      download.headers?.["content-type"] || "application/octet-stream";

    const form = new FormData();
    form.append("file", Buffer.from(download.data), {
      filename: name,
      contentType,
    });
    for (const [key, value] of provided) {
      form.append(key, String(value));
    }

    const { api_domain: apiDomain, oauth_access_token: token } =
      this.pipedrive.$auth;
    const response = await axios($, {
      url: `${apiDomain}/api/v1/files`,
      method: "POST",
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${token}`,
      },
      data: form,
    });

    const file = response?.data ?? {};
    const attachedTo = provided
      .map(([key, value]) => `${key}=${value}`)
      .join(", ");
    $.export(
      "$summary",
      `Uploaded "${file.name ?? name}" (file ID: ${file.id ?? "unknown"}) to Pipedrive (${attachedTo})`,
    );
    return response;
  },
};

function contentDispositionFilename(disposition) {
  if (!disposition) return "";
  const star = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, ""));
    } catch {
      /* fall through to plain filename */
    }
  }
  const plain = disposition.match(/filename=["']?([^"';]+)["']?/i);
  return plain ? plain[1].trim() : "";
}

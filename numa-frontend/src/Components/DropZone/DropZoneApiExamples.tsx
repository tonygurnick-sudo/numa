import { useState } from 'react';
import { Nav, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface DropZoneApiExamplesProps {
  uuid: string;
  authMode: string;
}

type Tab = 'curl' | 'python' | 'javascript';

export const DropZoneApiExamples: React.FC<DropZoneApiExamplesProps> = ({ uuid, authMode }) => {
  const { t } = useTranslation('files');
  const [activeTab, setActiveTab] = useState<Tab>('curl');
  const [copied, setCopied] = useState(false);

  const baseUrl = window.location.origin;

  const authHeader = authMode !== 'none' ? '\n  -H "Authorization: Bearer $TOKEN" \\\n' : '\n';

  const authNote =
    authMode !== 'none'
      ? `# First, authenticate to get a token:\n# POST ${baseUrl}/api/shared/${uuid}/auth\n# Body: {"passcode": "YOUR_PASSCODE"}\n# Save the "token" from the response\n\n`
      : '';

  const examples: Record<Tab, string> = {
    curl: `${authNote}# Upload a file to the drop zone
# Step 1: Get presigned upload URL
curl -X POST "${baseUrl}/api/shared/${uuid}/upload" \\
  -H "Content-Type: application/json" \\${authHeader}  -d '{"filename": "report.pdf", "content_type": "application/pdf", "size_bytes": 1048576}'

# Step 2: Upload file using the presigned URL (from step 1 response)
curl -X PUT "$UPLOAD_URL" \\
  -H "Content-Type: application/pdf" \\
  --data-binary @report.pdf

# Step 3: Confirm the upload
curl -X POST "${baseUrl}/api/shared/${uuid}/upload/confirm" \\
  -H "Content-Type: application/json" \\${authHeader}  -d '{"file_id": "$FILE_ID", "filename": "report.pdf", "size_bytes": 1048576}'`,

    python: `${
      authMode !== 'none'
        ? `import requests

# Step 0: Authenticate
auth_resp = requests.post(
    "${baseUrl}/api/shared/${uuid}/auth",
    json={"passcode": "YOUR_PASSCODE"}
)
token = auth_resp.json()["token"]
headers = {"Authorization": f"Bearer {token}"}

`
        : `import requests

headers = {}

`
    }# Step 1: Get presigned upload URL
import os
filepath = "report.pdf"
filesize = os.path.getsize(filepath)

resp = requests.post(
    "${baseUrl}/api/shared/${uuid}/upload",
    json={
        "filename": os.path.basename(filepath),
        "content_type": "application/pdf",
        "size_bytes": filesize,
    },
    headers=headers,
)
data = resp.json()

# Step 2: Upload file
with open(filepath, "rb") as f:
    requests.put(
        data["upload_url"],
        data=f,
        headers={"Content-Type": "application/pdf"},
    )

# Step 3: Confirm upload
requests.post(
    "${baseUrl}/api/shared/${uuid}/upload/confirm",
    json={
        "file_id": data["file_id"],
        "filename": os.path.basename(filepath),
        "size_bytes": filesize,
    },
    headers=headers,
)
print("Upload complete!")`,

    javascript: `${
      authMode !== 'none'
        ? `// Step 0: Authenticate
const authResp = await fetch("${baseUrl}/api/shared/${uuid}/auth", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ passcode: "YOUR_PASSCODE" }),
});
const { token } = await authResp.json();
const headers = { Authorization: \`Bearer \${token}\` };

`
        : `const headers = {};

`
    }// Step 1: Get presigned upload URL
const file = document.getElementById("fileInput").files[0];
const resp = await fetch("${baseUrl}/api/shared/${uuid}/upload", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify({
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    size_bytes: file.size,
  }),
});
const { upload_url, file_id } = await resp.json();

// Step 2: Upload file to S3
await fetch(upload_url, {
  method: "PUT",
  headers: { "Content-Type": file.type || "application/octet-stream" },
  body: file,
});

// Step 3: Confirm upload
await fetch("${baseUrl}/api/shared/${uuid}/upload/confirm", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify({
    file_id,
    filename: file.name,
    size_bytes: file.size,
  }),
});
console.log("Upload complete!");`,
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(examples[activeTab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-2">
        <h6 className="mb-0">{t('dropzones.apiExamples')}</h6>
        <Button variant={copied ? 'success' : 'outline-secondary'} size="sm" onClick={handleCopy}>
          <i className={`bi ${copied ? 'bi-check' : 'bi-clipboard'} me-1`} />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <Nav variant="tabs" className="mb-0">
        <Nav.Item>
          <Nav.Link active={activeTab === 'curl'} onClick={() => setActiveTab('curl')}>
            {t('dropzones.apiTabCurl')}
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link active={activeTab === 'python'} onClick={() => setActiveTab('python')}>
            {t('dropzones.apiTabPython')}
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link active={activeTab === 'javascript'} onClick={() => setActiveTab('javascript')}>
            {t('dropzones.apiTabJavascript')}
          </Nav.Link>
        </Nav.Item>
      </Nav>

      <pre
        className="p-3 mb-0 rounded-bottom"
        style={{
          backgroundColor: '#1e1e1e',
          color: '#d4d4d4',
          fontSize: '0.8rem',
          maxHeight: '300px',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        <code>{examples[activeTab]}</code>
      </pre>
    </div>
  );
};

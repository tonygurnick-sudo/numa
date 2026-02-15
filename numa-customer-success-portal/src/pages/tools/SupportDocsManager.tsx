import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Form,
  ProgressBar,
  Spinner,
  Tab,
  Table,
  Tabs,
} from 'react-bootstrap'
import { ArrowLeft, CloudUpload, Download, FileEarmarkText, Trash } from 'react-bootstrap-icons'
import { useNavigate } from 'react-router-dom'
import { GroupedClientSelector } from '@/components/tools/GroupedClientSelector'
import { useAuth } from '@/contexts/AuthContext'
import { activityService } from '@/services/activityService'
import { clientService } from '@/services/clientService'
import { supportDocsService, type MasterSupportDoc } from '@/services/supportDocsService'
import type { Client } from '@/types'

type DeployState = 'idle' | 'queued' | 'running' | 'success' | 'failed'

interface ClientDeployStatus {
  state: DeployState
  message: string
  progress: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

export default function SupportDocsManager() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('manage')
  const [masterDocs, setMasterDocs] = useState<MasterSupportDoc[]>([])
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const [clients, setClients] = useState<Client[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [selectedClientNames, setSelectedClientNames] = useState<string[]>([])
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [deployStatuses, setDeployStatuses] = useState<Record<string, ClientDeployStatus>>({})

  const selectedClients = useMemo(
    () => clients.filter((client) => selectedClientNames.includes(client.name)),
    [clients, selectedClientNames],
  )

  const loadMasterDocs = async () => {
    setLoadingDocs(true)
    setDocsError(null)
    try {
      const docs = await supportDocsService.listMasterDocs()
      setMasterDocs(docs)
    } catch (error) {
      setDocsError(error instanceof Error ? error.message : 'Failed to load master support docs.')
    } finally {
      setLoadingDocs(false)
    }
  }

  const loadClients = async () => {
    setLoadingClients(true)
    try {
      const allClients = await clientService.getAllClients()
      setClients(allClients)
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : 'Failed to load clients.')
    } finally {
      setLoadingClients(false)
    }
  }

  useEffect(() => {
    loadMasterDocs()
    loadClients()
  }, [])

  const handleUploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) {
      return
    }
    setUploading(true)
    setDocsError(null)
    try {
      for (const file of Array.from(files)) {
        await supportDocsService.uploadMasterDoc(file, user?.email)
      }
      await loadMasterDocs()
    } catch (error) {
      setDocsError(error instanceof Error ? error.message : 'Failed to upload support documents.')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const handleDeleteDoc = async (key: string) => {
    setDeletingKey(key)
    setDocsError(null)
    try {
      await supportDocsService.deleteMasterDoc(key)
      await loadMasterDocs()
    } catch (error) {
      setDocsError(error instanceof Error ? error.message : 'Failed to delete support document.')
    } finally {
      setDeletingKey(null)
    }
  }

  const updateDeployStatus = (clientName: string, status: Partial<ClientDeployStatus>) => {
    setDeployStatuses((prev) => ({
      ...prev,
      [clientName]: {
        state: status.state ?? prev[clientName]?.state ?? 'idle',
        message: status.message ?? prev[clientName]?.message ?? '',
        progress: status.progress ?? prev[clientName]?.progress ?? 0,
      },
    }))
  }

  const deployToClients = async (targets: Client[]) => {
    setDeploying(true)
    setDeployError(null)

    const initialStatuses: Record<string, ClientDeployStatus> = {}
    for (const client of targets) {
      initialStatuses[client.name] = { state: 'queued', message: 'Waiting...', progress: 0 }
    }
    setDeployStatuses(initialStatuses)

    try {
      const docsToDeploy = await supportDocsService.listMasterDocs()

      for (const client of targets) {
        updateDeployStatus(client.name, { state: 'running', message: 'Starting deployment...', progress: 0 })

        try {
          const result = await supportDocsService.deployToClient(
            client.name,
            client.config.clientAccountId,
            client.config.region,
            docsToDeploy,
            (progress) => {
              const percent = progress.total === 0 ? 100 : Math.round((progress.current / progress.total) * 100)
              updateDeployStatus(client.name, {
                state: 'running',
                message: progress.message,
                progress: percent,
              })
            },
          )

          updateDeployStatus(client.name, {
            state: 'success',
            progress: 100,
            message: `Uploaded ${result.uploadedCount} objects, cleaned ${result.cleanedCount}, KB ${
              result.kbCreated ? 'created' : 'verified'
            }.`,
          })

          await activityService.logActivity({
            type: 'system',
            action: 'deployed',
            resourceType: 'support-docs',
            resourceId: client.name,
            details: {
              metadata: {
                uploadedCount: result.uploadedCount,
                cleanedCount: result.cleanedCount,
                kbCreated: result.kbCreated,
              },
            },
            success: true,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Deployment failed'
          updateDeployStatus(client.name, {
            state: 'failed',
            progress: 100,
            message,
          })
          await activityService.logActivity({
            type: 'system',
            action: 'deployed',
            resourceType: 'support-docs',
            resourceId: client.name,
            details: {
              metadata: {
                error: message,
              },
            },
            success: false,
            errorMessage: message,
          })
        }
      }
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : 'Bulk deployment failed.')
    } finally {
      setDeploying(false)
    }
  }

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h1 className="h3 mb-1 d-flex align-items-center">
            <FileEarmarkText className="me-2" />
            Support Docs Manager
          </h1>
          <p className="text-muted mb-0">
            Manage master Numa support docs and deploy them into client knowledge bases.
          </p>
        </div>
        <Button variant="outline-secondary" onClick={() => navigate('/tools')}>
          <ArrowLeft className="me-1" />
          Back to Tools
        </Button>
      </div>

      <Tabs activeKey={activeTab} onSelect={(tab) => setActiveTab(tab || 'manage')} className="mb-4">
        <Tab eventKey="manage" title="Manage Docs">
          <Card className="border-0 shadow-sm">
            <Card.Body>
              {docsError && <Alert variant="danger">{docsError}</Alert>}
              <div className="d-flex flex-wrap gap-2 mb-3">
                <Button variant="outline-primary" onClick={loadMasterDocs} disabled={loadingDocs || uploading}>
                  {loadingDocs ? (
                    <>
                      <Spinner size="sm" animation="border" className="me-2" />
                      Refreshing
                    </>
                  ) : (
                    'Refresh'
                  )}
                </Button>
                <Form.Group className="mb-0">
                  <Form.Control
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.txt,.md,.html,.htm"
                    onChange={handleUploadFiles}
                    disabled={uploading}
                  />
                </Form.Group>
              </div>
              <p className="text-muted small">
                Uploaded files become the canonical master set for deployments to client `documents/numa-support/`.
              </p>

              {loadingDocs ? (
                <div className="text-center py-5">
                  <Spinner animation="border" />
                </div>
              ) : masterDocs.length === 0 ? (
                <Alert variant="warning" className="mb-0">
                  No master documents uploaded yet.
                </Alert>
              ) : (
                <Table bordered hover responsive className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th style={{ width: '130px' }}>Size</th>
                      <th style={{ width: '200px' }}>Uploaded By</th>
                      <th style={{ width: '220px' }}>Last Modified</th>
                      <th style={{ width: '120px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {masterDocs.map((doc) => (
                      <tr key={doc.key}>
                        <td>{doc.key}</td>
                        <td>{formatBytes(doc.size)}</td>
                        <td>{doc.uploadedBy || '—'}</td>
                        <td>{doc.lastModified ? new Date(doc.lastModified).toLocaleString() : 'Unknown'}</td>
                        <td>
                          <Button
                            size="sm"
                            variant="outline-danger"
                            onClick={() => handleDeleteDoc(doc.key)}
                            disabled={deletingKey === doc.key}
                          >
                            <Trash className="me-1" />
                            {deletingKey === doc.key ? 'Deleting' : 'Delete'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Tab>

        <Tab eventKey="deploy" title="Deploy to Clients">
          <Card className="border-0 shadow-sm">
            <Card.Body>
              {deployError && <Alert variant="danger">{deployError}</Alert>}

              <div className="mb-3">
                <GroupedClientSelector
                  clients={clients}
                  selectedClientNames={selectedClientNames}
                  onClientToggle={(name) =>
                    setSelectedClientNames((prev) =>
                      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
                    )
                  }
                  onSelectClients={setSelectedClientNames}
                  disabled={deploying}
                  loading={loadingClients}
                />
              </div>

              <div className="d-flex flex-wrap gap-2 mb-2">
                <Button
                  variant="primary"
                  onClick={() => deployToClients(selectedClients)}
                  disabled={deploying || selectedClients.length === 0}
                >
                  <CloudUpload className="me-2" />
                  Deploy Selected ({selectedClients.length})
                </Button>
                <Button
                  variant="outline-primary"
                  onClick={() => deployToClients(clients)}
                  disabled={deploying || clients.length === 0}
                >
                  <Download className="me-2" />
                  Deploy All ({clients.length})
                </Button>
                <Badge bg="secondary" className="align-self-center">
                  Master Docs: {masterDocs.length}
                </Badge>
              </div>

              <p className="text-muted small mb-4">
                Deploy uses staged sync: upload new docs first, then clean orphans, then ensure KB record.
              </p>

              {Object.keys(deployStatuses).length > 0 && (
                <Table bordered responsive className="align-middle mb-0" style={{ tableLayout: 'fixed' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '180px' }}>Client</th>
                      <th style={{ width: '100px' }}>Status</th>
                      <th style={{ width: '220px' }}>Progress</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(deployStatuses).map(([clientName, status]) => (
                      <tr key={clientName}>
                        <td>{clientName}</td>
                        <td>
                          <Badge
                            bg={
                              status.state === 'success'
                                ? 'success'
                                : status.state === 'failed'
                                  ? 'danger'
                                  : status.state === 'running'
                                    ? 'primary'
                                    : status.state === 'queued'
                                      ? 'warning'
                                      : 'secondary'
                            }
                          >
                            {status.state}
                          </Badge>
                        </td>
                        <td>
                          <ProgressBar now={status.progress} label={`${status.progress}%`} />
                        </td>
                        <td>{status.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Tab>
      </Tabs>
    </div>
  )
}

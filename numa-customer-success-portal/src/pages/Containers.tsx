import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Card, Col, Form, InputGroup, Row, Table, Button, Modal, Spinner } from 'react-bootstrap'
import { BoxSeam, Search, Tag, Pencil } from 'react-bootstrap-icons'
import { ECRImage } from '@/types'
import { ecrService } from '@/services/ecrService'
import { setImageMetadata } from '@/services/imageTagService'

export default function Containers() {
  const [images, setImages] = useState<ECRImage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editingImage, setEditingImage] = useState<ECRImage | null>(null)
  const [customName, setCustomName] = useState('')
  const [description, setDescription] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await ecrService.getAllImages()
        setImages(data)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load images')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    if (!term) return images
    return images.filter(img =>
      img.tag.toLowerCase().includes(term) ||
      (img.customName || '').toLowerCase().includes(term) ||
      (img.description || '').toLowerCase().includes(term) ||
      (img.gitCommit || '').toLowerCase().includes(term) ||
      (img.gitBranch || '').toLowerCase().includes(term)
    )
  }, [search, images])

  const handleEditImage = async (img: ECRImage) => {
    setEditingImage(img)
    setCustomName(img.customName || '')
    setDescription(img.description || '')
  }

  const handleSaveMetadata = async () => {
    if (!editingImage) return
    setIsSaving(true)
    try {
      await setImageMetadata({
        imageTag: editingImage.tag,
        digest: editingImage.digest,
        customName: customName.trim() || undefined,
        description: description.trim() || undefined,
      })

      // Clear cache and refresh images to show updated metadata
      ecrService.clearCache()
      const data = await ecrService.getAllImages()
      setImages(data)
      setEditingImage(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save metadata')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCloseModal = () => {
    setEditingImage(null)
    setCustomName('')
    setDescription('')
  }

  const formatSize = (sizeMb: number) => (sizeMb > 1024 ? `${(sizeMb / 1024).toFixed(1)} GB` : `${sizeMb} MB`)

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h2 className="mb-0 d-flex align-items-center">
          <BoxSeam className="me-2" />
          Container Images
        </h2>
        <Badge bg="secondary">{images.length}</Badge>
      </div>

      {error && (
        <Alert variant="danger">
          {error}
        </Alert>
      )}

      <Row className="mb-3">
        <Col md={6}>
          <InputGroup>
            <InputGroup.Text>
              <Search />
            </InputGroup.Text>
            <Form.Control
              placeholder="Search by tag, name, commit, or branch..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </InputGroup>
        </Col>
        <Col md={6} className="text-end text-muted">
          {loading ? 'Loading…' : `Showing ${filtered.length} of ${images.length}`}
        </Col>
      </Row>

      <Card className="border shadow-sm">
        <Card.Body className="p-0">
          <Table hover responsive className="mb-0">
            <thead>
              <tr>
                <th>Tag / Name</th>
                <th>Digest</th>
                <th>Size</th>
                <th>Pushed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(img => (
                <tr key={img.digest}>
                  <td>
                    <div>
                      {img.customName && (
                        <div>
                          <strong>{img.customName}</strong>
                          <div className="small text-muted">Tag: {img.tag}</div>
                        </div>
                      )}
                      {!img.customName && (
                        <Badge bg={img.tag === 'latest' ? 'primary' : img.tag.startsWith('v') ? 'success' : img.tag.includes('hotfix') ? 'warning' : 'secondary'}>
                          <Tag size={12} className="me-1" />
                          {img.tag}
                        </Badge>
                      )}
                      {img.description && (
                        <div className="small text-muted mt-1">{img.description}</div>
                      )}
                    </div>
                  </td>
                  <td>
                    <code className="small text-break">{img.digest}</code>
                  </td>
                  <td>{formatSize(img.sizeMb)}</td>
                  <td>{new Date(img.pushedAt).toLocaleString()}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      onClick={() => handleEditImage(img)}
                    >
                      <Pencil size={12} className="me-1" />
                      {img.customName ? 'Edit' : 'Add Name'}
                    </Button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted py-4">No images found</td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      {/* Edit Image Metadata Modal */}
      <Modal show={!!editingImage} onHide={handleCloseModal}>
        <Modal.Header closeButton>
          <Modal.Title>
            {editingImage?.customName ? 'Edit' : 'Add'} Image Metadata
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {editingImage && (
            <>
              <div className="mb-3">
                <strong>Image Tag:</strong> {editingImage.tag}
              </div>
              <Form.Group className="mb-3">
                <Form.Label>Custom Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g. Stable Release v2.1"
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                />
                <Form.Text className="text-muted">
                  A friendly name that will be displayed in place of the tag
                </Form.Text>
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Description (Optional)</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  placeholder="e.g. Contains critical bug fixes and new agent features"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
                <Form.Text className="text-muted">
                  Additional details about this image version
                </Form.Text>
              </Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseModal} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveMetadata} disabled={isSaving}>
            {isSaving ? (
              <>
                <Spinner size="sm" className="me-2" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Card, Col, Form, InputGroup, Row, Table } from 'react-bootstrap'
import { BoxSeam, Search, Tag } from 'react-bootstrap-icons'
import { ECRImage } from '@/types'
import { ecrService } from '@/services/ecrService'

export default function Containers() {
  const [images, setImages] = useState<ECRImage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

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
      (img.gitCommit || '').toLowerCase().includes(term) ||
      (img.gitBranch || '').toLowerCase().includes(term)
    )
  }, [search, images])

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
              placeholder="Search by tag, commit, or branch..."
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
                <th>Tag</th>
                <th>Digest</th>
                <th>Size</th>
                <th>Pushed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(img => (
                <tr key={img.digest}>
                  <td>
                    <Badge bg={img.tag === 'latest' ? 'primary' : img.tag.startsWith('v') ? 'success' : img.tag.includes('hotfix') ? 'warning' : 'secondary'}>
                      <Tag size={12} className="me-1" />
                      {img.tag}
                    </Badge>
                  </td>
                  <td>
                    <code className="small text-break">{img.digest}</code>
                  </td>
                  <td>{formatSize(img.sizeMb)}</td>
                  <td>{new Date(img.pushedAt).toLocaleString()}</td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted py-4">No images found</td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  )
}

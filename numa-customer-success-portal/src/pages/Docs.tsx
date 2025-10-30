import { useEffect, useMemo, useState } from 'react'
import { Card, Row, Col, ListGroup, Alert, Spinner } from 'react-bootstrap'
import ReactMarkdown from 'react-markdown'

interface DocEntry {
  slug: string
  title: string
  path: string
}

export default function Docs() {
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [selected, setSelected] = useState<DocEntry | null>(null)
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        setError(null)
        const res = await fetch('/portal-docs/index.json', { cache: 'no-cache' })
        if (!res.ok) throw new Error(`Failed to load docs index (${res.status})`)
        const data: DocEntry[] = await res.json()
        setDocs(data)
        if (data.length > 0) setSelected(data[0])
      } catch (e: any) {
        setError(e?.message || 'Unable to load docs index')
      }
    })()
  }, [])

  useEffect(() => {
    (async () => {
      if (!selected) return
      try {
        setLoading(true)
        setError(null)
        setContent('')
        const res = await fetch(selected.path, { cache: 'no-cache' })
        if (!res.ok) throw new Error(`Failed to load doc (${res.status})`)
        const text = await res.text()
        setContent(text)
      } catch (e: any) {
        setError(e?.message || 'Unable to load document')
      } finally {
        setLoading(false)
      }
    })()
  }, [selected])

  const Sidebar = useMemo(() => (
    <ListGroup>
      {docs.map(d => (
        <ListGroup.Item
          action
          key={d.slug}
          active={selected?.slug === d.slug}
          onClick={() => setSelected(d)}
        >
          {d.title}
        </ListGroup.Item>
      ))}
      {docs.length === 0 && (
        <ListGroup.Item disabled>No docs available</ListGroup.Item>
      )}
    </ListGroup>
  ), [docs, selected])

  return (
    <Card className="border-0 shadow-sm">
      <Card.Header>
        <h5 className="mb-0">Documentation</h5>
        <p className="text-muted small mb-0 mt-2">Static markdown docs published with the portal.</p>
      </Card.Header>
      <Card.Body>
        <Row>
          <Col md={3} className="mb-3 mb-md-0">
            {Sidebar}
          </Col>
          <Col md={9}>
            {error && <Alert variant="danger">{error}</Alert>}
            {loading && (
              <div className="d-flex align-items-center text-muted">
                <Spinner size="sm" className="me-2" /> Loading...
              </div>
            )}
            {!loading && !error && (
              <div className="markdown-body">
                <ReactMarkdown>
                  {content || '# No content'}
                </ReactMarkdown>
              </div>
            )}
          </Col>
        </Row>
      </Card.Body>
    </Card>
  )
}

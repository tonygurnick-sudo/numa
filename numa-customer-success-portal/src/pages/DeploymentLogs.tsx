import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Alert, Badge, Button, Card, Form, Spinner, Dropdown } from 'react-bootstrap'
import { getDeploymentById, buildCloudwatchLogsUrl, buildEcsTaskUrl, buildStepFunctionsUrl, type DeploymentRecord } from '@/services/deploymentService'
import { backfillSince, resolveDeploymentLogTarget, stripAnsi, tailLogStream } from '@/services/logsService'
import { getConfigValue } from '@/services/configService'

export default function DeploymentLogs() {
  const { id } = useParams()
  const [deployment, setDeployment] = useState<DeploymentRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState<string[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [paused, setPaused] = useState(false)
  const [fromStart, setFromStart] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [selectedLine, setSelectedLine] = useState<number | null>(null)
  const [lastTs, setLastTs] = useState<number>(0)
  const tailRef = useRef<ReturnType<typeof tailLogStream> | null>(null)
  const lastTsRef = useRef<number>(0)
  const pausedRef = useRef<boolean>(false)
  const listRef = useRef<HTMLDivElement>(null)
  const awsRegion = getConfigValue('AWS_REGION') || 'us-east-1'

  const scrollToBottom = useCallback(() => {
    if (!autoScroll) return
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [autoScroll])

  useEffect(() => { scrollToBottom() }, [lines, scrollToBottom])

  const target = useMemo(() => deployment ? resolveDeploymentLogTarget(deployment) : null, [deployment])
  const statusLower = (deployment?.status || '').toLowerCase()
  const isRunning = statusLower === 'running' || statusLower === 'retrying'

  // Keep refs in sync with state to avoid unstable effect deps
  useEffect(() => { lastTsRef.current = lastTs }, [lastTs])
  useEffect(() => { pausedRef.current = paused }, [paused])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!id) return
      setLoading(true)
      setError(null)
      try {
        console.debug('[logs-ui] load deployment', { id })
        const rec = await getDeploymentById(id, true)
        if (cancelled) return
        console.debug('[logs-ui] deployment loaded', { hasTaskArn: !!rec?.ecsTaskArn, status: rec?.status })
        setDeployment(rec)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load deployment')
      } finally {
        setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [id])

  // Backfill once and start a stable tail; restart only when the target changes
  useEffect(() => {
    if (!deployment || !target?.group || !target?.stream) return
    let cancelled = false
    let localTail: ReturnType<typeof tailLogStream> | null = null

    async function run() {
      // Default to current ref; update after backfill if we get a newer ts
      let initialTailTs = lastTsRef.current
      try {
        // Determine backfill window
        const startedAtMs = deployment.startedAt ? Date.parse(deployment.startedAt) : Date.now()
        const defaultWindow = isRunning ? 5 * 60 * 1000 : Math.max(0, Date.now() - startedAtMs)
        const since = fromStart ? startedAtMs : Math.max(0, Date.now() - defaultWindow)
        console.debug('[logs-ui] backfill', { group: target.group, stream: target.stream, since, fromStart, isRunning })
        setBackfilling(true)
        const history = await backfillSince(target.group, target.stream, since)
        if (cancelled) return
        const mapped = history.map(e => stripAnsi(e.message || ''))
        setLines(mapped)
        const ts = history.length ? (history[history.length - 1]?.timestamp || 0) : 0
        if (ts) {
          initialTailTs = ts
          setLastTs(ts)
        }
        console.debug('[logs-ui] backfill loaded', { count: history.length })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load log history')
      } finally {
        if (!cancelled) setBackfilling(false)
      }

      // Start tail only if running
      if (!cancelled && isRunning) {
        console.debug('[logs-ui] start tail', { group: target.group, stream: target.stream })
        localTail = tailLogStream({
          group: target.group,
          stream: target.stream,
          startAtEnd: true,
          intervalMs: 1500,
          initialLastTs: initialTailTs,
          onEvents: (events) => {
            console.debug('[logs-ui] tail events', { count: events.length })
            if (pausedRef.current) return
            if (!events.length) return
            setLines(prev => [...prev, ...events.map(e => stripAnsi(e.message || ''))])
          },
          onError: (e) => {
            setError(e instanceof Error ? e.message : 'Log stream error')
          },
          onLastTsUpdate: (ts) => setLastTs(ts)
        })
        tailRef.current = localTail
        localTail.start()
      }
    }

    void run()
    return () => {
      cancelled = true
      localTail?.stop()
    }
  }, [deployment, target?.group, target?.stream, fromStart, isRunning])

  // Poll deployment status to stop tail on finish, then final backfill
  useEffect(() => {
    if (!id) return
    if (!isRunning) return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const rec = await getDeploymentById(id, true)
        const s = (rec?.status || '').toLowerCase()
        const stillRunning = s === 'running' || s === 'retrying'
        if (!stillRunning) {
          console.debug('[logs-ui] detected finish; stopping tail and finalizing logs')
          tailRef.current?.stop()
          // final backfill from lastTs+1
          const since = lastTs ? lastTs + 1 : (deployment?.startedAt ? Date.parse(deployment.startedAt) : Date.now() - 60_000)
          const finalBatch = target?.group && target?.stream ? await backfillSince(target.group, target.stream, since) : []
          if (!cancelled && finalBatch.length) {
            setLines(prev => [...prev, ...finalBatch.map(e => stripAnsi(e.message || ''))])
            const ts = finalBatch[finalBatch.length - 1]?.timestamp
            if (typeof ts === 'number') setLastTs(ts)
          }
          clearInterval(timer)
        }
      } catch {
        // ignore transient errors
      }
    }, 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [id, isRunning, lastTs, deployment, target])

  const url = useMemo(() => buildCloudwatchLogsUrl(awsRegion, deployment?.logsGroup || target?.group || undefined, target?.stream || undefined), [awsRegion, deployment, target])
  const sfnUrl = useMemo(() => buildStepFunctionsUrl(awsRegion, deployment?.sfnExecutionArn), [awsRegion, deployment])
  const ecsUrl = useMemo(() => buildEcsTaskUrl(awsRegion, deployment?.ecsTaskArn), [awsRegion, deployment])

  // Simple markers highlighting
  type MarkerKey = 'errors' | 'apply' | 'plan' | 'preplan'
  // Error detection tuned to reduce false positives (e.g., resource names with "-error-")
  // - Matches: optional ISO timestamp prefix, then [ERROR]; or leading "Error:"; or leading "ERROR"
  const reErrBracket = useMemo(() => /^\s*(?:\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s*)?\[ERROR\]\b/i, [])
  const reErrLeadingError = useMemo(() => /^\s*Error:/, [])
  const reErrLeadingERROR = useMemo(() => /^\s*ERROR\b/, [])
  const isErrorLine = useCallback((l: string) => {
    const s = l
    return reErrBracket.test(s) || reErrLeadingError.test(s) || reErrLeadingERROR.test(s)
  }, [reErrBracket, reErrLeadingERROR, reErrLeadingError])
  const reApply = useMemo(() => /Apply complete!?/i, [])
  const rePlanStart = useMemo(() => /^\s*Plan:/, [])
  const rePlanNoChanges = useMemo(() => /^\s*No changes\b/i, [])
  // Pre-plan (before the Plan: summary) — common Terraform phrasing
  const rePrePlan = useMemo(() => /Terraform will perform the following actions:/i, [])
  const markers = useMemo(() => {
    const result: Record<MarkerKey, { indices: number[] }> = {
      errors: { indices: [] },
      apply: { indices: [] },
      plan: { indices: [] },
      preplan: { indices: [] },
    }
    lines.forEach((l, idx) => {
      if (isErrorLine(l)) result.errors.indices.push(idx)
      if (reApply.test(l)) result.apply.indices.push(idx)
      if (rePlanStart.test(l) || rePlanNoChanges.test(l)) result.plan.indices.push(idx)
      if (rePrePlan.test(l)) result.preplan.indices.push(idx)
    })
    return result
  }, [lines, isErrorLine, reApply, rePlanStart, rePlanNoChanges, rePrePlan])

  const scrollToLine = useCallback((idx: number | null) => {
    if (idx === null) return
    setAutoScroll(false)
    const el = document.getElementById(`line-${idx}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setSelectedLine(idx)
    // Clear highlight after a short period
    setTimeout(() => setSelectedLine(current => current === idx ? null : current), 4000)
  }, [])

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h1 className="mb-1">Live Logs</h1>
          {deployment && (
            <div className="text-muted">
              <span className="me-2"><strong>Client:</strong> {deployment.clientName}</span>
              <span className="me-2"><strong>Version:</strong> {deployment.imageTag}</span>
              {deployment.deploymentLabel && (
                <Badge bg="success" className="ms-2">{deployment.deploymentLabel}</Badge>
              )}
            </div>
          )}
        </div>
        <div className="d-flex gap-2">
          <Button as={Link} to="/deployments" variant="outline-secondary" size="sm">Back</Button>
          {sfnUrl && <a className="btn btn-outline-primary btn-sm" href={sfnUrl} target="_blank" rel="noreferrer">Step Function</a>}
          {ecsUrl && <a className="btn btn-outline-primary btn-sm" href={ecsUrl} target="_blank" rel="noreferrer">ECS Task</a>}
          {url && <a className="btn btn-outline-primary btn-sm" href={url} target="_blank" rel="noreferrer">CloudWatch</a>}
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {loading && <div className="text-muted mb-2"><Spinner size="sm" className="me-2"/>Loading…</div>}
      {!target?.stream && (
        <Alert variant="warning">Waiting for log stream to become available…</Alert>
      )}

      <Card>
        <Card.Header className="d-flex align-items-center justify-content-between">
          <div className="text-muted small">
            <strong>Group:</strong> {target?.group || '—'}
            <span className="ms-2"><strong>Stream:</strong> {target?.stream || '—'}</span>
          </div>
          <div className="d-flex align-items-center gap-2">
            {/* Markers bubble */}
            {/* Marker dropdowns */}
            {markers.errors.indices.length > 0 && (
              <Dropdown>
                <Dropdown.Toggle size="sm" variant="outline-danger">
                  Errors ({markers.errors.indices.length})
                </Dropdown.Toggle>
                <Dropdown.Menu style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                  {markers.errors.indices.map((idx) => (
                    <Dropdown.Item key={idx} onClick={() => scrollToLine(idx)}>
                      Line {idx + 1}: {lines[idx]?.slice(0, 80)}
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown>
            )}
            {markers.preplan.indices.length > 0 && (
              <Dropdown>
                <Dropdown.Toggle size="sm" variant="outline-warning">
                  Pre-Plan ({markers.preplan.indices.length})
                </Dropdown.Toggle>
                <Dropdown.Menu style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                  {markers.preplan.indices.map((idx) => (
                    <Dropdown.Item key={idx} onClick={() => scrollToLine(idx)}>
                      Line {idx + 1}: {lines[idx]?.slice(0, 80)}
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown>
            )}
            {markers.apply.indices.length > 0 && (
              <Dropdown>
                <Dropdown.Toggle size="sm" variant="outline-success">
                  Apply ({markers.apply.indices.length})
                </Dropdown.Toggle>
                <Dropdown.Menu style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                  {markers.apply.indices.map((idx) => (
                    <Dropdown.Item key={idx} onClick={() => scrollToLine(idx)}>
                      Line {idx + 1}: {lines[idx]?.slice(0, 80)}
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown>
            )}
            {markers.plan.indices.length > 0 && (
              <Dropdown>
                <Dropdown.Toggle size="sm" variant="outline-info">
                  Plan ({markers.plan.indices.length})
                </Dropdown.Toggle>
                <Dropdown.Menu style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                  {markers.plan.indices.map((idx) => (
                    <Dropdown.Item key={idx} onClick={() => scrollToLine(idx)}>
                      Line {idx + 1}: {lines[idx]?.slice(0, 80)}
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown>
            )}
            <Form.Check
              type="switch"
              id="auto-scroll"
              label="Auto-scroll"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.currentTarget.checked)}
            />
            <Form.Check
              type="switch"
              id="from-start"
              label="From start"
              checked={fromStart}
              onChange={e => {
                setFromStart(e.currentTarget.checked)
                setLines([]) // let the effect re-backfill and restart tail
              }}
            />
            <Button size="sm" variant={paused ? 'secondary' : 'outline-secondary'} onClick={() => setPaused(p => !p)}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button size="sm" variant="outline-secondary" onClick={() => setLines([])}>Clear</Button>
            <Button size="sm" variant="outline-secondary" onClick={async () => {
              try { await navigator.clipboard.writeText(lines.join('\n')) } catch {/* ignore */}
            }}>Copy</Button>
            <Button size="sm" variant="outline-secondary" onClick={() => {
              const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `${id || 'logs'}.txt`
              a.click()
              URL.revokeObjectURL(url)
            }}>Download</Button>
          </div>
        </Card.Header>
        <Card.Body className="p-0">
          <div ref={listRef} style={{ position: 'relative', height: '60vh', overflow: 'auto', background: '#111', color: '#ddd', fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize: '12px', lineHeight: 1.5 }}>
            {backfilling && lines.length === 0 && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                <div className="d-flex align-items-center gap-2">
                  <Spinner size="sm" />
                  <span className="text-muted">Loading log history…</span>
                </div>
              </div>
            )}
            <pre className="m-0 p-3">
              {lines.map((l, idx) => {
                const isErr = isErrorLine(l)
                const isApply = reApply.test(l)
                const isPlan = rePlanStart.test(l) || rePlanNoChanges.test(l)
                const isPrePlan = rePrePlan.test(l)
                const bg = selectedLine === idx ? '#2a2a2a' : 'transparent'
                const color = isErr ? '#ff6b6b' : isApply ? '#8be59b' : isPlan ? '#7ec8ff' : isPrePlan ? '#ffd27f' : '#ddd'
                return (
                  <div key={idx} id={`line-${idx}`} style={{ background: bg, color }}>{l}</div>
                )
              })}
            </pre>
          </div>
        </Card.Body>
      </Card>
    </div>
  )
}

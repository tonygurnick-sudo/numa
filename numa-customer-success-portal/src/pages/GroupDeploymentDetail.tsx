import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Col, Row, Spinner, Table } from 'react-bootstrap';
import { useAuth } from '@/contexts/AuthContext';
import {
  buildCloudwatchLogsUrl,
  buildEcsTaskUrl,
  buildStepFunctionsUrl,
  getGroupDeploymentSummary,
  listDeploymentsForGroup,
  overrideDeploymentStatus,
  stopDeployment,
  stopGroupDeployment,
  startDeployment,
  startGroupDeployment,
  type DeploymentRecord,
} from '@/services/deploymentService';
import { getConfigValue } from '@/services/configService';

export default function GroupDeploymentDetail() {
  const { groupRunId = '' } = useParams<{ groupRunId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const awsRegion = getConfigValue('AWS_REGION') || 'us-east-1';

  const [summary, setSummary] = useState<DeploymentRecord | null>(null);
  const [members, setMembers] = useState<DeploymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stoppingMember, setStoppingMember] = useState<string | null>(null);
  const [markingFailed, setMarkingFailed] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!groupRunId) {
      setError('Group run id missing in route');
      return;
    }
    setRefreshing(true);
    try {
      const [summaryRecord, memberRecords] = await Promise.all([
        getGroupDeploymentSummary(groupRunId, true),
        listDeploymentsForGroup(groupRunId),
      ]);
      setSummary(summaryRecord);
      setMembers(memberRecords);
    } catch (e) {
      console.error('Failed to load group deployment details', e);
      setError(e instanceof Error ? e.message : 'Failed to load group deployment details');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [groupRunId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const failedMembers = useMemo(() => members.filter((m) => (m.status || '').toLowerCase() === 'failed'), [members]);
  const runningMembers = useMemo(
    () =>
      members.filter((m) => {
        const status = (m.status || '').toLowerCase();
        return status === 'running' || status === 'retrying';
      }),
    [members]
  );

  const handleRetryClient = async (record: DeploymentRecord) => {
    if (!user?.email) return;
    setRetrying(record.deploymentId);
    try {
      await startDeployment({
        clientName: record.clientName,
        imageTag: record.imageTag || summary?.imageTag || 'latest',
        initiatedBy: user.email,
        deploymentLabel: summary?.groupName ? `${summary.groupName} retry` : undefined,
        groupRunId,
        groupName: summary?.groupName,
      });
      await loadData();
    } catch (e) {
      console.error('Failed to retry client deployment', e);
      setError(e instanceof Error ? e.message : 'Failed to retry client deployment');
    } finally {
      setRetrying(null);
    }
  };

  const handleRetryFailedClients = async () => {
    if (!user?.email || failedMembers.length === 0 || !summary) return;
    setRetryingAll(true);
    try {
      const clients = failedMembers.map((m) => m.clientName);
      await startGroupDeployment({
        groupName: summary.groupName || `Retry ${groupRunId}`,
        clients,
        imageTag: summary.imageTag || 'latest',
        initiatedBy: user.email,
        maxConcurrency: summary.maxConcurrency,
      });
      await loadData();
    } catch (e) {
      console.error('Failed to retry group deployment', e);
      setError(e instanceof Error ? e.message : 'Failed to retry failed clients');
    } finally {
      setRetryingAll(false);
    }
  };

  if (!groupRunId) {
    return <Alert variant="warning">Group run id missing in route.</Alert>;
  }

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h1 className="mb-1">Group Deployment</h1>
          <p className="text-muted mb-0">Monitor multi-client deployment progress and actions</p>
        </div>
        <div className="d-flex gap-2">
          {(() => {
            const status = (summary?.status || '').toLowerCase();
            const canStop = status === 'running' || status === 'retrying';
            if (!canStop) return null;
            return (
              <Button
                variant="outline-danger"
                disabled={stopping}
                onClick={() => {
                  if (!summary || !user?.email) return;
                  setStopping(true);
                  void stopGroupDeployment(summary, user.email)
                    .then(loadData)
                    .finally(() => setStopping(false));
                }}
              >
                {stopping ? <Spinner size="sm" className="me-1" /> : null}
                Stop
              </Button>
            );
          })()}
          <Button variant="outline-secondary" as={Link} to="/deployments">
            ← Back to Deployments
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="danger" onClose={() => setError(null)} dismissible>
          {error}
        </Alert>
      )}

      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <h5 className="mb-0">Summary</h5>
            <div className="small text-muted">Group Run ID: {groupRunId}</div>
            {summary?.groupName && <div className="small text-muted">Group: {summary.groupName}</div>}
          </div>
          <div className="d-flex gap-2">
            <Button variant="outline-secondary" size="sm" onClick={() => navigate(0)}>
              Refresh Page
            </Button>
            <Button variant="primary" size="sm" onClick={loadData} disabled={refreshing}>
              {refreshing ? <Spinner size="sm" className="me-1" /> : null}
              Refresh Data
            </Button>
          </div>
        </Card.Header>
        <Card.Body>
          {loading ? (
            <div className="text-center py-5">
              <Spinner animation="border" />
            </div>
          ) : summary ? (
            <Row className="gy-3">
              <Col md={3}>
                <div className="fw-semibold text-muted">Status</div>
                <Badge
                  bg={
                    (summary.status || '').toLowerCase() === 'success'
                      ? 'primary'
                      : (summary.status || '').toLowerCase() === 'failed'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {summary.status || 'unknown'}
                </Badge>
              </Col>
              <Col md={3}>
                <div className="fw-semibold text-muted">Image Tag</div>
                <div>{summary.imageTag || '—'}</div>
              </Col>
              <Col md={3}>
                <div className="fw-semibold text-muted">Concurrency</div>
                <div>{summary.maxConcurrency || 'default'}</div>
              </Col>
              <Col md={3}>
                <div className="fw-semibold text-muted">Initiated By</div>
                <div>{summary.initiatedBy || '—'}</div>
              </Col>
              <Col md={3}>
                <div className="fw-semibold text-muted">Progress</div>
                <div>
                  {summary.clientsCompleted ?? 0}/{summary.clientsTotal ?? members.length} complete
                </div>
              </Col>
              <Col md={3}>
                <div className="fw-semibold text-muted">Successes</div>
                <div className="text-success">{summary.clientsSucceeded ?? 0}</div>
              </Col>
              <Col md={3}>
                <div className="fw-semibold text-muted">Failures</div>
                <div className="text-danger">{summary.clientsFailed ?? 0}</div>
              </Col>
              <Col md={3}>
                <div className="fw-semibold text-muted">Duration</div>
                <div>
                  {summary.startedAt ? new Date(summary.startedAt).toLocaleString() : '—'} →{' '}
                  {summary.endedAt ? new Date(summary.endedAt).toLocaleString() : '—'}
                </div>
              </Col>
              <Col md={12} className="d-flex flex-wrap gap-2 mt-2">
                {summary.sfnExecutionArn && (
                  <Button
                    as="a"
                    href={buildStepFunctionsUrl(awsRegion, summary.sfnExecutionArn) ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    size="sm"
                    variant="outline-secondary"
                  >
                    View Step Function
                  </Button>
                )}
                {summary.logsGroup && (
                  <Button
                    as="a"
                    href={buildCloudwatchLogsUrl(awsRegion, summary.logsGroup, summary.logsStream) ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    size="sm"
                    variant="outline-secondary"
                  >
                    Group Logs
                  </Button>
                )}
                {summary.deploymentId && (
                  <Button
                    as={Link}
                    to={`/deployments/${encodeURIComponent(summary.deploymentId)}/logs`}
                    size="sm"
                    variant="outline-primary"
                  >
                    Portal Logs
                  </Button>
                )}
                {failedMembers.length > 0 && (
                  <Button variant="outline-primary" size="sm" onClick={handleRetryFailedClients} disabled={retryingAll}>
                    {retryingAll ? <Spinner size="sm" className="me-1" /> : null}
                    Retry Failed Clients
                  </Button>
                )}
              </Col>
            </Row>
          ) : (
            <Alert variant="warning">Group summary not available.</Alert>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <h5 className="mb-0">Client Deployments</h5>
          <div className="small text-muted">
            {runningMembers.length} running · {failedMembers.length} failed · {members.length} total
          </div>
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center py-5">
              <Spinner animation="border" />
            </div>
          ) : (
            <Table responsive hover className="mb-0">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const statusLower = (member.status || '').toLowerCase();
                  const logsUrl = buildCloudwatchLogsUrl(awsRegion, member.logsGroup, member.logsStream);
                  const sfnUrl = buildStepFunctionsUrl(awsRegion, member.sfnExecutionArn);
                  const ecsUrl = buildEcsTaskUrl(awsRegion, member.ecsTaskArn);
                  const isFailed = statusLower === 'failed';
                  const isRunning = statusLower === 'running' || statusLower === 'retrying';
                  const canMarkFailed = !isFailed && statusLower !== 'success';
                  return (
                    <tr key={member.deploymentId}>
                      <td>{member.clientName}</td>
                      <td>
                        <Badge
                          bg={
                            isFailed
                              ? 'danger'
                              : isRunning
                                ? 'warning'
                                : statusLower === 'success'
                                  ? 'primary'
                                  : 'secondary'
                          }
                        >
                          {member.status || 'unknown'}
                        </Badge>
                      </td>
                      <td>{member.imageTag || '—'}</td>
                      <td>{member.startedAt ? new Date(member.startedAt).toLocaleString() : '—'}</td>
                      <td>
                        {(() => {
                          if (!member.startedAt) return '—';
                          const end = member.endedAt ? new Date(member.endedAt).getTime() : Date.now();
                          const start = new Date(member.startedAt).getTime();
                          const minutes = Math.max(0, Math.round((end - start) / 60000));
                          return `${minutes}m`;
                        })()}
                      </td>
                      <td>
                        <div className="d-flex gap-2">
                          <Button
                            as={Link}
                            to={`/deployments/${encodeURIComponent(member.deploymentId)}/logs`}
                            size="sm"
                            variant="outline-primary"
                          >
                            Portal Logs
                          </Button>
                          {logsUrl && (
                            <Button
                              as="a"
                              href={logsUrl}
                              target="_blank"
                              rel="noreferrer"
                              size="sm"
                              variant="outline-secondary"
                            >
                              Logs
                            </Button>
                          )}
                          {sfnUrl && (
                            <Button
                              as="a"
                              href={sfnUrl}
                              target="_blank"
                              rel="noreferrer"
                              size="sm"
                              variant="outline-secondary"
                            >
                              StepFn
                            </Button>
                          )}
                          {ecsUrl && (
                            <Button
                              as="a"
                              href={ecsUrl}
                              target="_blank"
                              rel="noreferrer"
                              size="sm"
                              variant="outline-secondary"
                            >
                              ECS
                            </Button>
                          )}
                          {isRunning && (
                            <Button
                              size="sm"
                              variant="outline-danger"
                              onClick={() => {
                                if (!user?.email) return;
                                setStoppingMember(member.deploymentId);
                                void stopDeployment(member, user.email)
                                  .then(loadData)
                                  .finally(() => setStoppingMember(null));
                              }}
                              disabled={stoppingMember === member.deploymentId}
                            >
                              {stoppingMember === member.deploymentId ? <Spinner size="sm" className="me-1" /> : null}
                              Stop
                            </Button>
                          )}
                          {canMarkFailed && (
                            <Button
                              size="sm"
                              variant="outline-danger"
                              onClick={() => {
                                if (!user?.email) return;
                                setMarkingFailed(member.deploymentId);
                                void overrideDeploymentStatus(
                                  member.deploymentId,
                                  'failed',
                                  `manually failed by ${user.email}`
                                )
                                  .then(loadData)
                                  .finally(() => setMarkingFailed(null));
                              }}
                              disabled={markingFailed === member.deploymentId}
                            >
                              {markingFailed === member.deploymentId ? <Spinner size="sm" className="me-1" /> : null}
                              Mark Failed
                            </Button>
                          )}
                          {isFailed && (
                            <Button
                              size="sm"
                              variant="outline-primary"
                              onClick={() => void handleRetryClient(member)}
                              disabled={retrying === member.deploymentId || !user?.email}
                            >
                              {retrying === member.deploymentId ? <Spinner size="sm" className="me-1" /> : null}
                              Retry
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && members.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-4 text-muted">
                      No client deployments recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}

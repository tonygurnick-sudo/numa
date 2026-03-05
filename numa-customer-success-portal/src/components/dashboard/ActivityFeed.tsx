import { Card, Badge, Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { Clock, Rocket, FileEarmark, ExclamationTriangle, Person } from 'react-bootstrap-icons';
import { useEffect, useState } from 'react';
import { activityService } from '@/services/activityService';
import type { ActivitySummary } from '@/types/activity';
import type { DeploymentRecord } from '@/services/deploymentService';

interface ActivityFeedProps {
  deployments?: DeploymentRecord[];
  maxItems?: number;
  showHeader?: boolean;
}

export function ActivityFeed({ deployments = [], maxItems = 5, showHeader = true }: ActivityFeedProps) {
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadActivities = async () => {
      try {
        setLoading(true);

        // Get recent activities from the activity service
        const recentActivities = await activityService.getRecentActivities({ limit: maxItems });
        const activitySummaries = recentActivities.map((activity) =>
          activityService.convertToActivitySummary(activity)
        );

        // Convert recent deployments to activities for backwards compatibility
        const deploymentActivities: ActivitySummary[] = deployments
          .slice(0, Math.max(0, maxItems - activitySummaries.length))
          .map((deployment) => {
            // Handle different timestamp field names from different interfaces
            const timestamp =
              (deployment as any).startTime || (deployment as any).startedAt || new Date().toISOString();

            return {
              id: `deployment-${deployment.deploymentId}`,
              type: 'deployment' as const,
              title: `Deployment to ${deployment.clientName}`,
              subtitle: `Image: ${deployment.imageTag || 'latest'}`,
              timestamp,
              status:
                deployment.status === 'success'
                  ? 'success'
                  : deployment.status === 'running' || deployment.status === 'retrying'
                    ? 'running'
                    : deployment.status === 'failed'
                      ? 'failed'
                      : 'warning',
              link: `/deployments/${deployment.deploymentId}/logs`,
              user: deployment.initiatedBy?.split('@')[0],
            };
          });

        // Combine and sort all activities
        const allActivities = [...activitySummaries, ...deploymentActivities]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, maxItems);

        setActivities(allActivities);
      } catch (error) {
        console.error('Failed to load activities:', error);
        // Fallback to just deployments if activity service fails
        const deploymentActivities: ActivitySummary[] = deployments.slice(0, maxItems).map((deployment) => {
          // Handle different timestamp field names from different interfaces
          const timestamp = (deployment as any).startTime || (deployment as any).startedAt || new Date().toISOString();

          return {
            id: `deployment-${deployment.deploymentId}`,
            type: 'deployment' as const,
            title: `Deployment to ${deployment.clientName}`,
            subtitle: `Image: ${deployment.imageTag || 'latest'}`,
            timestamp,
            status:
              deployment.status === 'success'
                ? 'success'
                : deployment.status === 'running' || deployment.status === 'retrying'
                  ? 'running'
                  : deployment.status === 'failed'
                    ? 'failed'
                    : 'warning',
            link: `/deployments/${deployment.deploymentId}/logs`,
            user: deployment.initiatedBy?.split('@')[0],
          };
        });
        setActivities(deploymentActivities);
      } finally {
        setLoading(false);
      }
    };

    loadActivities();
  }, [deployments, maxItems]);

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'deployment':
        return <Rocket size={16} />;
      case 'config':
        return <FileEarmark size={16} />;
      case 'user':
        return <Person size={16} />;
      case 'system':
        return <ExclamationTriangle size={16} />;
      default:
        return <Clock size={16} />;
    }
  };

  const getStatusBadge = (status?: string) => {
    if (!status) return null;

    const variants = {
      success: 'success',
      running: 'warning',
      failed: 'danger',
      warning: 'warning',
    };

    return (
      <Badge bg={variants[status as keyof typeof variants] || 'secondary'} className="ms-2">
        {status}
      </Badge>
    );
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  if (loading) {
    return (
      <Card className="border-0 shadow-sm">
        {showHeader && (
          <Card.Header className="bg-white border-bottom-0">
            <h6 className="mb-0 d-flex align-items-center">
              <Clock className="me-2" />
              Recent Activity
            </h6>
          </Card.Header>
        )}
        <Card.Body className="text-center py-4">
          <div className="spinner-border spinner-border-sm text-primary mb-2" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <div className="text-muted small">Loading activities...</div>
        </Card.Body>
      </Card>
    );
  }

  if (activities.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        {showHeader && (
          <Card.Header className="bg-white border-bottom-0">
            <h6 className="mb-0 d-flex align-items-center">
              <Clock className="me-2" />
              Recent Activity
            </h6>
          </Card.Header>
        )}
        <Card.Body className="text-center text-muted py-4">
          <Clock size={24} className="mb-2 opacity-50" />
          <div>No recent activity</div>
          <small className="text-muted">Activity will appear here when you make changes</small>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      {showHeader && (
        <Card.Header className="bg-white border-bottom-0 d-flex justify-content-between align-items-center">
          <h6 className="mb-0 d-flex align-items-center">
            <Clock className="me-2" />
            Recent Activity
          </h6>
          <Link to="/activity" className="text-decoration-none small">
            View all →
          </Link>
        </Card.Header>
      )}
      <Card.Body className="p-0">
        {activities.map((activity, index) => (
          <div
            key={activity.id}
            className={`d-flex align-items-start p-3 ${index < activities.length - 1 ? 'border-bottom' : ''}`}
          >
            <div className="me-3 mt-1 text-muted">{getActivityIcon(activity.type)}</div>

            <div className="flex-grow-1 min-w-0">
              <div className="d-flex align-items-center justify-content-between">
                <div className="fw-medium text-truncate">
                  {activity.link ? (
                    <Link to={activity.link} className="text-decoration-none text-dark">
                      {activity.title}
                    </Link>
                  ) : (
                    activity.title
                  )}
                  {getStatusBadge(activity.status)}
                </div>
                <span className="text-muted small ms-2 flex-shrink-0">{formatTimeAgo(activity.timestamp)}</span>
              </div>

              <div className="text-muted small mt-1">
                {activity.subtitle}
                {activity.user && <span className="ms-2">• by {activity.user}</span>}
              </div>
            </div>
          </div>
        ))}

        {activities.length >= maxItems && (
          <div className="p-3 text-center border-top bg-light">
            <Button as={Link} to="/activity" variant="link" size="sm" className="text-decoration-none">
              View full activity log
            </Button>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

export default ActivityFeed;

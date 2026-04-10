import { useState, useEffect, useCallback } from 'react';
import { Container, Spinner } from 'react-bootstrap';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { PageHeader } from '../Components/PageHeader';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { AutomationWorkflowBuilder } from '../Components/Automations/AutomationWorkflowBuilder';
import { ScheduleService } from '../Services/ScheduleService';
import { listAgents } from '../Services/AgentsService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useBranding } from '../Providers/BrandingContext';
import type { AgentSchedule, EventTrigger } from '../types/agentSchedules';
import type { AgentSummary } from '../types/agents';

export const AutomationBuilderPage = () => {
  const { t } = useTranslation('automations');
  const navigate = useNavigate();
  const { automationId } = useParams<{ automationId?: string }>();
  const [searchParams] = useSearchParams();
  const preselectedAgentId = searchParams.get('agentId');
  const isEditing = !!automationId;

  const { numaGet, numaPost, numaPut } = useNumaRequest();
  const { branding } = useBranding();
  const brandPrimaryColor = branding.resolvedAssets?.primaryColor || branding.primaryColor || '#6366f1';
  const brandPrimaryContrast = branding.resolvedAssets?.primaryContrast || branding.primaryContrast || '#ffffff';

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [editingAutomation, setEditingAutomation] = useState<AgentSchedule | null>(null);
  const [loading, setLoading] = useState(isEditing);

  // Load agents
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await listAgents(numaGet, { scope: 'owned' });
        if (!cancelled) setAgents(result);
      } catch (err) {
        console.error('[AutomationBuilderPage] Failed to load agents:', err);
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  // Load editing automation
  useEffect(() => {
    if (!automationId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const result = await ScheduleService.get(numaGet, automationId);
        if (!cancelled) setEditingAutomation(result);
      } catch (err) {
        console.error('[AutomationBuilderPage] Failed to load automation:', err);
        if (!cancelled) navigate('/automations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [automationId, numaGet, navigate]);

  const handleSave = useCallback(
    async (payload: {
      agentId: string;
      agentTitle: string;
      promptText: string;
      triggerType: 'cron' | 'event';
      trigger?: EventTrigger;
      cronExpression?: string;
      timezone?: string;
      label: string;
      maxRuns: number;
      emailNotifications: boolean;
      notificationEmails: string[];
      agentSnapshot?: {
        agentId: string;
        title: string;
        icon?: string;
        iconImage?: { s3Bucket: string; s3Key: string } | null;
        systemPrompt: string;
      };
    }) => {
      if (isEditing && automationId) {
        // Update existing
        await ScheduleService.update(numaPut, automationId, {
          promptText: payload.promptText,
          triggerType: payload.triggerType,
          trigger: payload.trigger,
          cronExpression: payload.cronExpression,
          timezone: payload.timezone,
          label: payload.label,
          maxRuns: payload.maxRuns,
          emailNotifications: payload.emailNotifications,
          notificationEmails: payload.notificationEmails,
        });
        navigate(`/automations/${automationId}`);
      } else {
        // Create new — generate a conversation ID
        const conversationId = `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const result = await ScheduleService.create(numaPost, {
          agentId: payload.agentId,
          agentTitle: payload.agentTitle,
          conversationId,
          promptText: payload.promptText,
          triggerType: payload.triggerType,
          trigger: payload.trigger,
          cronExpression: payload.cronExpression,
          timezone: payload.timezone,
          label: payload.label,
          maxRuns: payload.maxRuns,
          emailNotifications: payload.emailNotifications,
          notificationEmails: payload.notificationEmails,
          agentSnapshot: payload.agentSnapshot,
        });
        navigate(`/automations/${result.scheduleId}`);
      }
    },
    [isEditing, automationId, numaPost, numaPut, navigate]
  );

  const handleCancel = useCallback(() => {
    if (isEditing && automationId) {
      navigate(`/automations/${automationId}`);
    } else {
      navigate('/automations');
    }
  }, [isEditing, automationId, navigate]);

  if (loading) {
    return (
      <LayoutDashboard>
        <Container fluid className="px-4">
          <div className="d-flex justify-content-center align-items-center py-5">
            <Spinner animation="border" size="sm" className="me-2" />
            {t('page.loading')}
          </div>
        </Container>
      </LayoutDashboard>
    );
  }

  return (
    <LayoutDashboard>
      <Container fluid className="px-4">
        <PageHeader
          title={isEditing ? t('builder.title.edit') : t('builder.title.create')}
          subtitle={isEditing ? t('builder.subtitle.edit') : t('builder.subtitle.create')}
          icon={{
            element: <Zap />,
            backgroundColor: brandPrimaryColor,
            color: brandPrimaryContrast,
          }}
        />

        <div className="mt-3">
          <AutomationWorkflowBuilder
            agents={agents}
            agentsLoading={agentsLoading}
            editingAutomation={editingAutomation}
            preselectedAgentId={preselectedAgentId}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        </div>
      </Container>
    </LayoutDashboard>
  );
};

export default AutomationBuilderPage;

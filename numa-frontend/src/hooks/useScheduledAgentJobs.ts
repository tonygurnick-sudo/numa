import { useNumaRequest } from '../Providers/NumaRequestContext';
import { ScheduleService } from '../Services/ScheduleService';

export const useScheduledAgentJobs = () => {
  const { numaGet } = useNumaRequest();

  const getScheduledAgentJobs = async () => {
    try {
      // For now, we'll get the schedule records and transform them into job-like objects
      // In the future, this could be a dedicated API endpoint for scheduled agent job history
      const schedules = await ScheduleService.list(numaGet);

      // Transform schedule records into job-like objects for the job history UI
      const agentJobs = schedules
        .filter((schedule) => schedule.lastRunEpoch) // Only schedules that have run
        .map((schedule) => ({
          jobId: `agent-${schedule.scheduleId}-${schedule.lastRunEpoch}`,
          appId: 'scheduled-agents',
          appName: 'Scheduled Agents',
          scheduleId: schedule.scheduleId,
          agentTitle: schedule.agentTitle || schedule.agentId,
          promptText: schedule.promptText,
          dateTime: new Date(schedule.lastRunEpoch).toISOString(),
          startedAt: new Date(schedule.lastRunEpoch).toISOString(),
          completedAt: new Date(schedule.lastRunEpoch + 30000).toISOString(), // Assume 30s duration
          status: schedule.lastStatus === 'success' ? 'COMPLETED' : 'FAILED',
          results: {
            scheduleId: schedule.scheduleId,
            agentTitle: schedule.agentTitle,
            promptText: schedule.promptText,
            status: schedule.lastStatus,
            error: schedule.lastError,
          },
          duration: 30000, // Assume 30s duration for now
          userId: schedule.userId,
          isScheduledAgent: true,
        }));

      return { items: agentJobs };
    } catch (error) {
      console.error('Failed to load scheduled agent jobs:', error);
      return { items: [] };
    }
  };

  return { getScheduledAgentJobs };
};

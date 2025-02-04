// API service for job-related operations
import { createFormattedDate } from '../utils/dateUtils';
import { useNumaRequest } from '../Providers/RequestProvider';

const createJobData = (numaAppData, taskInputs, jobID = null) => {
  const { displayDate, isoDate } = createFormattedDate();

  return {
    ...(jobID && { jobID }), // Only include jobID if provided
    startedAt: isoDate,
    appName: numaAppData.appName,
    appType: numaAppData.type,
    name: `Run ${displayDate}`,
    inputs: taskInputs || {},
    results: null,
    status: 'running',
    lastUpdated: null,
  };
};

export const useJobsApi = () => {
  const { numaGet, numaPost, numaPut } = useNumaRequest();

  const createJob = async (numaAppData, taskInputs) => {
    try {
      const jobData = createJobData(numaAppData, taskInputs);

      const response = await numaPost(`/${numaAppData.id}/jobs`, jobData);

      if (!response.ok) {
        throw new Error('Failed to create job');
      }

      return await response.json();
    } catch (error) {
      console.error('API Error creating job:', error);
      throw error;
    }
  };

  // Update an existing job
  const updateJob = async (jobId, results) => {
    try {
      const { displayDate, isoDate } = createFormattedDate();
      const updateData = {
        results,
        status: 'completed',
        lastUpdated: isoDate,
        name: `Run ${displayDate}`,
      };

      const response = await numaPut(`/jobs/${jobId}`, updateData);

      return await response.json();
    } catch (error) {
      console.error('API Error updating job:', error);
      throw error;
    }
  };

  const getJobsByAppId = async (appId) => {
    try {
      return await numaGet(`/${appId}/jobs`);
    } catch (error) {
      console.error('API Error fetching jobs:', error);
      throw error;
    }
  };

  const getJobById = async (jobId) => {
    try {
      return await numaGet(`/jobs/${jobId}`);
    } catch (error) {
      console.error('API Error fetching job:', error);
      throw error;
    }
  };

  return {
    createJob,
    updateJob,
    getJobsByAppId,
    getJobById,
  };
};

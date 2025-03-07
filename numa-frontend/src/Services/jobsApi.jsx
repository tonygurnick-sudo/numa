// API service for job-related operations
import { createFormattedDate } from '../utils/dateUtils';
import { useNumaRequest } from '../Providers/NumaRequestContext';

const createJobData = (numaAppData, taskInputs, jobID = null, status = 'running') => {
  const { displayDate, isoDate } = createFormattedDate();

  return {
    ...(jobID && { jobID }), // Only include jobID if provided
    startedAt: isoDate,
    appName: numaAppData.appName,
    appType: numaAppData.type,
    name: `Run ${displayDate}`,
    inputs: taskInputs || {},
    results: null,
    status: status,
    lastUpdated: null,
    manifest: JSON.stringify(numaAppData), // Store the full manifest
  };
};

export const useJobsApi = () => {
  const { numaGet, numaPost, numaPut } = useNumaRequest();

  const createJob = async (numaAppData, taskInputs, status = 'running') => {
    try {
      console.log(`Creating job with status: ${status}...`);
      const jobData = createJobData(numaAppData, taskInputs, null, status);
      const endpoint_call = `/api/${numaAppData.id}/jobs`;
      const response = await numaPost(endpoint_call, jobData);

      // Check if the response is an object
      if (typeof response !== 'object') {
        throw new Error('Invalid job creation response from API');
      }

      // Check if the response status matches what we expect
      if (response.status !== status) {
        const errorMessage = response.error || 'Failed to create job';
        console.error('Job creation failed:', errorMessage);
        throw new Error(errorMessage);
      }

      return response;
    } catch (error) {
      console.error('API Error creating job:', error);
      console.error('Error details:', error.response?.data);
      throw new Error(`Failed to create job: ${error.message}`);
    }
  };

  // Update an existing job
  const updateJob = async (numaAppData, jobId, results) => {
    try {
      const { displayDate, isoDate } = createFormattedDate();
      const updateData = {
        results,
        status: 'completed',
        lastUpdated: isoDate,
        name: `Run ${displayDate}`,
      };

      const endpoint = `/api/${numaAppData.id}/jobs/${jobId}`;
      const response = await numaPut(endpoint, updateData);

      return response;
    } catch (error) {
      console.error('API Error updating job:', error);
      console.error('Error details:', error.response?.data);
      throw new Error(`Failed to update job: ${error.message}`);
    }
  };

  // Update just the status of an existing job
  const updateJobStatus = async (numaAppData, jobId, status) => {
    try {
      const { isoDate } = createFormattedDate();
      const updateData = {
        status,
        lastUpdated: isoDate,
      };

      const endpoint = `/api/${numaAppData.id}/jobs/${jobId}`;
      const response = await numaPut(endpoint, updateData);

      return response;
    } catch (error) {
      console.error('API Error updating job status:', error);
      console.error('Error details:', error.response?.data);
      throw new Error(`Failed to update job status: ${error.message}`);
    }
  };

  const getJobsByAppId = async (appId, { limit = 25, nextToken = null } = {}) => {
    try {
      const params = new URLSearchParams({ limit: limit.toString() });
      if (nextToken) {
        params.append('next_token', nextToken);
      }
      const endpoint_call = `/api/${appId}/jobs?${params.toString()}`;
      const response = await numaGet(endpoint_call);
      return {
        items: response.items || [],
        nextToken: response.next_token,
        count: response.count || 0,
      };
    } catch (error) {
      console.error('API Error fetching jobs:', error);
      throw error;
    }
  };

  const getJobById = async (numaAppId, jobId) => {
    try {
      const endpoint = `/api/${numaAppId}/jobs/${jobId}`;
      const response = await numaGet(endpoint);
      return response;
    } catch (error) {
      console.error('API Error fetching job:', error);
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);
      throw error;
    }
  };

  return {
    createJob,
    updateJob,
    updateJobStatus,
    getJobsByAppId,
    getJobById,
  };
};

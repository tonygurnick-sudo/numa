// API service for job-related operations
import { createFormattedDate } from '../utils/dateUtils';
import { useNumaRequest } from '../Providers/NumaRequestContext';

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
    manifest: JSON.stringify(numaAppData), // Store the full manifest
  };
};

export const useJobsApi = () => {
  const { numaGet, numaPost, numaPut } = useNumaRequest();

  const createJob = async (numaAppData, taskInputs) => {
    try {
      const jobData = createJobData(numaAppData, taskInputs);
      console.log('Creating job with data:', jobData);
      console.log('Using app ID:', numaAppData.id);
      const endpoint_call = `/api/${numaAppData.id}/jobs`;
      console.log('Endpoint call:', endpoint_call);
      const response = await numaPost(endpoint_call, jobData);

      console.log('Job creation response:', response);

      // Check if the response is an object
      if (typeof response !== 'object') {
        throw new Error('Invalid job creation response from API');
      }

      if (response.status !== 'running') {
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
      console.log('Updating job with data:', updateData);
      console.log('Using app ID:', numaAppData.id);
      console.log('Job ID:', jobId);

      const endpoint = `/api/${numaAppData.id}/jobs/${jobId}`;
      console.log('Using endpoint:', endpoint);

      const response = await numaPut(endpoint, updateData);
      console.log('Job update response:', response);

      return response;
    } catch (error) {
      console.error('API Error updating job:', error);
      console.error('Error details:', error.response?.data);
      throw new Error(`Failed to update job: ${error.message}`);
    }
  };

  const getJobsByAppId = async (appId, { page = 1, limit = 25 } = {}) => {
    try {
      const endpoint_call = `/api/${appId}/jobs?page=${page}&limit=${limit}`;
      console.log('Getting jobs with endpoint:', endpoint_call);
      return await numaGet(endpoint_call);
    } catch (error) {
      console.error('API Error fetching jobs:', error);
      throw error;
    }
  };

  const getJobById = async (numaAppId, jobId) => {
    try {
      const endpoint_call = `/api/${numaAppId}/jobs/${jobId}`;
      console.log('Getting job with endpoint:', endpoint_call);
      return await numaGet(endpoint_call);
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

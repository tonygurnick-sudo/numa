// API service for job-related operations
import { createFormattedDate } from '../utils/dateUtils';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAuth } from '../Providers/AuthProvider';

const createJobData = (numaAppData, taskInputs, jobId = null, status = 'PROCESSING') => {
  const { displayDate, isoDate } = createFormattedDate();

  return {
    ...(jobId && { jobId }), // Only include jobId if provided
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
  const { user } = useAuth();
  const userId = user?.decoded_tokens?.idToken?.['sub'];

  const createJob = async (numaAppData, taskInputs, status = 'PROCESSING') => {
    try {
      const jobData = createJobData(numaAppData, taskInputs, null, status);
      const endpoint_call = `/api/${numaAppData.id}/jobs`;

      const requestBody = {
        ...jobData,
        userId: userId,
      };

      const response = await numaPost(endpoint_call, requestBody);
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

  const updateJob = async (numaAppData, jobId, results, inputs = null, status = 'PROCESSING') => {
    // User ID is now handled by RequestProvider
    try {
      const { displayDate, isoDate } = createFormattedDate();

      // Start with basic update data
      const updateData = {
        lastUpdated: isoDate,
        name: `Run ${displayDate}`,
      };

      // Only include status if it's provided
      if (status !== undefined && status !== null) {
        updateData.status = status;
      }

      // Only include results if they're provided
      if (results !== undefined && results !== null) {
        updateData.results = results;
      }

      // Only include inputs if they're provided
      if (inputs !== undefined && inputs !== null) {
        updateData.inputs = inputs;
      }

      const endpoint = `/api/${numaAppData.id}/jobs/${jobId}`;
      const response = await numaPut(endpoint, updateData);

      return response;
    } catch (error) {
      console.error('API Error updating job:', error);
      console.error('Error details:', error.response?.data);
      throw new Error(`Failed to update job: ${error.message}`);
    }
  };

  const getJobsByAppId = async (appId, nextToken = null) => {
    const limit = 50;

    try {
      const endpoint = `/api/${appId}/jobs`;
      const nextTokenStr = nextToken ? JSON.stringify(nextToken) : null;

      const params = {
        limit,
        ...(nextTokenStr && { nextToken: nextTokenStr }),
        userId: userId,
      };

      const response = await numaGet(endpoint, params);

      return {
        items: response.items || [],
        next_token: response.next_token || null,
        nextToken: response.nextToken || null,
        count: response.count || (response.items ? response.items.length : 0),
      };
    } catch (error) {
      console.error('API Error fetching jobs:', error);
      console.error('Error details:', error.response?.data);
      throw error;
    }
  };

  const getJobById = async (numaAppId, jobId) => {
    try {
      const endpoint = `/api/${numaAppId}/jobs/${jobId}`;

      const params = {
        userId: userId,
      };

      const response = await numaGet(endpoint, params);

      if (!response) {
        throw new Error('No response received from server');
      }

      return response;
    } catch (error) {
      console.error('API Error fetching job:', error);
      console.error('Error details:', error.response?.data);
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

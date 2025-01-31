// API service for job-related operations
import { createFormattedDate } from '../utils/dateUtils';

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

export const jobsApi = {
  // Create a new job
  createJob: async (numaAppData, taskInputs) => {
    try {
      // leave until API proxy is in place, return mock data instead of making API call
      // const mockJobId = 'mock-job-' + Math.random().toString(36).substring(7);
      // const jobData = createJobData(numaAppData, taskInputs, mockJobId);
      
      // console.log('Mock job created:', jobData);
      // return jobData;

      const jobData = createJobData(numaAppData, taskInputs);

      const response = await fetch(`/api/${numaAppData.id}/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jobData),
      });

      if (!response.ok) {
        throw new Error('Failed to create job');
      }

      return await response.json();
    } catch (error) {
      console.error('API Error creating job:', error);
      throw error;
    }
  },

  // Update an existing job
  updateJob: async (jobId, results) => {
    try {
      // leave until API proxy is in place, return mock success response instead of making API call
      // const { isoDate } = createFormattedDate();
      // const mockResponse = {
      //   jobId,
      //   results,
      //   status: 'completed',
      //   lastUpdated: isoDate,
      //   success: true
      // };
      
      // console.log('Mock job updated:', mockResponse);
      // return mockResponse;

      const { displayDate, isoDate } = createFormattedDate();
      const updateData = {
        results,
        status: 'completed',
        lastUpdated: isoDate,
        name: `Run ${displayDate}`,
      };

      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error('Failed to update job');
      }

      return await response.json();
    } catch (error) {
      console.error('API Error updating job:', error);
      throw error;
    }
  },

  // Get jobs for a specific app
  getJobsByAppId: async (appId) => {
    try {
      const response = await fetch(`/api/${appId}/jobs`);
      if (!response.ok) {
        throw new Error('Failed to fetch jobs');
      }
      return await response.json();
    } catch (error) {
      console.error('API Error fetching jobs:', error);
      throw error;
    }
  },

  // Get a specific job by ID
  getJobById: async (jobId) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch job');
      }
      return await response.json();
    } catch (error) {
      console.error('API Error fetching job:', error);
      throw error;
    }
  }
};

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
    const { displayDate, isoDate } = createFormattedDate();

    const updateData = {
      results,
      status: 'completed',
      lastUpdated: isoDate,
      name: `Run ${displayDate}`,
    };

    try {
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

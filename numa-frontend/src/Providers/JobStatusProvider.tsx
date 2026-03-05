import { JobStatusContext } from './JobStatusContext';
import { useState, useEffect, useRef } from 'react';
import { useJobsApi } from '../Services/jobsApi';
import { manifestService } from '../Services/manifestService';
import { useAuth } from './AuthProvider';

const REFRESH_INTERVAL = 300 * 1000; // 5 minutes
const MAX_REFRESHES = 100;

export const JobStatusProvider = ({ children }) => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [nextRefreshIn, setNextRefreshIn] = useState(REFRESH_INTERVAL / 1000);
  const jobsApi = useJobsApi();
  const refreshCountRef = useRef(0);
  const { isAuthenticated } = useAuth();

  const fetchStatus = async () => {
    // Don't fetch if not authenticated
    if (!isAuthenticated) {
      return;
    }

    // Prevent overlapping fetches only if we already have data shown
    if (loading && jobs.length > 0 && hasLoaded) {
      return;
    }

    try {
      setLoading(true);
      const appsData = await manifestService.fetchAppsFromManifest();

      // Only proceed if we have apps data
      if (!appsData || appsData.length === 0) {
        setLoading(false);
        return;
      }

      const jobResults = await Promise.all(
        appsData
          .map((app) => app.id)
          .map((appId) =>
            jobsApi.getJobsByAppId(appId).catch((error) => {
              console.warn(`Failed to fetch jobs for app ${appId}:`, error);
              return { items: [] }; // Return empty items on error
            })
          )
      );

      const sortedJobs = jobResults
        .flatMap((appResult) => {
          if (!appResult || !appResult.items) return [];
          return appResult.items.map((item) => ({ appId: appResult.appId, ...item }));
        })
        .map((job) => ({
          id: job.jobId,
          started: job.startedAt ?? job.createdAt,
          app: job.appId,
          appName: job.appName,
          status: job.status,
        }))
        .sort((a, b) => (a.started < b.started ? 1 : -1));

      setJobs(sortedJobs);
      setHasLoaded(true);
    } catch (error) {
      console.error('Error fetching job status:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Only fetch when authenticated
    if (isAuthenticated) {
      fetchStatus();
    } else {
      // Reset state when not authenticated
      setJobs([]);
      setLoading(false);
      setHasLoaded(false);
    }
  }, [refresh, isAuthenticated]);

  // Auto refresh effect
  useEffect(() => {
    const interval = setInterval(() => {
      refreshCountRef.current += 1;
      if (refreshCountRef.current >= MAX_REFRESHES) {
        clearInterval(interval);
        return;
      }
      setRefresh((prev) => prev + 1);
      setNextRefreshIn(REFRESH_INTERVAL / 1000);
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  // Countdown timer effect
  useEffect(() => {
    if (!isAuthenticated) return;

    const countdownInterval = setInterval(() => {
      setNextRefreshIn((prev) => {
        if (prev <= 1) return REFRESH_INTERVAL / 1000;
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [isAuthenticated]);

  // Manual refresh function
  const refreshJobs = () => {
    // Indicate a refresh and let fetchStatus flip loading to true
    setHasLoaded(false);
    setRefresh((prev) => prev + 1);
    setNextRefreshIn(REFRESH_INTERVAL / 1000);
  };

  const contextValue = {
    loading,
    hasLoaded,
    jobs,
    refreshJobs,
    nextRefreshIn,
  };

  return <JobStatusContext.Provider value={contextValue}>{children}</JobStatusContext.Provider>;
};

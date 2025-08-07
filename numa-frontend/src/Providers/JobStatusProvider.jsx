import { JobStatusContext } from './JobStatusContext';
import { useState, useEffect, useRef } from 'react';
import { useJobsApi } from '../Services/jobsApi';
import { manifestService } from '../Services/manifestService';

const REFRESH_INTERVAL = 15 * 1000;
const MAX_REFRESHES = 100;

export const JobStatusProvider = ({ children }) => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const jobsApi = useJobsApi();
  const refreshCountRef = useRef(0);

  const fetchStatus = async () => {
    if (loading && jobs.length > 0) {
      return;
    }

    setLoading(true);
    const appsData = await manifestService.fetchAppsFromManifest();
    const sortedJobs = (await Promise.all(appsData.map((app) => app.id).map((appId) => jobsApi.getJobsByAppId(appId))))
      .flatMap((appResult) => appResult.items.map((item) => ({ appId: appResult.appId, ...item })))
      .map((job) => ({
        id: job.jobId,
        started: job.startedAt ?? job.createdAt,
        app: job.appId,
        appName: job.appName,
        status: job.status,
      }))
      .sort((a, b) => (a.started < b.started ? 1 : -1));
    setJobs(sortedJobs);
    setLoading(false);
    setHasLoaded(true);
  };

  useEffect(() => {
    fetchStatus();
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshCountRef.current += 1;
      if (refreshCountRef.current >= MAX_REFRESHES) {
        clearInterval(interval);
        return;
      }
      setRefresh((prev) => prev + 1);
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  const contextValue = {
    loading,
    hasLoaded,
    jobs,
  };

  return <JobStatusContext.Provider value={contextValue}>{children}</JobStatusContext.Provider>;
};

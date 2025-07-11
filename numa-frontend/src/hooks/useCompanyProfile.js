import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../Providers/AuthProvider';
import { loadCompanyProfile } from '../utils/chatSystemPromptUtils';

/**
 * Hook for managing company profile loading and state
 * Simple wrapper around existing companyInfoUtils functionality
 */
export const useCompanyProfile = () => {
  const [companyProfile, setCompanyProfile] = useState(null);
  const [isCompanyProfileLoaded, setIsCompanyProfileLoaded] = useState(false);

  const { getCredentials } = useAuth();

  // Memoize constants to prevent unnecessary rerenders
  const REGION = useMemo(() => window.sessionStorage.getItem('REGION'), []);
  const CLIENT_NAME = useMemo(() => window.sessionStorage.getItem('CLIENT_NAME'), []);
  const companyBucket = useMemo(() => `numa-${CLIENT_NAME}-company`, [CLIENT_NAME]);

  /**
   * Load company profile from S3
   */
  const fetchCompanyProfile = async () => {
    if (!REGION || !companyBucket || !getCredentials) {
      console.log('Missing required parameters for loading company profile');
      setIsCompanyProfileLoaded(true); // Mark as loaded even if failed to prevent repeated attempts
      return;
    }

    try {
      const profileText = await loadCompanyProfile(companyBucket, REGION, getCredentials);
      setCompanyProfile(profileText);
      console.log('Company profile loaded successfully');
    } catch (error) {
      console.error('Error loading company profile:', error);
    } finally {
      setIsCompanyProfileLoaded(true);
    }
  };

  // Load company profile when component mounts
  useEffect(() => {
    if (!isCompanyProfileLoaded && REGION && companyBucket) {
      fetchCompanyProfile();
    }
  }, [REGION, companyBucket, getCredentials, isCompanyProfileLoaded]);

  return {
    companyProfile,
    isCompanyProfileLoaded,
    refetchProfile: fetchCompanyProfile,
  };
};

import { useState, useEffect } from 'react';
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

  // Read sessionStorage only once on initialization, not in useMemo
  const [config] = useState(() => ({
    REGION: window.sessionStorage.getItem('REGION'),
    CLIENT_NAME: window.sessionStorage.getItem('CLIENT_NAME'),
  }));

  const companyBucket = `numa-${config.CLIENT_NAME}-company`;

  /**
   * Load company profile from S3
   */
  const fetchCompanyProfile = async () => {
    if (!config.REGION || !companyBucket || !getCredentials) {
      console.warn('Missing required parameters for loading company profile');
      setIsCompanyProfileLoaded(true); // Mark as loaded even if failed to prevent repeated attempts
      return;
    }

    try {
      const profileText = await loadCompanyProfile(companyBucket, config.REGION, getCredentials);
      setCompanyProfile(profileText);
    } catch (error) {
      console.error('Error loading company profile:', error);
    } finally {
      setIsCompanyProfileLoaded(true);
    }
  };

  // Load company profile when component mounts - removed unnecessary dependencies
  useEffect(() => {
    if (!isCompanyProfileLoaded && config.REGION && companyBucket) {
      fetchCompanyProfile();
    }
  }, [isCompanyProfileLoaded]); // Only depend on loading state

  return {
    companyProfile,
    isCompanyProfileLoaded,
    refetchProfile: fetchCompanyProfile,
  };
};

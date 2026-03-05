import { useState, useCallback } from 'react';
import { awsCredentialsService } from '@/services/awsCredentialsService';
import type { AWSClientConfig } from '@/services/awsCredentialsService';

interface UseAssumeRoleReturn {
  isLoading: boolean;
  error: string | null;
  assumeRole: (accountId: string, region?: string) => Promise<AWSClientConfig>;
  clearError: () => void;
}

export function useAssumeRole(): UseAssumeRoleReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assumeRole = useCallback(async (accountId: string, region: string = 'us-east-1'): Promise<AWSClientConfig> => {
    setIsLoading(true);
    setError(null);

    try {
      const clientConfig = await awsCredentialsService.getClientConfig(accountId, region);
      return clientConfig;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to assume role in account ${accountId}: ${errorMessage}`);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isLoading,
    error,
    assumeRole,
    clearError,
  };
}

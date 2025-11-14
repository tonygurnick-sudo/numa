import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAuth } from '../Providers/AuthProvider';

interface WebCrawlerOptions {
  urlDepthMap?: Record<string, number>;
  kb_id?: string;
}

interface WebCrawlerResult {
  success: boolean;
  executionName?: string;
  error?: string;
}

export const useWebCrawler = () => {
  const { numaPost } = useNumaRequest();
  const { user } = useAuth();

  const startWebCrawler = async (urls: string[], options: WebCrawlerOptions = {}): Promise<WebCrawlerResult> => {
    try {
      const { urlDepthMap = {}, kb_id = 'company' } = options;

      let userId = 'anonymous';
      if (user && user.decoded_tokens && user.decoded_tokens.idToken) {
        const idToken = user.decoded_tokens.idToken;
        userId = idToken.email || idToken.sub || 'anonymous';
      }

      // Create payload with URL-specific depths and KB ID
      const payload = {
        urls,
        userId,
        urlDepthMap,
        kb_id,
      };

      // @ts-expect-error - numaPost accepts arguments but context types are not properly defined
      const response = (await numaPost(`/api/start-web-crawler`, payload)) as unknown as WebCrawlerResult;
      return response;
    } catch (error) {
      console.error('Error starting web crawler:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start web crawler',
      };
    }
  };

  return {
    startWebCrawler,
  };
};

export const parseUrlsFromText = (text: string): string[] => {
  if (!text) return [];

  // URL regex pattern for validation
  const urlRegex = /^https?:\/\/(?:[\w-]+\.)+[a-z0-9][\w-]*(?:\.[a-z0-9][\w-]*)*(?::\d+)?(?:\/[^\s]*)*$/i;

  // Split by whitespace and filter for valid URLs
  const potentialUrls = text.split(/\s+/).filter((url) => url.trim() !== '');
  return potentialUrls.filter((url) => urlRegex.test(url));
};

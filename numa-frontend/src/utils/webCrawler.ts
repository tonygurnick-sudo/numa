import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAuth } from '../Providers/AuthProvider';

export const useWebCrawler = () => {
  const { numaPost } = useNumaRequest();
  const { user } = useAuth();

  const startWebCrawler = async (urls, options = {}) => {
    try {
      const { urlDepthMap = {} } = options;

      let userId = 'anonymous';
      if (user && user.decoded_tokens && user.decoded_tokens.idToken) {
        const idToken = user.decoded_tokens.idToken;
        userId = idToken.email || idToken.sub || 'anonymous';
      }

      // Create payload with URL-specific depths
      const payload = {
        urls,
        userId,
        urlDepthMap,
      };

      const response = await numaPost(`/api/start-web-crawler`, payload);
      return response;
    } catch (error) {
      console.error('Error starting web crawler:', error);
      return {
        success: false,
        error: error.message || 'Failed to start web crawler',
      };
    }
  };

  return {
    startWebCrawler,
  };
};

export const parseUrlsFromText = (text) => {
  if (!text) return [];

  // URL regex pattern for validation
  const urlRegex = /^https?:\/\/(?:[\w-]+\.)+[a-z0-9][\w-]*(?:\.[a-z0-9][\w-]*)*(?::\d+)?(?:\/[^\s]*)*$/i;

  // Split by whitespace and filter for valid URLs
  const potentialUrls = text.split(/\s+/).filter((url) => url.trim() !== '');
  return potentialUrls.filter((url) => urlRegex.test(url));
};

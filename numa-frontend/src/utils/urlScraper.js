import { useNumaRequest } from '../Providers/NumaRequestContext';

/**
 * Helper functions for URL scraping functionality
 */

/**
 * Scrape URLs by calling the backend API
 * @param {string[]} urls - Array of URLs to scrape
 * @param {string} dataBucketName - Name of the S3 bucket to store scraped content
 * @returns {Promise<{success: boolean, results: Array, error?: string, message?: string}>}
 */
export const useScrapeUrls = () => {
  const { numaPost } = useNumaRequest();

  const scrapeUrls = async (urls, dataBucketName) => {
    const response = await numaPost(`/api/scrape-urls`, {
      urls,
      bucket: dataBucketName,
      prefix: 'scraped-content/',
    });
    console.log('URL Scraper response:', response);
    return response;
  };

  return {
    scrapeUrls,
  };
};

/**
 * Parse URLs from text input
 * @param {string} text - Text containing URLs (one per line or space-separated)
 * @returns {string[]} Array of valid URLs
 */
export const parseUrlsFromText = (text) => {
  if (!text) return [];

  // Split by newlines or spaces, then filter out empty strings
  const potentialUrls = text.split(/\s+/).filter((url) => url.trim() !== '');

  // Simple URL validation - matches http(s)://example.com/path
  const urlRegex = /^https?:\/\/[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i;
  return potentialUrls.filter((url) => urlRegex.test(url));
};

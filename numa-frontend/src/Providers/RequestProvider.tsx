import axios from 'axios';
import { useCallback, useMemo } from 'react';
import { NumaRequestContext } from './NumaRequestContext';
import { useAuth } from './AuthProvider';

// Move parseNestedJson completely outside component - pure function
const parseNestedJson = (data) => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }

  if (Array.isArray(data)) {
    return data.map((item) => {
      if (item.body && typeof item.body === 'string') {
        try {
          item.body = JSON.parse(item.body);
        } catch {
          // Keep original string if parsing fails
        }
      }
      return item;
    });
  }

  return data;
};

export const NumaRequestProvider = ({ children }) => {
  // getAccessToken reads from AuthProvider's refs (always fresh, no re-render
  // cascade) and refreshes on demand when the token is expired — without this,
  // background polling after laptop wake fires requests with a stale token and
  // 401-storms until the interval-based refresh catches up.
  const { getAccessToken } = useAuth();

  const getHeaders = useCallback(
    async (extra = {}) => {
      // Fall back to localStorage if AuthProvider has no token in memory yet
      // (e.g. first render after a hard reload).
      const accessToken = (await getAccessToken()) || localStorage.getItem('accessToken');
      return {
        'Content-Type': 'application/json',
        ...(accessToken && { authorization: accessToken }),
        ...extra,
      };
    },
    [getAccessToken]
  );

  const axiosConfig = useMemo(
    () => ({
      transformResponse: [...axios.defaults.transformResponse, (data) => parseNestedJson(data)],
    }),
    [] // No dependencies needed since parseNestedJson is stable
  );

  // Common request methods — stable identities (never recreated on token refresh).
  // They read the latest token via accessTokenRef at call time.
  const numaGet = useCallback(
    async (url, params, headers = {}) => {
      try {
        const response = await axios.get(url, {
          ...axiosConfig,
          params,
          headers: await getHeaders(headers),
        });
        return response.data;
      } catch (error) {
        console.error('Request failed:', error.message);
        console.error('Response status:', error.response?.status);
        console.error('Response data:', error.response?.data);
        throw error;
      }
    },
    [axiosConfig, getHeaders]
  );

  const numaPost = useCallback(
    async (url, data, headers = {}) => {
      try {
        const response = await axios.post(url, data, {
          ...axiosConfig,
          headers: await getHeaders(headers),
        });
        return response.data;
      } catch (error) {
        console.error('Request failed:', error.message);
        console.error('Response status:', error.response?.status);
        console.error('Response data:', error.response?.data);
        throw error;
      }
    },
    [axiosConfig, getHeaders]
  );

  const numaPut = useCallback(
    async (url, data, headers = {}) => {
      const response = await axios.put(url, data, {
        ...axiosConfig,
        headers: await getHeaders(headers),
      });
      return response.data;
    },
    [axiosConfig, getHeaders]
  );

  const numaDelete = useCallback(
    async (url, headers = {}) => {
      const response = await axios.delete(url, {
        ...axiosConfig,
        headers: await getHeaders(headers),
      });
      return response.data;
    },
    [axiosConfig, getHeaders]
  );

  const value = useMemo(
    () => ({
      numaGet,
      numaPost,
      numaPut,
      numaDelete,
    }),
    [numaGet, numaPost, numaPut, numaDelete]
  );

  return <NumaRequestContext.Provider value={value}>{children}</NumaRequestContext.Provider>;
};

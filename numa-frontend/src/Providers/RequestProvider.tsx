import axios from 'axios';
import { useCallback, useMemo } from 'react';
import { NumaRequestContext } from './NumaRequestContext';

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
  // Read access token directly from localStorage at request time.
  // localStorage is always kept fresh by AuthProvider.refreshTokens(),
  // so this avoids depending on user state (which would cascade re-renders).
  const getHeaders = useCallback((extra = {}) => {
    const accessToken = localStorage.getItem('accessToken');
    return {
      'Content-Type': 'application/json',
      ...(accessToken && { authorization: accessToken }),
      ...extra,
    };
  }, []);

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
          headers: getHeaders(headers),
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
          headers: getHeaders(headers),
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
        headers: getHeaders(headers),
      });
      return response.data;
    },
    [axiosConfig, getHeaders]
  );

  const numaDelete = useCallback(
    async (url, headers = {}) => {
      const response = await axios.delete(url, {
        ...axiosConfig,
        headers: getHeaders(headers),
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

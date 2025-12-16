import axios from 'axios';
import { useCallback, useMemo } from 'react';
import { useAuth } from './AuthProvider';
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
  const { user } = useAuth();

  const defaultHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      ...(user?.tokens?.accessToken && {
        authorization: user.tokens.accessToken,
      }),
    }),
    [user],
  );

  const axiosConfig = useMemo(
    () => ({
      transformResponse: [...axios.defaults.transformResponse, (data) => parseNestedJson(data)],
    }),
    [], // No dependencies needed since parseNestedJson is stable
  );

  // Common request methods
  const numaGet = useCallback(
    async (url, params, headers = {}) => {
      try {
        const response = await axios.get(url, {
          ...axiosConfig,
          params,
          headers: { ...defaultHeaders, ...headers },
        });
        return response.data;
      } catch (error) {
        console.error('Request failed:', error.message);
        console.error('Response status:', error.response?.status);
        console.error('Response data:', error.response?.data);
        throw error;
      }
    },
    [axiosConfig, defaultHeaders],
  );

  const numaPost = useCallback(
    async (url, data, headers = {}) => {
      const response = await axios.post(url, data, {
        ...axiosConfig,
        headers: { ...defaultHeaders, ...headers },
      });
      return response.data;
    },
    [axiosConfig, defaultHeaders],
  );

  const numaPut = useCallback(
    async (url, data, headers = {}) => {
      const response = await axios.put(url, data, {
        ...axiosConfig,
        headers: { ...defaultHeaders, ...headers },
      });
      return response.data;
    },
    [axiosConfig, defaultHeaders],
  );

  const numaDelete = useCallback(
    async (url, headers = {}) => {
      const response = await axios.delete(url, {
        ...axiosConfig,
        headers: { ...defaultHeaders, ...headers },
      });
      return response.data;
    },
    [axiosConfig, defaultHeaders],
  );

  const value = useMemo(
    () => ({
      numaGet,
      numaPost,
      numaPut,
      numaDelete,
    }),
    [numaGet, numaPost, numaPut, numaDelete],
  );

  return <NumaRequestContext.Provider value={value}>{children}</NumaRequestContext.Provider>;
};

import axios from 'axios';
import { useAuth } from './AuthProvider';
import { NumaRequestContext } from './NumaRequestContext';

export const NumaRequestProvider = ({ children }) => {
  const { user } = useAuth();

  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...(user?.tokens?.accessToken && {
      authorization: user.tokens.accessToken,
    }),
  };

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

  const axiosConfig = {
    transformResponse: [
      (data) => {
        try {
          const parsedData = JSON.parse(data);
          return parseNestedJson(parsedData);
        } catch {
          return data;
        }
      },
    ],
  };

  // Common request methods
  const numaGet = async (url, params, headers = {}) => {
    const response = await axios.get(url, {
      ...axiosConfig,
      params,
      headers: { ...defaultHeaders, ...headers },
    });
    return response.data;
  };

  const numaPost = async (url, data, headers = {}) => {
    const response = await axios.post(url, data, {
      headers: { ...defaultHeaders, ...headers },
    });
    return response.data;
  };

  const numaPut = async (url, data, headers = {}) => {
    const response = await axios.put(url, data, {
      headers: { ...defaultHeaders, ...headers },
    });
    return response.data;
  };

  const numaDelete = async (url, headers = {}) => {
    const response = await axios.delete(url, {
      headers: { ...defaultHeaders, ...headers },
    });
    return response.data;
  };

  const value = {
    numaGet,
    numaPost,
    numaPut,
    numaDelete,
  };

  return <NumaRequestContext.Provider value={value}>{children}</NumaRequestContext.Provider>;
};

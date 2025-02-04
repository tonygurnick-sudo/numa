import React, { createContext, useContext } from 'react';
import axios from 'axios';
import { useAuth } from './AuthProvider';

const NumaRequestContext = createContext();

export const useNumaRequest = () => {
  const context = useContext(NumaRequestContext);
  if (!context) {
    throw new Error('useRequest must be used within a RequestProvider');
  }
  return context;
};

export const NumaRequestProvider = ({ children }) => {
  const { user } = useAuth();

  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...(user?.tokens?.accessToken && {
      'authorization': user.tokens.accessToken
    }),
  };

  // Common request methods
  const numaGet = async (url, params, headers = {}) => {
    const response = await axios.get(url, {
      params,
      headers: { ...defaultHeaders, ...headers }
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

  return (
    <NumaRequestContext.Provider value={value}>
      {children}
    </NumaRequestContext.Provider>
  );
};

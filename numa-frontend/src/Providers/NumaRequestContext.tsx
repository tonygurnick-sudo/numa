import { createContext, useContext } from 'react';

type Headers = Record<string, unknown>;

type NumaRequestContextValue = {
  numaGet: (url: string, params?: unknown, headers?: Headers) => Promise<unknown>;
  numaPost: (url: string, data: unknown, headers?: Headers) => Promise<unknown>;
  numaPut: (url: string, data: unknown, headers?: Headers) => Promise<unknown>;
  numaDelete: (url: string, headers?: Headers) => Promise<unknown>;
};

const throwProviderError = (method: keyof NumaRequestContextValue) => {
  throw new Error(`NumaRequestContext.${method} called outside of NumaRequestProvider`);
};

const defaultContext: NumaRequestContextValue = {
  numaGet: async (url, params, headers) => {
    throwProviderError('numaGet');
    return Promise.resolve({ url, params, headers });
  },
  numaPost: async (url, data, headers) => {
    throwProviderError('numaPost');
    return Promise.resolve({ url, data, headers });
  },
  numaPut: async (url, data, headers) => {
    throwProviderError('numaPut');
    return Promise.resolve({ url, data, headers });
  },
  numaDelete: async (url, headers) => {
    throwProviderError('numaDelete');
    return Promise.resolve({ url, headers });
  },
};

export const NumaRequestContext = createContext<NumaRequestContextValue>(defaultContext);

export const useNumaRequest = () => {
  const context = useContext(NumaRequestContext);
  if (!context) {
    throw new Error('useRequest must be used within a NumaRequestProvider');
  }
  return context;
};

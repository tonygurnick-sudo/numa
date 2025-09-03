import { createContext, useContext } from 'react';

export const NumaRequestContext = createContext({
  numaGet: async () => {},
  numaPost: async () => {},
  numaPut: async () => {},
  numaDelete: async () => {},
});

export const useNumaRequest = () => {
  const context = useContext(NumaRequestContext);
  if (!context) {
    throw new Error('useRequest must be used within a NumaRequestProvider');
  }
  return context;
};

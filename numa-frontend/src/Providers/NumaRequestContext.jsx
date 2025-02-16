import { createContext, useContext } from 'react';

export const NumaRequestContext = createContext();

export const useNumaRequest = () => {
  const context = useContext(NumaRequestContext);
  if (!context) {
    throw new Error('useRequest must be used within a RequestProvider');
  }
  return context;
};

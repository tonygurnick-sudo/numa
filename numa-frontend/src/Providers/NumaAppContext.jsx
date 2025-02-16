import { createContext, useContext } from 'react';

// Create the context
export const NumaAppContext = createContext();
// Custom hook for using context

export const useNumaApp = () => useContext(NumaAppContext);

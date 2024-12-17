import { useContext, createContext } from "react";

export const ServiceLocatorContext = createContext();

export function useServiceLocator() {
  const context = useContext(ServiceLocatorContext);
  if (!context) {
    throw new Error(
      'useServiceLocator must be used within a ServiceLocatorProvider',
    );
  }
  return context;
}

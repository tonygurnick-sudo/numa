import { NicetyContext } from './NicetyContext';
import { useState, useEffect } from 'react';
import niceties from '../../niceties.json';

const ENABLED = 'enabled';
const DISABLED = 'disabled';

export const NicetyProvider = ({ children }) => {
  const [enabledNiceties, setEnabledNiceties] = useState({});

  useEffect(() => {
    const loadedNiceties = {};
    niceties.forEach((nicety) => {
      const status = localStorage.getItem(`nicety-${nicety.id}`);
      loadedNiceties[nicety.id] = status === ENABLED || (status === null && nicety.default === true);
    });
    setEnabledNiceties(loadedNiceties);
  }, []);

  const toggle = (nicetyId, enabled) => {
    const key = `nicety-${nicetyId}`;
    localStorage.setItem(key, enabled ? ENABLED : DISABLED);
    setEnabledNiceties((prev) => ({
      ...prev,
      [nicetyId]: enabled,
    }));
  };

  const isEnabled = (nicetyId) => {
    return enabledNiceties[nicetyId] || niceties.find((nicety) => nicety.id === nicetyId)?.default === true;
  };

  const contextValue = {
    niceties,
    enabledNiceties,
    toggle,
    isEnabled,
  };

  return <NicetyContext.Provider value={contextValue}>{children}</NicetyContext.Provider>;
};

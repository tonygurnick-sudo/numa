import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { setCurrencyState } from './shared';

// Display-currency provider. Source data is always USD; this just controls the
// presentation. Persists to localStorage so the operator's choice survives a
// reload. fmtUSD / fmtUSDc in shared.ts read from the module-level state we
// push here — so every callsite picks up the change at next render.
//
// Subscribing components call useCurrency() at the top of their render
// function. They don't need the returned value (the formatters work via
// module state), but the context subscription is what makes React re-render
// them when the user flips the currency or edits the rate.

const STORAGE_KEY_CODE = 'nd:currency';
const STORAGE_KEY_RATE = 'nd:currencyRate';
const STORAGE_KEY_PREFIX = 'nd:currencyPrefix';

export interface CurrencyContextValue {
  code: string;
  rate: number;
  prefix: string;
  setCurrency: (code: string, rate: number, prefix: string) => void;
}

const DEFAULT: CurrencyContextValue = {
  code: 'USD',
  rate: 1,
  prefix: '$',
  setCurrency: () => {},
};

const CurrencyContext = createContext<CurrencyContextValue>(DEFAULT);

function readStored(): { code: string; rate: number; prefix: string } {
  if (typeof window === 'undefined') return { code: 'USD', rate: 1, prefix: '$' };
  try {
    const code = window.localStorage.getItem(STORAGE_KEY_CODE) || 'USD';
    const rate = Number(window.localStorage.getItem(STORAGE_KEY_RATE) || '1') || 1;
    const prefix = window.localStorage.getItem(STORAGE_KEY_PREFIX) || (code === 'USD' ? '$' : code + '$');
    return { code, rate, prefix };
  } catch {
    return { code: 'USD', rate: 1, prefix: '$' };
  }
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [{ code, rate, prefix }, setState] = useState(readStored);

  // Push state into shared.ts on every change so the formatters see it.
  useEffect(() => {
    setCurrencyState({ code, rate, prefix });
    try {
      window.localStorage.setItem(STORAGE_KEY_CODE, code);
      window.localStorage.setItem(STORAGE_KEY_RATE, String(rate));
      window.localStorage.setItem(STORAGE_KEY_PREFIX, prefix);
    } catch {
      // localStorage might be disabled — fine, in-memory state still works.
    }
  }, [code, rate, prefix]);

  const setCurrency = useCallback((c: string, r: number, p: string) => {
    setState({ code: c, rate: r, prefix: p });
  }, []);

  const value = useMemo<CurrencyContextValue>(
    () => ({ code, rate, prefix, setCurrency }),
    [code, rate, prefix, setCurrency]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/** Subscribe to currency changes — call from any component that displays money
 *  via fmtUSD/fmtUSDc to ensure it re-renders when the user changes currency. */
export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}

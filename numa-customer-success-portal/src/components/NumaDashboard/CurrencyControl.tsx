import { useEffect, useState } from 'react';
import { useCurrency } from './currencyContext';

// Lives in the dashboard header. Two pieces: a currency picker (USD/NZD) and
// a freeform rate input. Source data is USD; the rate is applied at display
// time only. Defaults to 1.65 NZD/USD on first NZD selection — operators
// override with the live rate.

const PRESETS: Array<{ code: string; prefix: string; defaultRate: number }> = [
  { code: 'USD', prefix: '$', defaultRate: 1 },
  { code: 'NZD', prefix: 'NZ$', defaultRate: 1.65 },
];

export function CurrencyControl() {
  const { code, rate, setCurrency } = useCurrency();
  // Local rate buffer so the user can type "1.6" without each keystroke
  // triggering a re-render of every money number in the dashboard. We push
  // to context on blur or Enter.
  const [rateBuffer, setRateBuffer] = useState(String(rate));

  useEffect(() => {
    setRateBuffer(String(rate));
  }, [rate]);

  const commitRate = () => {
    const parsed = Number(rateBuffer);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setRateBuffer(String(rate));
      return;
    }
    if (parsed === rate) return;
    const preset = PRESETS.find((p) => p.code === code);
    setCurrency(code, parsed, preset?.prefix || code + '$');
  };

  const pickCode = (nextCode: string) => {
    const preset = PRESETS.find((p) => p.code === nextCode);
    const nextRate = preset?.defaultRate ?? 1;
    const nextPrefix = preset?.prefix ?? nextCode + '$';
    setCurrency(nextCode, nextRate, nextPrefix);
  };

  return (
    <div className="d-flex align-items-center gap-2" style={{ fontSize: '0.85rem' }}>
      <label className="text-muted" style={{ fontSize: '0.75rem' }}>
        Currency
      </label>
      <select
        className="form-select form-select-sm"
        value={code}
        onChange={(e) => pickCode(e.target.value)}
        style={{ width: 75 }}
        title="Source data is USD. Selecting NZD multiplies displayed dollar values by the rate."
      >
        {PRESETS.map((p) => (
          <option key={p.code} value={p.code}>
            {p.code}
          </option>
        ))}
      </select>
      {code !== 'USD' && (
        <>
          <input
            type="number"
            step="0.0001"
            min="0.0001"
            className="form-control form-control-sm"
            value={rateBuffer}
            onChange={(e) => setRateBuffer(e.target.value)}
            onBlur={commitRate}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitRate();
                (e.target as HTMLInputElement).blur();
              }
            }}
            style={{ width: 90 }}
            title={`Exchange rate: 1 USD = ? ${code}`}
          />
          <span className="text-muted" style={{ fontSize: '0.7rem' }}>
            {code}/USD
          </span>
        </>
      )}
    </div>
  );
}

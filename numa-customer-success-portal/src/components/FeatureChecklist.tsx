import { Form } from 'react-bootstrap';
import { BASIC_FEATURES as BASIC, ADMIN_ONLY_FEATURES as ADMIN_ONLY } from '@/constants/features';

export function FeatureChecklist({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = new Set(
    value
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const toggle = (name: string, checked: boolean) => {
    const next = new Set(current);
    if (checked) next.add(name);
    else next.delete(name);
    onChange(Array.from(next).join('\n'));
  };

  return (
    <div className="d-flex flex-column gap-2">
      <div className="d-flex flex-column gap-1">
        {BASIC.map((f) => (
          <Form.Check
            key={f}
            type="checkbox"
            id={`feat-${f}`}
            label={f}
            checked={current.has(f)}
            onChange={(e) => toggle(f, e.currentTarget.checked)}
          />
        ))}
      </div>
      <div className="text-muted small">Recommended Admin Only</div>
      <div className="d-flex flex-column gap-1">
        {ADMIN_ONLY.map((f) => (
          <Form.Check
            key={f}
            type="checkbox"
            id={`feat-${f}`}
            label={f}
            checked={current.has(f)}
            onChange={(e) => toggle(f, e.currentTarget.checked)}
          />
        ))}
      </div>
    </div>
  );
}

export default FeatureChecklist;

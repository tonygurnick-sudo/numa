import { useMemo } from 'react';
import { Button, OverlayTrigger, Tooltip } from 'react-bootstrap';

type AgentIconPickerProps = {
  value?: string;
  onChange: (icon: string) => void;
};

const ICON_OPTIONS: { value: string; label: string }[] = [
  { value: 'bi bi-robot', label: 'Assistant' },
  { value: 'bi bi-lightning-charge', label: 'Automation' },
  { value: 'bi bi-journal-text', label: 'Documentation' },
  { value: 'bi bi-people', label: 'People Ops' },
  { value: 'bi bi-briefcase', label: 'Business' },
  { value: 'bi bi-graph-up', label: 'Analytics' },
  { value: 'bi bi-shield-check', label: 'Compliance' },
  { value: 'bi bi-gear', label: 'Operations' },
];

export const AgentIconPicker = ({ value, onChange }: AgentIconPickerProps) => {
  const selected = useMemo(() => value ?? ICON_OPTIONS[0].value, [value]);

  return (
    <div className="d-flex flex-wrap gap-2">
      {ICON_OPTIONS.map((icon) => {
        const isActive = icon.value === selected;
        const button = (
          <Button
            key={icon.value}
            variant={isActive ? 'primary' : 'outline-secondary'}
            size="sm"
            onClick={() => onChange(icon.value)}
            aria-pressed={isActive}
          >
            <i className={icon.value}></i>
          </Button>
        );
        return (
          <OverlayTrigger
            key={icon.value}
            placement="top"
            overlay={<Tooltip id={`icon-${icon.value}`}>{icon.label}</Tooltip>}
          >
            {button}
          </OverlayTrigger>
        );
      })}
    </div>
  );
};

export default AgentIconPicker;

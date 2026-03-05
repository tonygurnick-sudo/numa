import { useMemo } from 'react';
import { Button, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';

type AgentIconPickerProps = {
  value?: string;
  onChange: (icon: string) => void;
};

export const AgentIconPicker = ({ value, onChange }: AgentIconPickerProps) => {
  const { t } = useTranslation('agents');
  const iconOptions = useMemo(
    () => [
      { value: 'bi bi-robot', label: t('iconPicker.icons.assistant') },
      { value: 'bi bi-lightning-charge', label: t('iconPicker.icons.automation') },
      { value: 'bi bi-journal-text', label: t('iconPicker.icons.documentation') },
      { value: 'bi bi-people', label: t('iconPicker.icons.peopleOps') },
      { value: 'bi bi-briefcase', label: t('iconPicker.icons.business') },
      { value: 'bi bi-graph-up', label: t('iconPicker.icons.analytics') },
      { value: 'bi bi-shield-check', label: t('iconPicker.icons.compliance') },
      { value: 'bi bi-gear', label: t('iconPicker.icons.operations') },
    ],
    [t]
  );
  const selected = useMemo(() => value ?? iconOptions[0].value, [value, iconOptions]);

  return (
    <div className="d-flex flex-wrap gap-2">
      {iconOptions.map((icon) => {
        const isActive = icon.value === selected;
        const button = (
          <Button
            key={icon.value}
            variant={isActive ? 'primary' : 'outline-secondary'}
            size="sm"
            onClick={() => onChange(icon.value)}
            aria-pressed={isActive}
          >
            {icon.value === 'bi bi-robot' ? <Bot size={16} /> : <i className={icon.value}></i>}
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

import { useMemo } from 'react';
import { Button, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { TICKET_TYPE_ICON_MAP, getTicketTypeIconClass } from '../../../constants/opsConstants';

type TicketTypeIconPickerProps = {
  value: string;
  onChange: (icon: string) => void;
};

const TicketTypeIconPicker = ({ value, onChange }: TicketTypeIconPickerProps) => {
  const iconOptions = useMemo(() => Object.keys(TICKET_TYPE_ICON_MAP), []);
  const selected = value || iconOptions[0];

  return (
    <div className="d-flex flex-wrap gap-2">
      {iconOptions.map((key) => {
        const isActive = key === selected;
        return (
          <OverlayTrigger key={key} placement="top" overlay={<Tooltip id={`tt-icon-${key}`}>{key}</Tooltip>}>
            <Button
              variant={isActive ? 'primary' : 'outline-secondary'}
              size="sm"
              onClick={() => onChange(key)}
              aria-pressed={isActive}
              style={{ width: 36, height: 36 }}
              className="d-flex align-items-center justify-content-center p-0"
            >
              <i className={getTicketTypeIconClass(key)} />
            </Button>
          </OverlayTrigger>
        );
      })}
    </div>
  );
};

export default TicketTypeIconPicker;

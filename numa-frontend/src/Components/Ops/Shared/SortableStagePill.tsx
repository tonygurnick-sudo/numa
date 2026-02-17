import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Form, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { Status } from '../../../types/ops';

interface SortableStagePillProps {
  id: string;
  name: string;
  statusId: string;
  statusType: string;
  statuses: Status[];
  onNameChange: (value: string) => void;
  onStatusChange: (statusId: string) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}

export function SortableStagePill({
  id,
  name,
  statusId,
  statusType: _statusType,
  statuses,
  onNameChange,
  onStatusChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: SortableStagePillProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [isEditing, setIsEditing] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style} className="d-flex align-items-center gap-2 mb-2">
        <i className="bi bi-grip-vertical text-muted" {...attributes} {...listeners} style={{ cursor: 'grab' }} />
        <Form.Control
          type="text"
          size="sm"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          style={{ maxWidth: 180 }}
          autoFocus
        />
        <Form.Select
          size="sm"
          value={statusId}
          onChange={(e) => onStatusChange(e.target.value)}
          style={{ maxWidth: 160 }}
        >
          <option value="">{t('common.selectOption')}</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Form.Select>
        {onMoveUp && (
          <Button variant="outline-secondary" size="sm" disabled={isFirst} onClick={onMoveUp}>
            <i className="bi bi-arrow-up" />
          </Button>
        )}
        {onMoveDown && (
          <Button variant="outline-secondary" size="sm" disabled={isLast} onClick={onMoveDown}>
            <i className="bi bi-arrow-down" />
          </Button>
        )}
        <Button variant="outline-danger" size="sm" onClick={onRemove}>
          <i className="bi bi-trash" />
        </Button>
        <Button variant="outline-secondary" size="sm" onClick={() => setIsEditing(false)}>
          <i className="bi bi-check" />
        </Button>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className="d-flex align-items-center gap-2 mb-2">
      <i className="bi bi-grip-vertical text-muted" {...attributes} {...listeners} style={{ cursor: 'grab' }} />
      <Form.Control
        type="text"
        size="sm"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        style={{ maxWidth: 180 }}
      />
      <Form.Select
        size="sm"
        value={statusId}
        onChange={(e) => onStatusChange(e.target.value)}
        style={{ maxWidth: 160 }}
      >
        <option value="">{t('common.selectOption')}</option>
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Form.Select>
      {onMoveUp && (
        <Button variant="outline-secondary" size="sm" disabled={isFirst} onClick={onMoveUp}>
          <i className="bi bi-arrow-up" />
        </Button>
      )}
      {onMoveDown && (
        <Button variant="outline-secondary" size="sm" disabled={isLast} onClick={onMoveDown}>
          <i className="bi bi-arrow-down" />
        </Button>
      )}
      <Button variant="outline-danger" size="sm" onClick={onRemove}>
        <i className="bi bi-trash" />
      </Button>
    </div>
  );
}

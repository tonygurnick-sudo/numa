import React, { useMemo } from 'react';
import { Modal, ListGroup } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { WorkStage, WorkZone } from '../../../types/ops';

// ─── Props ──────────────────────────────────────────────────────────────────

interface StagePickerModalProps {
  show: boolean;
  stages: WorkStage[];
  zones: WorkZone[];
  onSelect: (stageId: string) => void;
  onHide: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * StagePickerModal is a small disambiguation dialog shown when a status
 * change maps to more than one possible stage.  The user picks the target
 * stage and the caller receives the selected ID via `onSelect`.
 *
 * Each list item shows the zone name followed by an arrow and the stage name
 * so the user can tell which zone the stage belongs to.
 */
export function StagePickerModal({ show, stages, zones, onSelect, onHide }: StagePickerModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  /** Map zone IDs to zone names for display */
  const zoneNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    zones.forEach((z) => {
      map[z.id] = z.name;
    });
    return map;
  }, [zones]);

  const handleSelect = (stageId: string) => {
    onSelect(stageId);
    onHide();
  };

  return (
    <Modal show={show} onHide={onHide} centered size="sm">
      <Modal.Header closeButton>
        <Modal.Title>{t('stagePicker.title')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <p className="text-muted mb-3">{t('stagePicker.description')}</p>

        <ListGroup>
          {stages.map((stage) => (
            <ListGroup.Item
              key={stage.id}
              action
              onClick={() => handleSelect(stage.id)}
              className="d-flex align-items-center"
            >
              <span className="text-muted me-2">{zoneNameMap[stage.zoneId] ?? stage.zoneId}</span>
              <span className="me-2">&rarr;</span>
              <span className="fw-semibold">{stage.name}</span>
            </ListGroup.Item>
          ))}
        </ListGroup>
      </Modal.Body>
    </Modal>
  );
}

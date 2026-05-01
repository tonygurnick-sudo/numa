/* eslint-disable i18next/no-literal-string */
import React, { useMemo } from 'react';
import { Form, Row, Col } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { StaffAvatar } from '../../Shared/StaffAvatar';
import type { WorkZone, WorkStage, StaffProfile } from '../../../../types/ops';

const ANNOUNCEMENT_MAX_LENGTH = 280;

interface GeneralTabProps {
  name: string;
  setName: (v: string) => void;
  color: string;
  setColor: (v: string) => void;
  announcement: string;
  setAnnouncement: (v: string) => void;
  defaultZoneId: string;
  setDefaultZoneId: (v: string) => void;
  defaultStageId: string;
  setDefaultStageId: (v: string) => void;
  zones: Partial<WorkZone>[];
  stages: Partial<WorkStage>[];
  createdBy?: string;
  staff?: StaffProfile[];
}

export function GeneralTab({
  name,
  setName,
  color,
  setColor,
  announcement,
  setAnnouncement,
  defaultZoneId,
  setDefaultZoneId,
  defaultStageId,
  setDefaultStageId,
  zones,
  stages,
  createdBy,
  staff,
}: GeneralTabProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  const owner = useMemo(
    () => (createdBy && staff ? staff.find((s) => s.id === createdBy) : undefined),
    [createdBy, staff]
  );

  const sortedZones = [...zones].filter((z) => z.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const defaultZoneStages = defaultZoneId
    ? stages.filter((s) => s.zoneId === defaultZoneId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];

  return (
    <>
      {/* Team owner */}
      {owner && (
        <div className="d-flex align-items-center gap-2 mb-3 p-2 bg-light rounded">
          <StaffAvatar staff={owner} size={28} />
          <div>
            <div className="small text-muted">{t('boards.owner')}</div>
            <div style={{ fontSize: '0.85rem' }}>{owner.name || owner.email}</div>
          </div>
        </div>
      )}

      {/* Team name & color */}
      <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
        <h6 className="fw-bold text-dark mb-3">Basic Information</h6>
        <Form.Group className="mb-3">
          <Form.Label className="small fw-medium text-muted">{t('boards.name')}</Form.Label>
          <Form.Control type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </Form.Group>

        <Form.Group>
          <Form.Label className="small fw-medium text-muted">{t('boards.color')}</Form.Label>
          <div className="d-flex align-items-center gap-3">
            <Form.Control
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              title={t('common.chooseColor', 'Choose your color')}
              className="p-1"
              style={{ width: '48px', height: '36px', cursor: 'pointer', borderRadius: '4px' }}
            />
            <Form.Control
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#000000"
              style={{ maxWidth: '120px' }}
            />
          </div>
        </Form.Group>
      </div>

      {/* Board Announcement */}
      <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
        <h6 className="fw-bold text-dark mb-3">{t('settings.announcement')}</h6>
        <Form.Group className="mb-2">
          <Form.Control
            as="textarea"
            rows={3}
            size="sm"
            value={announcement}
            onChange={(e) => {
              if (e.target.value.length <= ANNOUNCEMENT_MAX_LENGTH) {
                setAnnouncement(e.target.value);
              }
            }}
            placeholder={t('settings.announcementPlaceholder')}
          />
          <div className="d-flex justify-content-between align-items-center mt-1">
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>
              {t('settings.announcementHelp')}
            </span>
            <span className="d-flex align-items-center gap-2">
              {announcement && (
                <button
                  type="button"
                  className="btn btn-sm btn-link text-muted p-0"
                  onClick={() => setAnnouncement('')}
                >
                  {t('settings.announcementClear')}
                </button>
              )}
              <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                {t('settings.announcementCharCount', { count: announcement.length })}
              </span>
            </span>
          </div>
        </Form.Group>
      </div>

      {/* Default Location */}
      {sortedZones.length > 0 && (
        <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
          <h6 className="fw-bold text-dark mb-1">{t('settings.defaultLocation')}</h6>
          <p className="text-muted small mb-3">{t('settings.defaultLocationHelp')}</p>
          <Row>
            <Col md={6}>
              <Form.Group className="mb-2">
                <Form.Label className="small fw-medium text-muted">{t('settings.defaultZone')}</Form.Label>
                <Form.Select
                  size="sm"
                  value={defaultZoneId}
                  onChange={(e) => {
                    setDefaultZoneId(e.target.value);
                    setDefaultStageId('');
                  }}
                >
                  <option value="">{t('zones.selectZone')}</option>
                  {sortedZones.map((z) => (
                    <option key={z.id} value={z.id!}>
                      {z.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-2">
                <Form.Label className="small fw-medium text-muted">{t('settings.defaultStage')}</Form.Label>
                <Form.Select
                  size="sm"
                  value={defaultStageId}
                  onChange={(e) => setDefaultStageId(e.target.value)}
                  disabled={defaultZoneStages.length === 0}
                >
                  <option value="">{t('zones.selectStage')}</option>
                  {defaultZoneStages.map((s) => (
                    <option key={s.id} value={s.id!}>
                      {s.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>
        </div>
      )}
    </>
  );
}

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Modal, Form, Button, Badge, Row, Col, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { DynamicField } from '../Shared/DynamicField';
import type {
  Ticket,
  TicketType,
  TicketPriority,
  CreateTicketPayload,
  FieldDefinition,
  FieldOverride,
  Customer,
  Supplier,
} from '../../../types/ops';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';

// ─── Props ──────────────────────────────────────────────────────────────────

interface CreateTicketModalProps {
  show: boolean;
  onHide: () => void;
  onSuccess: (ticket: Ticket) => void;
}

// ─── Priority options ───────────────────────────────────────────────────────

const PRIORITIES: TicketPriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * CreateTicketModal renders a large modal form for creating a new ops ticket.
 *
 * It reads config, team data, and work units from the OpsContext so that
 * ticket-type selection, zone/stage cascading, assignee, project, and
 * dynamic-field rendering are all driven by live server config.
 */
export function CreateTicketModal({ show, onHide, onSuccess }: CreateTicketModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPost, numaGet } = useNumaRequest();
  const { config, teamData, workUnits, refreshTickets } = useOps();

  // ── Form state ────────────────────────────────────────────────────────────
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [zoneId, setZoneId] = useState<string>('');
  const [stageId, setStageId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [customerId, setCustomerId] = useState<string>('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [workUnitId, setWorkUnitId] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [tagsInput, setTagsInput] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  // ── UI state ──────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);

  // ── CRM data (customers / suppliers) ──────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;

    const load = async () => {
      try {
        const [custs, supps] = await Promise.all([
          OpsService.listCustomers(numaGet),
          OpsService.listSuppliers(numaGet),
        ]);
        if (!cancelled) {
          setCustomers(custs);
          setSuppliers(supps);
        }
      } catch {
        // Non-critical — selects will simply be empty
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [show, numaGet]);

  // ── Derived values ────────────────────────────────────────────────────────

  /** Ticket types allowed by the current team (no restrictions = show all) */
  const allowedTypes: TicketType[] = useMemo(() => {
    if (!config || !teamData?.team) return [];
    const restrictedTypes = teamData.team.allowedTicketTypes;
    if (!restrictedTypes || restrictedTypes.length === 0) {
      return [...config.ticketTypes].sort((a, b) => a.order - b.order);
    }
    const allowed = new Set(restrictedTypes);
    return config.ticketTypes.filter((tt) => allowed.has(tt.id)).sort((a, b) => a.order - b.order);
  }, [config, teamData]);

  /** The currently selected ticket type definition */
  const selectedType: TicketType | undefined = useMemo(
    () => allowedTypes.find((tt) => tt.id === selectedTypeId),
    [allowedTypes, selectedTypeId],
  );

  /** Zones belonging to the current team */
  const zones = useMemo(() => teamData?.zones ?? [], [teamData]);

  /** Stages for the currently selected zone */
  const filteredStages = useMemo(() => {
    if (!teamData || !zoneId) return [];
    return teamData.stages.filter((s) => s.zoneId === zoneId).sort((a, b) => a.order - b.order);
  }, [teamData, zoneId]);

  /** Active staff members */
  const activeStaff = useMemo(() => (config?.staff ?? []).filter((s) => s.isActive), [config]);

  /** Active projects */
  const activeProjects = useMemo(() => (config?.projects ?? []).filter((p) => p.isActive), [config]);

  /** Whether work-unit selection should be shown */
  const showWorkUnits = teamData?.team?.workUnitSeries?.enabled === true;

  /** Dynamic field definitions for the selected ticket type */
  const dynamicFields: FieldDefinition[] = useMemo(() => {
    if (!selectedType || !config) return [];
    return selectedType.defaultFields
      .map((fId) => config.fields.find((f) => f.id === fId))
      .filter((f): f is FieldDefinition => f !== undefined);
  }, [selectedType, config]);

  /** Team-level field overrides */
  const fieldOverrides: Record<string, FieldOverride> = useMemo(() => teamData?.team?.fieldOverrides ?? {}, [teamData]);

  // ── Reset form when modal opens / ticket type changes ─────────────────────

  useEffect(() => {
    if (show) {
      // Pre-fill zone with the team default
      const defaultZone = teamData?.team?.defaultZoneId ?? '';
      setZoneId(defaultZone);

      // Pre-select the team's configured default stage, falling back to the first stage in the zone
      const teamDefaultStageId = teamData?.team?.defaultStageId;
      if (teamDefaultStageId && teamData?.stages.some((s) => s.id === teamDefaultStageId)) {
        setStageId(teamDefaultStageId);
      } else if (defaultZone && teamData) {
        const firstStage = teamData.stages.filter((s) => s.zoneId === defaultZone).sort((a, b) => a.order - b.order)[0];
        setStageId(firstStage?.id ?? '');
      } else {
        setStageId('');
      }

      // Pre-select first allowed type
      if (allowedTypes.length > 0 && !selectedTypeId) {
        setSelectedTypeId(allowedTypes[0].id);
      }
    }
  }, [show, teamData, allowedTypes, selectedTypeId]);

  // When zone changes, reset stage to first available
  useEffect(() => {
    if (filteredStages.length > 0) {
      // Only reset if current stage is not in the new zone
      if (!filteredStages.find((s) => s.id === stageId)) {
        setStageId(filteredStages[0].id);
      }
    } else {
      setStageId('');
    }
  }, [zoneId, filteredStages]);

  // ── Reset entire form ─────────────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setSelectedTypeId(allowedTypes[0]?.id ?? '');
    setTitle('');
    setDescription('');
    setPriority('medium');
    setAssigneeId('');
    setZoneId(teamData?.team?.defaultZoneId ?? '');
    setStageId('');
    setProjectId('');
    setCustomerId('');
    setSupplierId('');
    setWorkUnitId('');
    setDueDate('');
    setTagsInput('');
    setCustomFields({});
    setError(null);
    setValidated(false);
  }, [allowedTypes, teamData]);

  useEffect(() => {
    if (!show) {
      resetForm();
    }
  }, [show, resetForm]);

  // ── Dynamic field value helpers ───────────────────────────────────────────

  const setFieldValue = useCallback((fieldId: string, value: unknown) => {
    setCustomFields((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  // ── Submission ────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidated(true);

    const form = e.currentTarget;
    if (!form.checkValidity()) return;
    if (!teamData || !selectedTypeId || !title.trim()) return;

    // Check required custom fields
    for (const field of dynamicFields) {
      const override = fieldOverrides[field.id];
      if (override?.required && !customFields[field.id]) {
        return; // Browser validation should catch this via the DynamicField required prop
      }
    }

    setSaving(true);
    setError(null);

    try {
      const tags = tagsInput
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

      const payload: CreateTicketPayload = {
        teamId: teamData.team.id,
        ticketTypeId: selectedTypeId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        zoneId: zoneId || undefined,
        stageId: stageId || undefined,
        assigneeId: assigneeId || null,
        projectId: projectId || null,
        customerId: customerId || null,
        supplierId: supplierId || null,
        workUnitId: workUnitId || null,
        dueDate: dueDate || null,
        tags: tags.length > 0 ? tags : undefined,
        fields: Object.keys(customFields).length > 0 ? customFields : undefined,
      };

      const ticket = await OpsService.createTicket(numaPost, payload);
      await refreshTickets();
      onSuccess(ticket);
      onHide();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(t('errors.saveFailed', { message }));
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Form noValidate validated={validated} onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>{t('tickets.create')}</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <p className="text-muted small mb-3">
            <span className="text-danger">*</span> {t('common.requiredFields')}
          </p>

          {/* ── Ticket Type Selector ──────────────────────────────────────── */}
          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">
              {t('tickets.selectType')} <span className="text-danger">*</span>
            </Form.Label>
            <div className="d-flex flex-wrap gap-2">
              {allowedTypes.map((tt) => (
                <Badge
                  key={tt.id}
                  bg=""
                  role="button"
                  className="px-3 py-2 fs-6"
                  style={{
                    backgroundColor: tt.id === selectedTypeId ? tt.color : 'transparent',
                    color: tt.id === selectedTypeId ? '#fff' : tt.color,
                    border: `2px solid ${tt.color}`,
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedTypeId(tt.id)}
                >
                  <i className={getTicketTypeIconClass(tt.icon)} /> {tt.name}
                </Badge>
              ))}
            </div>
          </Form.Group>

          {/* ── Title ─────────────────────────────────────────────────────── */}
          <Form.Group className="mb-3">
            <Form.Label>
              {t('tickets.title')} <span className="text-danger">*</span>
            </Form.Label>
            <Form.Control type="text" required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            <Form.Control.Feedback type="invalid">{t('common.required')}</Form.Control.Feedback>
          </Form.Group>

          {/* ── Description ───────────────────────────────────────────────── */}
          <Form.Group className="mb-3">
            <Form.Label>{t('tickets.description')}</Form.Label>
            <Form.Control as="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Form.Group>

          <Row>
            {/* ── Priority ──────────────────────────────────────────────────── */}
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>{t('tickets.priority')}</Form.Label>
                <Form.Select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`priority.${p}`)}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>

            {/* ── Assignee ──────────────────────────────────────────────────── */}
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>{t('tickets.assignee')}</Form.Label>
                <Form.Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">{t('fields.unassigned')}</option>
                  {activeStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          <Row>
            {/* ── Zone ──────────────────────────────────────────────────────── */}
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>{t('zones.zone')}</Form.Label>
                <Form.Select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                  <option value="">{t('zones.selectZone')}</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>

            {/* ── Stage ─────────────────────────────────────────────────────── */}
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>{t('zones.stage')}</Form.Label>
                <Form.Select
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  disabled={filteredStages.length === 0}
                >
                  <option value="">{t('zones.selectStage')}</option>
                  {filteredStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          <Row>
            {/* ── Project ───────────────────────────────────────────────────── */}
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>{t('tickets.project')}</Form.Label>
                <Form.Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">{t('tickets.selectProject')}</option>
                  {activeProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>

            {/* ── Due Date ──────────────────────────────────────────────────── */}
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>{t('tickets.dueDate')}</Form.Label>
                <Form.Control type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Form.Group>
            </Col>
          </Row>

          <Row>
            {/* ── Customer ──────────────────────────────────────────────────── */}
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>{t('tickets.customer')}</Form.Label>
                <Form.Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">{t('tickets.selectCustomer')}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>

            {/* ── Supplier ──────────────────────────────────────────────────── */}
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>{t('tickets.supplier')}</Form.Label>
                <Form.Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">{t('tickets.selectSupplier')}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.companyName}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          {/* ── Work Unit (Sprint) ────────────────────────────────────────── */}
          {showWorkUnits && (
            <Form.Group className="mb-3">
              <Form.Label>{t('tickets.workUnit')}</Form.Label>
              <Form.Select value={workUnitId} onChange={(e) => setWorkUnitId(e.target.value)}>
                <option value="">{t('tickets.selectWorkUnit')}</option>
                {workUnits.map((wu) => (
                  <option key={wu.id} value={wu.id}>
                    {wu.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}

          {/* ── Tags ──────────────────────────────────────────────────────── */}
          <Form.Group className="mb-3">
            <Form.Label>{t('tickets.tags')}</Form.Label>
            <Form.Control
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder={t('tickets.tagsHelp')}
            />
            <Form.Text className="text-muted">{t('tickets.tagsHelp')}</Form.Text>
          </Form.Group>

          {/* ── Dynamic Fields ────────────────────────────────────────────── */}
          {dynamicFields.length > 0 && (
            <>
              <hr />
              <h6 className="mb-3">{t('fields.dynamicFields')}</h6>
              {dynamicFields.map((field) => (
                <DynamicField
                  key={field.id}
                  field={field}
                  value={customFields[field.id] ?? field.defaultValue ?? null}
                  onChange={(val) => setFieldValue(field.id, val)}
                  fieldOverride={fieldOverrides[field.id]}
                  staff={config?.staff}
                />
              ))}
            </>
          )}

          {/* ── Error ─────────────────────────────────────────────────────── */}
          {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={saving || !selectedTypeId}>
            {saving ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                {t('tickets.creating')}
              </>
            ) : (
              t('tickets.create')
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

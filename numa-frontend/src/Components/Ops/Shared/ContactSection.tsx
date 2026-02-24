import React, { useMemo, useState } from 'react';
import { Card, Button, Form, Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { Contact } from '../../../types/ops';

interface ContactSectionProps {
  contacts: Contact[];
  onChange: (contacts: Contact[]) => void;
}

/** Empty contact used as the template when adding a new entry. */
const emptyContact = (): Contact => ({
  name: '',
  role: null,
  email: null,
  phone: null,
  isPrimary: false,
  isVip: false,
  notes: null,
});

/**
 * ContactSection renders an editable grid of contact cards.
 *
 * All mutations go through the `onChange` callback so that the parent
 * component owns persistence. Inline editing, primary-radio and VIP-toggle
 * logic are handled locally.
 */
export function ContactSection({ contacts, onChange }: ContactSectionProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  // Track which contact index is currently being edited (-1 = none).
  const [editingIndex, setEditingIndex] = useState<number>(-1);

  // Draft values while editing inline.
  const [draft, setDraft] = useState<Contact>(emptyContact());

  // ── Helpers ───────────────────────────────────────────────────────────────

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setDraft({ ...contacts[index] });
  };

  const cancelEdit = () => {
    // If the contact at editingIndex has no name yet (newly added), remove it.
    if (editingIndex >= 0 && contacts[editingIndex] && !contacts[editingIndex].name) {
      const updated = contacts.filter((_, i) => i !== editingIndex);
      onChange(updated);
    }
    setEditingIndex(-1);
    setDraft(emptyContact());
  };

  const saveEdit = () => {
    if (!draft.name.trim()) return;
    const updated = contacts.map((c, i) => (i === editingIndex ? { ...draft, name: draft.name.trim() } : c));
    onChange(updated);
    setEditingIndex(-1);
    setDraft(emptyContact());
  };

  const addContact = () => {
    const newContact = emptyContact();
    const updated = [...contacts, newContact];
    onChange(updated);
    // Immediately open inline editing on the new contact.
    setEditingIndex(updated.length - 1);
    setDraft(newContact);
  };

  const removeContact = (index: number) => {
    const updated = contacts.filter((_, i) => i !== index);
    // If the removed contact was primary and there are remaining contacts, make the first one primary.
    if (contacts[index].isPrimary && updated.length > 0) {
      updated[0] = { ...updated[0], isPrimary: true };
    }
    onChange(updated);
    if (editingIndex === index) {
      setEditingIndex(-1);
      setDraft(emptyContact());
    } else if (editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
  };

  const togglePrimary = (index: number) => {
    // Radio-style: only one contact can be primary at a time.
    const updated = contacts.map((c, i) => ({ ...c, isPrimary: i === index }));
    onChange(updated);
  };

  const toggleVip = (index: number) => {
    const updated = contacts.map((c, i) => (i === index ? { ...c, isVip: !c.isVip } : c));
    onChange(updated);
  };

  const sortedContacts = useMemo(
    () =>
      contacts
        .map((contact, index) => ({ contact, index }))
        .sort((a, b) => {
          if (a.contact.isPrimary !== b.contact.isPrimary) return a.contact.isPrimary ? -1 : 1;
          if (a.contact.isVip !== b.contact.isVip) return a.contact.isVip ? -1 : 1;
          const byName = a.contact.name.localeCompare(b.contact.name, undefined, { sensitivity: 'base' });
          if (byName !== 0) return byName;
          return a.index - b.index;
        }),
    [contacts],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (contacts.length === 0 && editingIndex === -1) {
    return (
      <div>
        <div className="text-muted small mb-2">{t('crm.noContacts')}</div>
        <Button variant="outline-primary" size="sm" onClick={addContact}>
          <i className="bi bi-plus me-1" />
          {t('contacts.addContact')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="row g-2">
        {sortedContacts.map(({ contact, index }) => (
          <div className="col-md-6 col-lg-4" key={`${contact.name}-${index}`}>
            {editingIndex === index ? (
              /* ── Inline Edit Mode ──────────────────────────────────────── */
              <Card className="h-100">
                <Card.Body className="p-2">
                  <Form.Group className="mb-2">
                    <Form.Label className="small mb-0 fw-semibold">
                      {t('common.name')} <span className="text-danger">*</span>
                    </Form.Label>
                    <Form.Control
                      size="sm"
                      type="text"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      isInvalid={!draft.name.trim()}
                      autoFocus
                    />
                    <Form.Control.Feedback type="invalid">{t('contacts.nameRequired')}</Form.Control.Feedback>
                  </Form.Group>

                  <Form.Group className="mb-2">
                    <Form.Label className="small mb-0">{t('contacts.role')}</Form.Label>
                    <Form.Control
                      size="sm"
                      type="text"
                      value={draft.role ?? ''}
                      onChange={(e) => setDraft({ ...draft, role: e.target.value || null })}
                    />
                  </Form.Group>

                  <Form.Group className="mb-2">
                    <Form.Label className="small mb-0">{t('contacts.email')}</Form.Label>
                    <Form.Control
                      size="sm"
                      type="email"
                      value={draft.email ?? ''}
                      onChange={(e) => setDraft({ ...draft, email: e.target.value || null })}
                    />
                  </Form.Group>

                  <Form.Group className="mb-2">
                    <Form.Label className="small mb-0">{t('contacts.phone')}</Form.Label>
                    <Form.Control
                      size="sm"
                      type="tel"
                      value={draft.phone ?? ''}
                      onChange={(e) => setDraft({ ...draft, phone: e.target.value || null })}
                    />
                  </Form.Group>

                  <Form.Group className="mb-2">
                    <Form.Label className="small mb-0">{t('contacts.notes')}</Form.Label>
                    <Form.Control
                      size="sm"
                      as="textarea"
                      rows={2}
                      value={draft.notes ?? ''}
                      onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
                    />
                  </Form.Group>

                  <div className="d-flex gap-1 justify-content-end">
                    <Button variant="secondary" size="sm" onClick={cancelEdit}>
                      {t('common.cancel')}
                    </Button>
                    <Button variant="primary" size="sm" onClick={saveEdit} disabled={!draft.name.trim()}>
                      {t('common.save')}
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            ) : (
              /* ── Display Mode ──────────────────────────────────────────── */
              <Card className="h-100 ops-contact-card">
                <Card.Body className="p-2">
                  <div className="d-flex justify-content-between align-items-start mb-1">
                    <div>
                      <span className="fw-bold small">{contact.name}</span>
                      {contact.role && <span className="text-muted small ms-1">{contact.role}</span>}
                    </div>
                    <div className="d-flex gap-1 contact-actions">
                      {/* Primary toggle (radio-style) */}
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 text-warning"
                        onClick={() => togglePrimary(index)}
                        title={t('crm.primaryContact')}
                      >
                        <i className={`bi ${contact.isPrimary ? 'bi-star-fill' : 'bi-star'}`} />
                      </Button>

                      {/* VIP toggle */}
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 text-info"
                        onClick={() => toggleVip(index)}
                        title={t('crm.vip')}
                      >
                        <i
                          className={`bi ${contact.isVip ? 'bi-gem' : 'bi-gem'}`}
                          style={{ opacity: contact.isVip ? 1 : 0.3 }}
                        />
                      </Button>

                      {/* Edit */}
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 text-secondary"
                        onClick={() => startEdit(index)}
                        title={t('common.edit')}
                      >
                        <i className="bi bi-pencil" />
                      </Button>

                      {/* Delete */}
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 text-danger"
                        onClick={() => removeContact(index)}
                        title={t('common.delete')}
                      >
                        <i className="bi bi-trash" />
                      </Button>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="d-flex gap-1 mb-1">
                    {contact.isPrimary && (
                      <Badge bg="warning" text="dark" className="small">
                        {t('crm.primaryContact')}
                      </Badge>
                    )}
                    {contact.isVip && (
                      <Badge bg="info" className="small">
                        {t('crm.vip')}
                      </Badge>
                    )}
                  </div>

                  {/* Contact info */}
                  {contact.email && (
                    <div className="small text-truncate">
                      <i className="bi bi-envelope me-1 text-muted" />
                      <a href={`mailto:${contact.email}`}>{contact.email}</a>
                    </div>
                  )}
                  {contact.phone && (
                    <div className="small text-truncate">
                      <i className="bi bi-telephone me-1 text-muted" />
                      {contact.phone}
                    </div>
                  )}
                  {contact.notes && (
                    <div
                      className="small text-muted mt-1"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {contact.notes}
                    </div>
                  )}
                </Card.Body>
              </Card>
            )}
          </div>
        ))}
      </div>

      {/* Add button - only visible when not currently editing */}
      {editingIndex === -1 && (
        <Button variant="outline-primary" size="sm" className="mt-2" onClick={addContact}>
          <i className="bi bi-plus me-1" />
          {t('contacts.addContact')}
        </Button>
      )}

      <style>{`
        .ops-contact-card .contact-actions {
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .ops-contact-card:hover .contact-actions,
        .ops-contact-card:focus-within .contact-actions {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import Card from 'react-bootstrap/Card';
import Spinner from 'react-bootstrap/Spinner';
import Table from 'react-bootstrap/Table';
import { useTranslation } from 'react-i18next';
import { getFlag } from '../../utils/featureFlags';

/**
 * Numa Voice — Phase 5 admin phone-number management.
 *
 * A Settings panel (NOT a routed page) for managing the outbound DID numbers
 * available to the SDR team: list claimed numbers with their active/inactive
 * status and monthly usage, claim a new AU/NZ number, and release one.
 *
 * ⚠️ Phase-5 shell only — there is NO backend yet. The CRUD calls below are
 * stubbed (see the TODO block) and resolve to empty lists / no-ops so the UI
 * compiles and renders a graceful empty state. When the Connect-admin API
 * lands, swap the stubs for real `useNumaRequest()` calls (see
 * integration_needs) — the component contract should not need to change.
 */

// ─── Local types ──────────────────────────────────────────────────────────────

/** ISO country code for an outbound number's region. */
type PhoneCountry = 'AU' | 'NZ';

/** Provisioning status of a claimed DID number. */
type PhoneNumberStatus = 'active' | 'inactive';

/**
 * A single claimed outbound DID number.
 *
 * Thin local shape until the Connect-admin backend defines the wire format.
 */
interface PhoneNumber {
  /** Stable identifier (Connect phone-number ARN / id once wired). */
  id: string;
  /** The number itself, in E.164 format (e.g. "+6498765432"). */
  e164: string;
  /** Country the number belongs to. */
  country: PhoneCountry;
  /** Whether the number is currently claimed/active for outbound calling. */
  status: PhoneNumberStatus;
  /** Outbound minutes consumed by this number in the current calendar month. */
  minutes_used_this_month: number;
}

// ─── Backend stubs (Phase 5 — TODO: wire to a Connect-admin API) ────────────────
//
// TODO(FEAT-160 / Phase 5): replace these stubs with authenticated calls to the
// Connect-admin Lambda via useNumaRequest():
//   - listPhoneNumbers   → GET    /api/voice/phone-numbers
//   - claimPhoneNumber   → POST   /api/voice/phone-numbers   { country }
//   - releasePhoneNumber → DELETE /api/voice/phone-numbers/{id}
// Until that endpoint exists, these resolve to empty/no-op so the UI shell is
// fully functional and lint-clean.

/** TODO: replace with GET /api/voice/phone-numbers. */
async function listPhoneNumbers(): Promise<PhoneNumber[]> {
  return [];
}

/** TODO: replace with POST /api/voice/phone-numbers. */
async function claimPhoneNumber(_country: PhoneCountry): Promise<void> {
  /* no-op until the Connect-admin API is wired */
}

/** TODO: replace with DELETE /api/voice/phone-numbers/{id}. */
async function releasePhoneNumber(_id: string): Promise<void> {
  /* no-op until the Connect-admin API is wired */
}

// ─── Component ──────────────────────────────────────────────────────────────

/** The set of countries an admin can claim a new outbound number in. */
const CLAIMABLE_COUNTRIES: PhoneCountry[] = ['AU', 'NZ'];

export const AdminPhoneNumbers: React.FC = () => {
  const { t } = useTranslation('voice');

  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-row / per-action busy state so spinners are scoped, not global.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [claimingCountry, setClaimingCountry] = useState<PhoneCountry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPhoneNumbers();
      setNumbers(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('[AdminPhoneNumbers] Failed to load phone numbers:', err);
      setError(t('page.error'));
      setNumbers([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleClaim = useCallback(
    async (country: PhoneCountry) => {
      setClaimingCountry(country);
      setError(null);
      try {
        await claimPhoneNumber(country);
        await load();
      } catch (err) {
        console.error('[AdminPhoneNumbers] Failed to claim phone number:', err);
        setError(t('page.error'));
      } finally {
        setClaimingCountry(null);
      }
    },
    [load, t]
  );

  const handleRelease = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      try {
        await releasePhoneNumber(id);
        await load();
      } catch (err) {
        console.error('[AdminPhoneNumbers] Failed to release phone number:', err);
        setError(t('page.error'));
      } finally {
        setBusyId(null);
      }
    },
    [load, t]
  );

  // Country code is an ISO-3166 token (AU/NZ), not user-facing prose — render it
  // as a neutral badge. Kept out of i18n on purpose (same treatment as currency
  // codes / SAML claim names elsewhere in the app).
  const renderCountry = useCallback(
    (country: PhoneCountry) => (
      <Badge bg="light" text="dark" className="border">
        {country}
      </Badge>
    ),
    []
  );

  const claimDisabled = claimingCountry !== null || busyId !== null;

  const headerBadge = useMemo(
    () => (numbers.length > 0 ? <Badge bg="secondary">{numbers.length}</Badge> : null),
    [numbers.length]
  );

  // Hard gate: Numa Voice must be enabled for this client to see the panel.
  if (!getFlag('NUMA_VOICE')) {
    return null;
  }

  return (
    <div>
      <Alert variant="secondary" className="mb-3">
        <div className="d-flex align-items-start">
          <i className="bi bi-telephone me-2 mt-1" aria-hidden="true"></i>
          <div>
            <div className="settings-section-title">{t('adminPhones.title')}</div>
            <div className="small text-muted">{t('adminPhones.caption')}</div>
          </div>
        </div>
      </Alert>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card className="mb-3">
        <Card.Body>
          {/* ── Claim toolbar ─────────────────────────────────────────────── */}
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <div className="d-flex align-items-center gap-2">
              <strong>{t('adminPhones.title')}</strong>
              {headerBadge}
            </div>
            <ButtonGroup size="sm">
              {CLAIMABLE_COUNTRIES.map((country) => (
                <Button
                  key={country}
                  variant="outline-primary"
                  onClick={() => void handleClaim(country)}
                  disabled={claimDisabled}
                >
                  {claimingCountry === country ? (
                    <Spinner size="sm" className="me-1" animation="border" />
                  ) : (
                    <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>
                  )}
                  {t('adminPhones.claim')} {country}
                </Button>
              ))}
            </ButtonGroup>
          </div>

          {/* ── Numbers table / states ────────────────────────────────────── */}
          {loading ? (
            <div className="d-flex justify-content-center align-items-center py-4">
              <Spinner animation="border" size="sm" className="me-2" />
              <span>{t('page.loading')}</span>
            </div>
          ) : numbers.length === 0 ? (
            <div className="text-center text-muted py-4">
              <i className="bi bi-telephone-x d-block fs-3 mb-2" aria-hidden="true"></i>
              {t('adminPhones.empty')}
            </div>
          ) : (
            <Table size="sm" hover responsive className="mb-0 align-middle">
              <thead>
                <tr>
                  <th>{t('adminPhones.number')}</th>
                  <th>{t('adminPhones.status')}</th>
                  <th className="text-end">{t('adminPhones.usageMinutes')}</th>
                  <th className="text-end" />
                </tr>
              </thead>
              <tbody>
                {numbers.map((number) => (
                  <tr key={number.id}>
                    <td className="font-monospace">
                      {renderCountry(number.country)} <span className="ms-1">{number.e164}</span>
                    </td>
                    <td>
                      {number.status === 'active' ? (
                        <Badge bg="success">{t('adminPhones.active')}</Badge>
                      ) : (
                        <Badge bg="secondary">{t('adminPhones.inactive')}</Badge>
                      )}
                    </td>
                    <td className="text-end">{number.minutes_used_this_month}</td>
                    <td className="text-end">
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => void handleRelease(number.id)}
                        disabled={busyId !== null || claimingCountry !== null}
                      >
                        {busyId === number.id ? (
                          <Spinner size="sm" animation="border" />
                        ) : (
                          <>
                            <i className="bi bi-trash me-1" aria-hidden="true"></i>
                            {t('adminPhones.release')}
                          </>
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default AdminPhoneNumbers;

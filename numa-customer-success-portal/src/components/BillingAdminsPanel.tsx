import { useCallback, useEffect, useState } from 'react';
import { Card, Form, Button, Badge, Spinner, Alert, InputGroup } from 'react-bootstrap';
import { ShieldLock } from 'react-bootstrap-icons';
import { creditsService, type BillingAdminRow, type ClientUser } from '../services/creditsService';

interface Props {
  clientName: string;
  accountId: string;
  region: string;
}

/**
 * Billing-admins tool (Numa Credit System). Billing-admin = who may SEE credit data in-client. It's
 * NOT a Cognito group (any admin could self-grant that), so membership lives in the client ledger and
 * is written only Arcanum-side (here, via ArcanumAIAccess) or by an existing billing-admin in-client.
 * This panel seeds the FIRST billing-admin per client; afterwards they self-propagate from in-client
 * User Management. Every change is written to the ledger and logged to the portal activity table.
 */
export default function BillingAdminsPanel({ clientName, accountId, region }: Props) {
  const [admins, setAdmins] = useState<BillingAdminRow[]>([]);
  const [users, setUsers] = useState<ClientUser[]>([]);
  const [selectedSub, setSelectedSub] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, u] = await Promise.all([
        creditsService.listBillingAdmins(clientName, accountId, region),
        creditsService.listClientUsers(clientName, accountId, region).catch(() => [] as ClientUser[]),
      ]);
      setAdmins(a);
      setUsers(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load billing admins');
    } finally {
      setLoading(false);
    }
  }, [clientName, accountId, region]);

  useEffect(() => {
    void load();
  }, [load]);

  const adminSubs = new Set(admins.map((a) => a.sub));
  const candidates = users.filter((u) => !adminSubs.has(u.sub));

  const promote = async () => {
    if (!selectedSub) return;
    const u = users.find((x) => x.sub === selectedSub);
    setBusy(true);
    setError(null);
    try {
      await creditsService.promoteBillingAdmin(clientName, accountId, region, selectedSub, u?.email ?? null);
      setSelectedSub('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Promote failed');
    } finally {
      setBusy(false);
    }
  };

  const demote = async (sub: string) => {
    setBusy(true);
    setError(null);
    try {
      await creditsService.demoteBillingAdmin(clientName, accountId, region, sub);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-3">
      <Card.Header className="fw-semibold d-flex align-items-center gap-2">
        <ShieldLock /> Billing admins
        <Badge bg="light" text="dark" className="border ms-auto">
          {admins.length}
        </Badge>
      </Card.Header>
      <Card.Body>
        <p className="text-muted small">
          Only billing admins can see credit &amp; cost information inside {clientName}. Seed the first one here;
          afterwards a billing admin can promote others from the client&apos;s User Management page.
        </p>
        {error && (
          <Alert variant="danger" className="py-2">
            {error}
          </Alert>
        )}
        {loading ? (
          <div className="text-muted d-flex align-items-center gap-2">
            <Spinner size="sm" animation="border" /> Loading…
          </div>
        ) : (
          <>
            {admins.length === 0 ? (
              <div className="text-muted small mb-3">No billing admins yet — promote one below.</div>
            ) : (
              <ul className="list-group list-group-flush mb-3">
                {admins.map((a) => (
                  <li key={a.sub} className="list-group-item d-flex align-items-center justify-content-between px-0">
                    <span>{a.email || `${a.sub.slice(0, 8)}…`}</span>
                    <Button variant="outline-danger" size="sm" disabled={busy} onClick={() => demote(a.sub)}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Form.Label className="small text-muted mb-1">Promote a user to billing admin</Form.Label>
            <InputGroup>
              <Form.Select
                value={selectedSub}
                onChange={(e) => setSelectedSub(e.target.value)}
                disabled={busy || candidates.length === 0}
              >
                <option value="">{candidates.length === 0 ? 'No eligible users' : 'Select a user…'}</option>
                {candidates.map((u) => (
                  <option key={u.sub} value={u.sub}>
                    {u.email}
                  </option>
                ))}
              </Form.Select>
              <Button variant="primary" disabled={busy || !selectedSub} onClick={promote}>
                Promote
              </Button>
            </InputGroup>
          </>
        )}
      </Card.Body>
    </Card>
  );
}

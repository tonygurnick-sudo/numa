import { Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { UserKB } from '../../Services/knowledgeBaseService';

type KBTargetSelectorProps = {
  kbs: UserKB[];
  selectedKbId: string | null;
  onChange: (kbId: string) => void;
  onCreate: () => void;
  disabled?: boolean;
};

export const KBTargetSelector = ({ kbs, selectedKbId, onChange, onCreate, disabled }: KBTargetSelectorProps) => {
  const { t } = useTranslation('integrations');

  return (
    <div className="d-flex flex-wrap align-items-end gap-2">
      <Form.Group className="flex-grow-1" controlId="kbTarget">
        <Form.Label className="small fw-semibold mb-1">{t('kbTargetSelector.label')}</Form.Label>
        <Form.Select value={selectedKbId ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="" disabled>
            {t('kbTargetSelector.placeholder')}
          </option>
          {kbs.map((kb) => (
            <option key={kb.kb_id} value={kb.kb_id}>
              {kb.kb_name}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
      <Button variant="secondary" onClick={onCreate} disabled={disabled}>
        <i className="bi bi-plus-lg me-2" />
        {t('kbTargetSelector.createKB')}
      </Button>
    </div>
  );
};

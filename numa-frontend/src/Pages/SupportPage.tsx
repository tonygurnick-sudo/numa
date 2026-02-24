import { useTranslation } from 'react-i18next';
import { Mail, MessageSquare, FileDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { PageHeader } from '../Components/PageHeader';

const SUPPORT_EMAIL = 'support@arcanum.ai';

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e4e4e7',
  borderRadius: '12px',
  padding: '1.5rem',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontFamily: 'Metropolis Semi Bold',
  fontWeight: 'normal',
  color: '#18181b',
  margin: 0,
};

const cardDescriptionStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  lineHeight: '1.35rem',
  color: '#71717a',
  margin: '0.75rem 0 1.5rem',
  flex: 1,
};

const iconWrapStyle: React.CSSProperties = {
  width: '40px',
  height: '40px',
  borderRadius: '10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const SupportPage = () => {
  const { t } = useTranslation('support');
  const navigate = useNavigate();

  return (
    <div className="dashboard">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <LayoutDashboard>
        <div style={{ padding: '1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
            {/* Email Support Card */}
            <div style={cardStyle}>
              <div className="d-flex align-items-center" style={{ gap: '0.75rem', marginBottom: '0.25rem' }}>
                <div
                  style={{
                    ...iconWrapStyle,
                    backgroundColor: 'color-mix(in srgb, var(--brand-primary, var(--color-primary)) 12%, transparent)',
                  }}
                >
                  <Mail size={20} style={{ color: 'var(--brand-primary, var(--color-primary))' }} />
                </div>
                <h3 style={cardTitleStyle}>{t('email.title')}</h3>
              </div>
              <p style={cardDescriptionStyle}>{t('email.description')}</p>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="btn btn-primary align-self-start">
                <Mail size={16} className="me-2" />
                {t('email.button')}
              </a>
            </div>

            {/* Chat Export Tip Card */}
            <div style={cardStyle}>
              <div className="d-flex align-items-center" style={{ gap: '0.75rem', marginBottom: '0.25rem' }}>
                <div
                  style={{
                    ...iconWrapStyle,
                    backgroundColor: 'color-mix(in srgb, var(--brand-primary, var(--color-primary)) 12%, transparent)',
                  }}
                >
                  <FileDown size={20} style={{ color: 'var(--brand-primary, var(--color-primary))' }} />
                </div>
                <h3 style={cardTitleStyle}>{t('exportTip.title')}</h3>
              </div>
              <p style={cardDescriptionStyle}>{t('exportTip.description')}</p>
              <button
                type="button"
                className="btn btn-secondary align-self-start"
                onClick={() => navigate('/chat')}
              >
                <MessageSquare size={16} className="me-2" />
                {t('exportTip.button')}
              </button>
            </div>
          </div>
        </div>
      </LayoutDashboard>
    </div>
  );
};

export { SupportPage };

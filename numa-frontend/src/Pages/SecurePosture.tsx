import { useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import './SecurePosture.scss';

type PenTestEngagement = { date: string; type: string };

export const SecurePosture = () => {
  const { t } = useTranslation('compliance');

  useEffect(() => {
    const previous = document.title;
    document.title = `${t('secure.title')} — ${t('secure.product')}`;
    return () => {
      document.title = previous;
    };
  }, [t]);

  const year = new Date().getFullYear();
  const engagements = t('secure.sections.operationalSecurity.penTesting.engagements', {
    returnObjects: true,
  }) as PenTestEngagement[];
  const ctaEmail = t('secure.cta.email');
  const contactEmail = t('secure.contact.email');

  return (
    <div className="secure-posture">
      <header className="secure-posture__header">
        <div className="secure-posture__header-inner">
          <a href="https://arcanum.ai" className="secure-posture__brand" rel="noopener noreferrer">
            <img src="/numa-logo.svg" alt={t('secure.product')} />
          </a>
          <span className="secure-posture__doc-label">{t('secure.documentLabel')}</span>
        </div>
      </header>

      <main className="secure-posture__main">
        <div className="secure-posture__title-block">
          <div className="secure-posture__company">{t('secure.product')}</div>
          <h1 className="secure-posture__title">{t('secure.title')}</h1>
          <p className="secure-posture__subtitle">{t('secure.subtitle')}</p>

          <dl className="secure-posture__metadata">
            <div>
              <dt>{t('secure.effectiveDate')}</dt>
              <dd>{t('secure.date')}</dd>
            </div>
            <div>
              <dt>{t('secure.lastUpdated')}</dt>
              <dd>{t('secure.date')}</dd>
            </div>
            <div>
              <dt>{t('secure.documentVersion')}</dt>
              <dd>{t('secure.version')}</dd>
            </div>
          </dl>
        </div>

        <section className="secure-posture__section">
          <p>{t('secure.intro.body')}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secure.sections.cloudFoundation.title')}</h2>
          <p>{t('secure.sections.cloudFoundation.body')}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secure.sections.tenantIsolation.title')}</h2>
          <p>{t('secure.sections.tenantIsolation.body')}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secure.sections.authentication.title')}</h2>
          <p>{t('secure.sections.authentication.body')}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secure.sections.dataProtection.title')}</h2>
          <p>{t('secure.sections.dataProtection.body')}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secure.sections.network.title')}</h2>
          <p>{t('secure.sections.network.body')}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secure.sections.integrationSecurity.title')}</h2>
          <p>{t('secure.sections.integrationSecurity.body')}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secure.sections.operationalSecurity.title')}</h2>
          <p>{t('secure.sections.operationalSecurity.body')}</p>

          <div className="secure-posture__table-wrapper">
            <table className="secure-posture__table">
              <thead>
                <tr>
                  <th scope="col">{t('secure.sections.operationalSecurity.penTesting.tableHeaders.date')}</th>
                  <th scope="col">{t('secure.sections.operationalSecurity.penTesting.tableHeaders.type')}</th>
                </tr>
              </thead>
              <tbody>
                {engagements.map((engagement, idx) => (
                  <tr key={idx}>
                    <td>{engagement.date}</td>
                    <td>{engagement.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p>{t('secure.sections.operationalSecurity.penTesting.footnote')}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secure.sections.dataResidency.title')}</h2>
          <p>{t('secure.sections.dataResidency.body')}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secure.sections.roadmap.title')}</h2>
          <p>{t('secure.sections.roadmap.body')}</p>
        </section>

        <section className="secure-posture__cta">
          <h2 className="secure-posture__cta-title">{t('secure.cta.title')}</h2>
          <p>{t('secure.cta.body')}</p>
          <a className="secure-posture__cta-button" href={`mailto:${ctaEmail}`}>
            {t('secure.cta.buttonLabel')}
          </a>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secure.contact.title')}</h2>
          <p>{t('secure.contact.body')}</p>
          <div className="secure-posture__contact-card">
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          </div>
        </section>
      </main>

      <footer className="secure-posture__footer">
        <div className="secure-posture__footer-inner">
          <p>{t('secure.footer.disclaimer')}</p>
          <p>
            <Trans i18nKey="secure.footer.copyright" ns="compliance" values={{ year }} />
          </p>
        </div>
      </footer>
    </div>
  );
};

export default SecurePosture;

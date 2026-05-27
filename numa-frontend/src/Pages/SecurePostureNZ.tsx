import { useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import './SecurePosture.scss';

type Framework = { name: string; description: string };
type Point = { name: string; description: string };

export const SecurePostureNZ = () => {
  const { t } = useTranslation('compliance');

  useEffect(() => {
    const previous = document.title;
    document.title = `${t('secureNz.title')} — ${t('secureNz.product')}`;
    return () => {
      document.title = previous;
    };
  }, [t]);

  const year = new Date().getFullYear();
  const inferencePoints = t('secureNz.sections.inference.points', {
    returnObjects: true,
  }) as Point[];
  const frameworks = t('secureNz.sections.regulatory.frameworks', {
    returnObjects: true,
  }) as Framework[];
  const ctaEmail = t('secure.cta.email');
  const contactEmail = t('secure.contact.email');

  return (
    <div className="secure-posture">
      <header className="secure-posture__header">
        <div className="secure-posture__header-inner">
          <a href="https://arcanum.ai" className="secure-posture__brand" rel="noopener noreferrer">
            <img src="/numa-logo.svg" alt={t('secureNz.product')} />
          </a>
          <span className="secure-posture__doc-label">{t('secureNz.documentLabel')}</span>
        </div>
      </header>

      <main className="secure-posture__main">
        <a href="/secure" className="secure-posture__back-link">
          {t('secureNz.backLabel')}
        </a>

        <div className="secure-posture__title-block">
          <div className="secure-posture__company">{t('secureNz.product')}</div>
          <h1 className="secure-posture__title">{t('secureNz.title')}</h1>
          <p className="secure-posture__subtitle">{t('secureNz.subtitle')}</p>

          <dl className="secure-posture__metadata">
            <div>
              <dt>{t('secure.effectiveDate')}</dt>
              <dd>{t('secureNz.date')}</dd>
            </div>
            <div>
              <dt>{t('secure.lastUpdated')}</dt>
              <dd>{t('secureNz.date')}</dd>
            </div>
            <div>
              <dt>{t('secure.documentVersion')}</dt>
              <dd>{t('secureNz.version')}</dd>
            </div>
          </dl>
        </div>

        <section className="secure-posture__section">
          <p>{t('secureNz.intro.body')}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secureNz.sections.residency.title')}</h2>
          <p>{t('secureNz.sections.residency.body')}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secureNz.sections.inference.title')}</h2>
          <p>{t('secureNz.sections.inference.body')}</p>
          <ul className="secure-posture__list">
            {inferencePoints.map((point, idx) => (
              <li key={idx}>
                <strong>{point.name}</strong> — {point.description}
              </li>
            ))}
          </ul>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secureNz.sections.integrations.title')}</h2>
          <p>{t('secureNz.sections.integrations.body')}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secureNz.sections.regulatory.title')}</h2>
          <p>{t('secureNz.sections.regulatory.body')}</p>
          <ul className="secure-posture__list">
            {frameworks.map((framework, idx) => (
              <li key={idx}>
                <strong>{framework.name}</strong> — {framework.description}
              </li>
            ))}
          </ul>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t('secureNz.sections.assurance.title')}</h2>
          <p>{t('secureNz.sections.assurance.body')}</p>
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

export default SecurePostureNZ;

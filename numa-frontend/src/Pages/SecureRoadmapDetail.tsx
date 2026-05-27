import { useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import './SecurePosture.scss';

type RoadmapVariant = 'soc2' | 'iso27001';

export const SecureRoadmapDetail = ({ variant }: { variant: RoadmapVariant }) => {
  const { t } = useTranslation('compliance');
  const base = `secureRoadmap.${variant}`;

  useEffect(() => {
    const previous = document.title;
    document.title = `${t(`${base}.title`)} — ${t(`${base}.product`)}`;
    return () => {
      document.title = previous;
    };
  }, [t, base]);

  const year = new Date().getFullYear();
  const controlItems = t(`${base}.sections.controls.items`, {
    returnObjects: true,
  }) as string[];
  const ctaEmail = t('secure.cta.email');
  const contactEmail = t('secure.contact.email');

  return (
    <div className="secure-posture">
      <header className="secure-posture__header">
        <div className="secure-posture__header-inner">
          <a href="https://arcanum.ai" className="secure-posture__brand" rel="noopener noreferrer">
            <img src="/numa-logo.svg" alt={t(`${base}.product`)} />
          </a>
          <span className="secure-posture__doc-label">{t(`${base}.documentLabel`)}</span>
        </div>
      </header>

      <main className="secure-posture__main">
        <a href="/secure" className="secure-posture__back-link">
          {t(`${base}.backLabel`)}
        </a>

        <div className="secure-posture__title-block">
          <div className="secure-posture__company">{t(`${base}.product`)}</div>
          <h1 className="secure-posture__title">{t(`${base}.title`)}</h1>
          <p className="secure-posture__subtitle">{t(`${base}.subtitle`)}</p>

          <dl className="secure-posture__metadata">
            <div>
              <dt>{t('secure.lastUpdated')}</dt>
              <dd>{t(`${base}.date`)}</dd>
            </div>
            <div>
              <dt>{t('secure.documentVersion')}</dt>
              <dd>{t(`${base}.version`)}</dd>
            </div>
          </dl>
        </div>

        <section className="secure-posture__section">
          <p>{t(`${base}.intro.body`)}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t(`${base}.sections.about.title`)}</h2>
          <p>{t(`${base}.sections.about.body`)}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t(`${base}.sections.position.title`)}</h2>
          <p>{t(`${base}.sections.position.body`)}</p>
        </section>

        <section className="secure-posture__section">
          <h2 className="secure-posture__section-title">{t(`${base}.sections.controls.title`)}</h2>
          <p>{t(`${base}.sections.controls.body`)}</p>
          <ul className="secure-posture__list">
            {controlItems.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="secure-posture__cta">
          <h2 className="secure-posture__cta-title">{t(`${base}.sections.evidence.title`)}</h2>
          <p>{t(`${base}.sections.evidence.body`)}</p>
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

export const SecureRoadmapSoc2 = () => <SecureRoadmapDetail variant="soc2" />;
export const SecureRoadmapIso27001 = () => <SecureRoadmapDetail variant="iso27001" />;

export default SecureRoadmapDetail;

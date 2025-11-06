import type { ReactNode } from 'react';
import { Container, Row, Col } from 'react-bootstrap';
import { useBranding } from '../Providers/BrandingContext';
import { useBrandingAsset } from '../hooks/useBrandingAsset';
import LogoBk from '../assets/images/arc_logo_black.svg';
import LoginIllustration from '../assets/images/logo-accelerate.svg';

type LayoutFormProps = {
  FormName: string;
  Content: ReactNode;
};

const LayoutForm = ({ FormName, Content }: LayoutFormProps) => {
  const { branding } = useBranding();

  const rawLogo = branding.resolvedAssets?.logoNav || branding.assets?.logoNav || branding.logo || LogoBk;
  const logoSrc = useBrandingAsset(rawLogo, LogoBk);
  const logoAlt = branding.name || 'Numa';
  const showNameWithLogo = branding.showNameWithLogo ?? true;

  const splash = branding.splashScreen;
  const rawSplashImage = branding.resolvedAssets?.logoLoginRight || branding.assets?.logoLoginRight || splash?.image;
  const splashImageResolved = useBrandingAsset(rawSplashImage, LoginIllustration);
  const splashImage = rawSplashImage ? splashImageResolved : null;
  const shouldShowSplashText = splash?.showText ?? true;
  const splashTitle = splash?.title || 'Supercharge your workforce with AI and scale your business';
  const splashDescription =
    splash?.description ||
    'Numa is a generative AI-powered platform that will empower your employees to be more creative, data-driven, efficient and productive.';

  return (
    <Container fluid>
      <Row className="h-100vh">
        <Col lg={6} className={`${FormName}-left`}>
          <Row className={`container d-flex h-100 justify-content-center align-items-center ${FormName}`}>
            <Col lg={6} className="row justify-content-center align-self-center" style={{ marginBottom: '2rem' }}>
              <div className="d-flex justify-content-left">
                <img
                  src={logoSrc}
                  height={55}
                  className="logo-bk float-start"
                  alt={logoAlt}
                  style={{ maxWidth: '200px', objectFit: 'contain' }}
                />
                {showNameWithLogo && (
                  <span className="ms-2 align-self-center fw-semibold" style={{ color: 'var(--brand-text)' }}>
                    {branding.name}
                  </span>
                )}
              </div>
              {Content}
            </Col>
            <footer className="public-footer">
              &copy; {branding.name || 'ARCANUM'} {new Date().getFullYear()}
            </footer>
          </Row>
        </Col>

        <Col
          lg={6}
          className={`${FormName}-right`}
          style={{
            backgroundImage: splashImage ? `url(${splashImage})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        >
          <Row className="container d-flex h-100 justify-content-center align-items-center benefits_trial">
            <Col lg={12} className="text-center text-lg-start">
              {shouldShowSplashText && (
                <>
                  <h1>{splashTitle}</h1>
                  <p>{splashDescription}</p>
                </>
              )}
            </Col>
          </Row>
        </Col>
      </Row>
    </Container>
  );
};

export { LayoutForm };

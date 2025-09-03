import LogoBk from '../assets/images/arc_logo_black.svg';

import { Container, Row, Col } from 'react-bootstrap';

const LayoutForm = ({ FormName, Content }) => {
  return (
    <>
      <Container fluid>
        <Row className="h-100vh">
          <Col lg={6} className={`${FormName}-left `}>
            <Row className={`container d-flex h-100  justify-content-center align-items-center ${FormName}`}>
              <Col lg={6} className="row justify-content-center align-self-center" style={{ marginBottom: '2rem' }}>
                <div className="d-flex justify-content-left">
                  <img
                    src={LogoBk}
                    height="55"
                    className="logo-bk float-start"
                    alt="Arcanum"
                    style={{ maxWidth: '200px' }}
                  />
                </div>
                {Content}
              </Col>
              <footer className="public-footer">&copy; ARCANUM {new Date().getFullYear()}</footer>
            </Row>
          </Col>

          <Col lg={6} className={`${FormName}-right`}>
            <Row className="container d-flex h-100  justify-content-center align-items-center benefits_trial">
              <Col lg={12}>
                <h1>Supercharge your workforce with AI and scale your business</h1>
                <p>
                  Numa is a generative AI-powered platform that will empower your employees to be more creative,
                  data-driven, efficient and productive.
                </p>
              </Col>
            </Row>
          </Col>
        </Row>
      </Container>
    </>
  );
};

export { LayoutForm };

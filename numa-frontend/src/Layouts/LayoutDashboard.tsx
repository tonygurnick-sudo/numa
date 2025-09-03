import { Container, Row, Col } from 'react-bootstrap';

const LayoutDashboard = ({ children }) => {
  return (
    <div className="app-content">
      <Container fluid>
        <Row>
          <Col xs={12}>
            <div className="wrapper">{children}</div>
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export { LayoutDashboard };

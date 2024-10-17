import { Container, Row, Col } from 'react-bootstrap';

const LayoutDashboard = ({ children }) => {
  return (
    <>
      <Container fluid>
        <Row>
          <Col lg={12} className="p-5">
            <div className="wrapper">{children}</div>
          </Col>
        </Row>
      </Container>
    </>
  );
};

export { LayoutDashboard };

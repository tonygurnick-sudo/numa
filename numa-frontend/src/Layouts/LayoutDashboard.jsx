import { Container, Row, Col } from 'react-bootstrap';

const LayoutDashboard = ({ children }) => {
  return (
    <>
      <Container fluid>
        <Row>
          <Col xs={12} className="">
            <div className="wrapper">{children}</div>
          </Col>
        </Row>
      </Container>
    </>
  );
};

export { LayoutDashboard };

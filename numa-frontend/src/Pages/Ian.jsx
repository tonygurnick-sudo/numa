import { Row, Container, Col } from 'react-bootstrap';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { useContext } from 'react';
import { NicetyContext } from '../Providers/NicetyContext';

export const Ian = () => {
  const niceties = useContext(NicetyContext);

  return (
    <div className="dashboard">
      <Nav />
      <header className="mb-1">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Breadcrumbs items={[{ label: 'IAN', active: true }]} />
              <h1 className="mb-0 fs-3">Initialisation of Additional Niceties</h1>
            </Col>
          </Row>
        </Container>
      </header>
      <LayoutDashboard className="flex-grow-1">
        <Container fluid className="p-4">
          <h2>
            <Col lg={12}>
              <p>Available Niceties:</p>
            </Col>
          </h2>
          {niceties.niceties.length > 0 ? (
            niceties.niceties.map((nicety) => {
              const status = niceties.isEnabled(nicety.id);
              return (
                <Row key={nicety.id}>
                  <Col lg={12}>
                    <label>
                      <input
                        name={nicety.id}
                        type="checkbox"
                        key={nicety.id}
                        onChange={(e) => niceties.toggle(e.target.name, e.target.checked)}
                        defaultChecked={status}
                        className="me-1"
                      />
                      {nicety.label}
                    </label>
                  </Col>
                </Row>
              );
            })
          ) : (
            <Row>
              <Col lg={12}>
                <p>No niceties available.</p>
              </Col>
            </Row>
          )}
        </Container>
      </LayoutDashboard>
    </div>
  );
};

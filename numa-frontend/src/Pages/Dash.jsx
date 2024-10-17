import { Container, Row, Col } from 'react-bootstrap';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import {AppCard} from '../Components/AppCardItem'
import appData from '../Data/appData.json';
import { Nav } from '../Components/Nav';

const Dash = () => {

    return (
        <>
          <div className="dashboard">
            <header>
              <Container fluid>
                <Row>
                  <Col lg={8} className="px-5">
                    <h1>Numa Dashboard</h1>
                  </Col>
                  <Col lg={4} className="px-5"></Col>
                </Row>
              </Container>
            </header>

            <LayoutDashboard>
              <Row>
              {appData.map(app => (
              <Col key={app.id} lg={6} className="flex">
                <AppCard
                  title={app.name}
                  description={app.description}
                  link={app.link}
                />
              </Col>
            ))}
              </Row>
            </LayoutDashboard>

            <Nav nav1on="on" nav2on="" nav3on=""  />
          </div>
        </>
      );
    };
export { Dash };

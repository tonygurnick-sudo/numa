import { Container, Row, Col } from 'react-bootstrap';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import {AppItem} from '../Components/AppItem'
import appsData from '../Data/appsData.json';
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
              {appsData.map(app => (
              <Col key={app.appId} lg={4} className="flex">
                <AppItem
                  appData={app}
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

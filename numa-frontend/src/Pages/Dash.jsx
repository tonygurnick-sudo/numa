import { useState, useEffect } from 'react';
import { Container, Row, Col } from 'react-bootstrap';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';

import { AppItem } from '../Components/AppItem';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { Preloader } from '../Components/Preloader';

import { useAuth } from '../Providers/AuthProvider';
import {
  ListQAppsCommand,
  ListLibraryItemsCommand,
} from '@aws-sdk/client-qapps';

import exampleItem from '../Data/ExampleitemToCreate.json';
//import appsData from '../Data/appsData.json';

const Dash = () => {
  const { qAppsClient, loading: authLoading } = useAuth();

  const [apps, setApps] = useState([]);
  const [libraryApps, setLibraryApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';

  const fetchApps = async () => {
    if (!qAppsClient || authLoading) return;

    // try {
    //   // temp
    //   // create this app

    //   console.log('exampleItem', exampleItem);

    //   const create_command = new CreateQAppCommand(exampleItem);
    //   const create_response = await qAppsClient.send(create_command);
    //   console.log('response create app: ', create_response);
    // } catch (error) {
    //   console.error('Error creating a  Q App:', error);
    // }

    try {
      setLoading(true);
      const input = {
        instanceId: APPLICATION_ID,
      };

      const command = new ListQAppsCommand(input);
      const response = await qAppsClient.send(command);

      setApps(response.apps);
    } catch (error) {
      console.error('Error fetching Q Apps:', error);
    } finally {
      setLoading(false);
    }

    // try {
    //   setLoading(true);
    //   const input = {
    //     instanceId: APPLICATION_ID,
    //   };

    //   const lib_command = new ListLibraryItemsCommand(input);
    //   const lib_response = await qAppsClient.send(lib_command);

    //   setLibraryApps(lib_response.libraryItems);
    // } catch (error) {
    //   console.error('Error fetching Q Apps:', error);
    // } finally {
    //   setLoading(false);
    // }
  };

  useEffect(() => {
    fetchApps();
  }, []);

  return (
    <>
      <div className="dashboard">
        <header>
          <Container fluid>
            <Row>
              <Col lg={8} className="px-5">
                <Breadcrumbs label={'Home'} />
                <h1>Numa Apps</h1>
              </Col>
              <Col lg={4} className="px-5"></Col>
            </Row>
          </Container>
        </header>

        <LayoutDashboard>
          <Row>
            {/* DUMMY DATA */}
            {/*  <h6>Dummy data:</h6>
           {appsData.map((app) => (
              <Col key={app.appId} lg={4} className="flex">
                <AppItem appData={app} />
              </Col>
            ))}
            <hr /> */}

            {loading ? (
              <Preloader />
            ) : (
              <>
                {apps.map((app) => (
                  <Col key={app.appId} lg={4} className="flex">
                    <AppItem appData={app} />
                  </Col>
                ))}
              </>
            )}

            <h6>Library data:</h6>
            {loading ? (
              <Preloader />
            ) : (
              <ul>
                {libraryApps.map((app) => (
                  <Col key={app.appId} lg={4} className="flex">
                    <AppItem appData={app} />
                  </Col>
                ))}
              </ul>
            )}
          </Row>
        </LayoutDashboard>

        <Nav nav1on="on" nav2on="" nav3on="" />
      </div>
    </>
  );
};
export { Dash };

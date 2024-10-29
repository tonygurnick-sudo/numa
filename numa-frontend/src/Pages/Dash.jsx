import { useState, useEffect } from 'react';
import { Container, Row, Col } from 'react-bootstrap';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';

import { AppItem } from '../Components/AppItem';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';

import { useAuth } from '../Providers/AuthProvider';
import {
  ListQAppsCommand,
  ListLibraryItemsCommand,
  CreateQAppCommand,
} from '@aws-sdk/client-qapps';

import exampleItem from '../Data/ExampleitemToCreate.json';
//import appsData from '../Data/appsData.json';

const Dash = () => {
  const { qAppsClient, loading } = useAuth();
  const [apps, setApps] = useState([]);
  const [libraryApps, setLibraryApps] = useState([]);

  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';

  const fetchApps = async () => {
    if (!qAppsClient || loading) return;

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
      const input = {
        instanceId: APPLICATION_ID,
      };

      const command = new ListQAppsCommand(input);
      const response = await qAppsClient.send(command);

      console.log(response);

      setApps(response.apps);
    } catch (error) {
      console.error('Error fetching Q Apps:', error);
    }

    try {
      console.log('get library items:');
      const input = {
        instanceId: APPLICATION_ID,
      };

      const lib_command = new ListLibraryItemsCommand(input);
      const lib_response = await qAppsClient.send(lib_command);

      console.log('lib_response', lib_response);

      setLibraryApps(lib_response.libraryItems);
    } catch (error) {
      console.error('Error fetching Q Apps:', error);
    }
  };

  console.log('qAppsClient...', qAppsClient);

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
              <p>Loading Apps...</p>
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
              <p>Loading Apps...</p>
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
        <div></div>

        <Nav nav1on="on" nav2on="" nav3on="" />
      </div>
    </>
  );
};
export { Dash };

import { useState, useEffect } from 'react';
import { Container, Row, Col } from 'react-bootstrap';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';

import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';

import { useAuth } from '../Providers/AuthProvider';
import { CreateLibraryItemCommand } from '@aws-sdk/client-qapps';

//import appsData from '../Data/appsData.json';

const CreateLibItemFromAppID = () => {
  const { qAppsClient, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';

  const fetchApps = async () => {
    if (!qAppsClient || authLoading) return;

    //code to deploy a app to library:
    try {
      const addAppToLibCommand = {
        appId: '43e7b0e0-3418-487d-88c8-5299136efd3a',
        appVersion: 1,
        categories: ['9c871ed4-1c41-4065-aefe-321cd4b61cf8'],
        instanceId: APPLICATION_ID,
      };
      const command = new CreateLibraryItemCommand(addAppToLibCommand);
      const add_lib_response = await qAppsClient.send(command);
      console.log(add_lib_response);
    } catch (error) {
      console.error('Error adding Q App to lib:', error);
    } finally {
      setLoading(false);
    }
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
                <h1>Numa Create Lib Item from App ID</h1>
              </Col>
              <Col lg={4} className="px-5"></Col>
            </Row>
          </Container>
        </header>

        <LayoutDashboard>
          <Row></Row>
        </LayoutDashboard>

        <Nav nav1on="on" nav2on="" nav3on="" />
      </div>
    </>
  );
};

export { CreateLibItemFromAppID };

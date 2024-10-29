import { useState, useEffect } from 'react';
import { Container, Row, Col } from 'react-bootstrap';

import { useParams } from 'react-router-dom';

import { Nav } from '../Components/Nav';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { AppCard } from '../Components/AppCard';

import { LayoutDashboard } from '../Layouts/LayoutDashboard';

import { useAuth } from '../Providers/AuthProvider';
import { GetQAppCommand } from '@aws-sdk/client-qapps';

import { NumaChat } from '../Pages/NumaChat';
//import appsData from '../Data/appsData.json';

const AppDetail = () => {
  const { qAppsClient, loading } = useAuth();
  const [app, setApp] = useState([]);
  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';
  const [isLoading, setIsLoading] = useState(true);

  const { appId } = useParams(); // Get appId from URL
  console.log("appId: ",appId);

  //const app = appsData.find(a => a.appId === appId); // Find the app by appId

  const fetchApp = async () => {
    if (!qAppsClient || loading) return;

    try {
      console.log('appId to look up', appId);

      const input = {
        instanceId: APPLICATION_ID,
        appId: appId,
      };

      const command = new GetQAppCommand(input);
      const response = await qAppsClient.send(command);

      console.log("get app resp: ",response);
      setApp(response);
    } catch (error) {
      console.error('Error fetching Q Apps:', error);
    } finally {
      setIsLoading(false);
    }

  };

  useEffect(() => {
    fetchApp();
  }, []);

  return (
    <>
      <div className="dashboard">
        <header>
          <Container fluid>
            <Row>
              <Col lg={8} className="px-5">
              {!isLoading && (
                <Breadcrumbs label={app?.title} />
              )}
                <h1>{app?.title}</h1>
                <p>{app?.description}</p>
              </Col>
              <Col lg={4} className="px-5"></Col>
            </Row>
          </Container>
        </header>

        {isLoading ? (
          <p>Loading app details...</p>
        ) : app ? (
          <LayoutDashboard>
            <Row>
              {app.name === 'Numa Chat' ? (
                <NumaChat />
              ) : (
                app?.appDefinition?.cards?.map((card) => (
                  <Col
                    key={card[Object.keys(card)[0]].id}
                    sm={12}
                    md={6}
                    lg={6}
                    xl={6}
                    className="flex"
                  >
                    <AppCard
                      card={card}
                      dependencies={
                        card[Object.keys(card)[0]].dependencies || []
                      }
                      appsCards={app.appDefinition.cards}
                    />
                  </Col>
                ))
              )}
            </Row>
          </LayoutDashboard>

        ) : (
          <p>Error fetching app details</p>
        )}

        <Nav nav1on="on" nav2on="" nav3on="" />
      </div>
    </>
  );
};

export default AppDetail;

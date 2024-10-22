import { Container, Row, Col } from 'react-bootstrap';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { AppCard } from '../Components/AppCard';
import appsData from '../Data/appsData.json';
import { useParams } from 'react-router-dom'; // Assuming you're using React Router for dynamic routes
import { Nav } from '../Components/Nav';

import { NumaChat } from '../Pages/NumaChat';

const AppDetail = () => {
  const { appId } = useParams(); // Get appId from URL
  const app = appsData.find(a => a.appId === appId); // Find the app by appId

  if (!app) {
    return <p>App not found</p>; // Handle case where app is not found
  }

  return (
    <>
      <div className="dashboard">
        <header>
          <Container fluid>
            <Row>
              <Col lg={8} className="px-5">
                <h1>{app.name}</h1>
                <p>{app.description}</p>
              </Col>
              <Col lg={4} className="px-5"></Col>
            </Row>
          </Container>
        </header>

        <LayoutDashboard>
          <Row>
            {app.name === "Numa Chat" ? (
                 <NumaChat />

            ): app.appDefinition.cards.map(card =>(
               <Col key={card[Object.keys(card)[0]].id} sm={12} md={6} lg={6} xl={6} className="flex">
              <AppCard
                card={card}
                dependencies={card[Object.keys(card)[0]].dependencies || []}
                appsCards={app.appDefinition.cards}
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

export default AppDetail;

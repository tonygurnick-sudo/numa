import { Row, Col } from 'react-bootstrap';

const AppCard = ({ icon, title, description, id, link, status }) => {
  return (
    <>
      <div className="card card-apps">

        <a href={link} rel="noopener" >
            <CardContents />
          </a>

      </div>
    </>
  );

  function CardContents() {
    return (
      <>
        <div className="card-header">
          <Row>
            <Col lg={9}>
              <img src={icon} alt="" />
              {title}
            </Col>
            <Col lg={3} className="right">
             icon
            </Col>
          </Row>
        </div>
        <div className="card-body">{description}</div>
        <div className="card-buttons">
          <Row>
            <Col lg={8}>

                   </Col>
            <Col lg={4}>
              {status === 'coming_soon' ? <div className="badge-status comingsoon right">Coming Soon</div> : ''}
            </Col>
          </Row>
        </div>
        <div className="card-footer" />
      </>
    );
  }
};

export { AppCard };

import { Row, Col } from 'react-bootstrap';
import {replaceReferences} from '../common'

const AppCard = ({ card, dependencies, appsCards  }) => {

     // Assuming prompt and defaultValue are nested in the card's first key object
    const this_card = card[Object.keys(card)[0]];

    // Run replaceReferences function to swap @ references with titles
    const description = replaceReferences(
        this_card.prompt || this_card.defaultValue, // Use the card's prompt or default value
        dependencies,
        appsCards
      );


        // Logic to handle different card types
  const renderCardByType = () => {
    switch (this_card.type) {
      case 'text-input':
        return (
          <div className="card-body">
            <textarea rows="10" defaultValue={this_card.defaultValue} className="form-control" />
          </div>
        );
      case 'q-query':
        return (
          <div className="card-body">
            <p dangerouslySetInnerHTML={{ __html: description }} />

          </div>
        );

      default:
        return <div className="card-body">Unsupported card type</div>;
    }
  };


  return (
    <>
    <div className="card card-apps">

      <div className="card-header">
        <Row>
          <Col lg={12}>

            {this_card.title}
          </Col>
          <Col lg={3} className="right">
          </Col>
        </Row>
      </div>
      {renderCardByType()}


      {/* <div className="card-buttons">
        <Row>
          <Col lg={8}>

                 </Col>
          <Col lg={4}>
            {status === 'coming_soon' ? <div className="badge-status comingsoon right">Coming Soon</div> : ''}
          </Col>
        </Row>
      </div> */}
      <div className="card-footer" />

    </div>
  </>


  );
}

export { AppCard };

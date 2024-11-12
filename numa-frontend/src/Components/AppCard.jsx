import { useEffect, useState } from 'react';
import { Row, Col } from 'react-bootstrap';

const replaceReferences = (prompt, dependencies, appsCards) => {
  let updatedPrompt = prompt || ''; // Ensure prompt is a valid string

  dependencies.forEach((dep) => {
    // Find the card in appsCards with a matching ID to dep
    let title = '';
    appsCards.forEach((card) => {
      // Iterate over the keys of the card to find the one containing the actual card data
      const cardData = card[Object.keys(card)[0]];
      if (cardData.id === dep) {
        title = '<strong>(' + cardData.title + ')</strong>' || '';
      }
    });

    if (title) {
      const regex = new RegExp(`@${dep}`, 'g');
      updatedPrompt = updatedPrompt.replace(regex, title);
    }
  });

  return updatedPrompt;
};

const AppCard = ({
  card,
  dependencies,
  appsCards,
  onInputChange,
  inputValue,
}) => {
  // Assuming prompt and defaultValue are nested in the card's first key object
  const this_card = card[Object.keys(card)[0]];

  // Run replaceReferences function to swap @ references with titles
  // (may not be needed at this time)
  const description = replaceReferences(
    this_card.prompt || this_card.defaultValue, // Use the card's prompt or default value
    dependencies,
    appsCards,
  );

  const handleChange = (e) => {
    onInputChange(this_card.id, e.target.value); // Pass updated value up to parent
  };

  // Logic to handle different card types
  const renderCardByType = () => {
    switch (this_card.type) {
      case 'text-input':
        return (
          <div className="card-body">
            <textarea
              rows="10"
              value={inputValue}
              placeholder={this_card.placeholder}
              onChange={handleChange}
              className="form-control"
            />
          </div>
        );
      case 'q-query':
        return (
          <div className="card-body">
            <textarea
              rows="10"
              value={
                inputValue ||
                'Generating text as soon as required inputs are filled'
              }
              placeholder={this_card.placeholder}
              onChange={handleChange}
              className="form-control"
              disabled
            />

            <p>.</p>
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
              <br />
              <label className="type">
                {this_card.type === 'q-query' ? 'Output- Text' : this_card.type}
              </label>
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
};

export { AppCard };

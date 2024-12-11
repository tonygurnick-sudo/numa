import { useState, useEffect } from 'react';
import { Alert, Row, Col } from 'react-bootstrap';
import { Preloader } from './Preloader';

import { GetQAppCommand } from '@aws-sdk/client-qapps';

const AppItem = ({ app }) => {
  // Get first 3 tags for display
  const displayTags = app?.tags?.slice(0, 3) || [];

  const getCategoryColor = (category) => {
    const categoryColors = {
      productivity: 'green',
      finance: 'purple',
      sales: 'blue',
      // Add more categories as needed
    };
    return categoryColors[category] || 'blue';
  };

  return (
    <Col key={app.id} lg={4} md={6} sm={12} className="flex mb-4">
      <div className="card card-apps" data-testid={`app-card-${app.id}`}>
        <div className={`card-category ${app?.category?.toLowerCase()}`}>
          {app?.category || '\u00A0'}
        </div>
        <div className="card-header">
          <div className="header-top">
            <div className="app-name">
              <i className="bi bi-window app-item-icon"></i>
              <a href={`/app/${app.id}`} rel="noopener">
                {app?.appName}
              </a>
            </div>
            <div className="header-right">
            </div>

          </div>
          <div className="app-tags">
            {displayTags.map((tag, index) => (
              <span
                key={index}
                className={`tag-pill tag-${['green', 'purple', 'blue'][index % 3]}`}
              >
                {tag}
              </span>
            ))}
          </div>

        </div>

        <div className="card-body">
        <hr />
          <div className="app-info">
            <div className="app-description">{app.appDescription === 'Loading...' ? (
              <Preloader smallscreen={true} />
            ) : (
              <div className="description-text">{app.appDescription}</div>
            )}</div>
          </div>
        </div>
        <div className="card-footer">
          <div className="footer-content">
            <div className="footer-left">
              <div className="d-flex align-items-center gap-4 mb-3">
                <div className="likes">
                  <i className="bi bi-download"></i>
                  <span>238</span>
                </div>
                <div className="likes">
                  <i className="bi bi-heart"></i>
                  <span>45</span>
                </div>
              </div>
              <div className="d-flex align-items-center gap-3">
                <div className="app-status">
                  <span className={`status ${app.status.toLowerCase()}`}>
                    {app.status}
                  </span>
                </div>
                <div className="badge-status">
                  <span className="badge rounded-pill">
                    {app.appVersion && (
                      <label data-testid="app-version">
                        v{app.appVersion}
                      </label>
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div className="footer-right">
              <a href={`/app/${app.id}`} rel="noopener">
                <div className="icon-flip-container">
                  <div className="icon-flipper">
                    <div className="front">
                      <i className="bi bi-arrow-right-circle"></i>
                    </div>
                    <div className="back">
                      <i className="bi bi-arrow-right-circle"></i>
                    </div>
                  </div>
                </div>
              </a>
            </div>
          </div>
        </div>
      </div>
    </Col>
  );
};

export { AppItem };

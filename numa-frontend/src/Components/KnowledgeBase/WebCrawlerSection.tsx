/**
 * Web Crawler Section Component
 * Reusable card wrapper for web crawler functionality
 */

import React from 'react';
import { Card, Form } from 'react-bootstrap';
import { WebCrawler } from '../WebCrawler';

interface WebCrawlerSectionProps {
  kb_id: string;
  kbName?: string;
  onCrawlerStarted: () => void;
}

export function WebCrawlerSection({ kb_id, kbName, onCrawlerStarted }: WebCrawlerSectionProps): React.JSX.Element {
  const displayName = kbName || (kb_id === 'company' ? 'Company Knowledge Base' : kb_id);

  return (
    <Card>
      <Card.Header>
        <Card.Title className="mb-0">Web Crawler</Card.Title>
      </Card.Header>
      <Card.Body>
        <Form.Group className="mb-3">
          <Form.Label>
            <strong>Destination Knowledge Base</strong>
          </Form.Label>
          <Form.Control type="text" value={displayName} disabled />
          <Form.Text className="text-muted">Crawled content will be added to this knowledge base.</Form.Text>
        </Form.Group>

        <WebCrawler onCrawlerStarted={onCrawlerStarted} kb_id={kb_id} />
      </Card.Body>
    </Card>
  );
}

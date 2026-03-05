import { useState } from 'react';
import { Row, Col, Card, Form, InputGroup } from 'react-bootstrap';
import { Tools as ToolsIcon, Search } from 'react-bootstrap-icons';
import { ToolCard } from '@/components/tools/ToolCard';
import { AVAILABLE_TOOLS, getToolsByCategory } from '@/data/tools';

export default function Tools() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const categories = getToolsByCategory();
  const allTools = AVAILABLE_TOOLS;

  // Filter tools based on search and category
  const filteredTools = allTools.filter((tool) => {
    const matchesSearch =
      searchTerm === '' ||
      tool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = selectedCategory === 'all' || tool.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const getFilteredCategories = () => {
    return categories
      .map((category) => ({
        ...category,
        tools: category.tools.filter((tool) => filteredTools.includes(tool)),
      }))
      .filter((category) => category.tools.length > 0);
  };

  const displayCategories = getFilteredCategories();

  return (
    <div>
      {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h1 className="h3 mb-1 d-flex align-items-center">
            <ToolsIcon className="me-2" />
            All Tools
          </h1>
          <p className="text-muted mb-0">Complete toolkit for customer success operations</p>
        </div>
        <div className="text-muted small">
          {filteredTools.length} tool{filteredTools.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Search and Filter Controls */}
      <Card className="border-0 shadow-sm mb-4">
        <Card.Body className="p-3">
          <Row className="align-items-center">
            <Col md={6}>
              <InputGroup>
                <InputGroup.Text>
                  <Search size={16} />
                </InputGroup.Text>
                <Form.Control
                  type="text"
                  placeholder="Search tools..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </InputGroup>
            </Col>
            <Col md={3}>
              <Form.Select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
                <option value="all">All Categories</option>
                <option value="analytics">Analytics & Reports</option>
                <option value="management">Client Operations</option>
              </Form.Select>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* No Results */}
      {filteredTools.length === 0 && (
        <Card className="border-0 shadow-sm">
          <Card.Body className="text-center py-5">
            <ToolsIcon size={48} className="text-muted mb-3" />
            <h5 className="text-muted mb-2">No tools found</h5>
            <p className="text-muted small">Try adjusting your search terms or filter settings</p>
          </Card.Body>
        </Card>
      )}

      {/* Tools by Category */}
      {displayCategories.map((category) => (
        <div key={category.id} className="mb-5">
          <div className="mb-4">
            <h4 className="mb-1 fw-semibold text-primary">{category.name}</h4>
            <p className="text-muted mb-0">{category.description}</p>
          </div>

          <Row className="g-4">
            {category.tools.map((tool) => (
              <Col lg={4} md={6} key={tool.id}>
                <ToolCard tool={tool} />
              </Col>
            ))}
          </Row>
        </div>
      ))}

      {/* Show all tools if no category match but search results exist */}
      {displayCategories.length === 0 && filteredTools.length > 0 && (
        <div className="mb-5">
          <div className="mb-4">
            <h4 className="mb-1 fw-semibold text-dark">Search Results</h4>
            <p className="text-muted mb-0">Tools matching your search criteria</p>
          </div>

          <Row className="g-4">
            {filteredTools.map((tool) => (
              <Col lg={4} md={6} key={tool.id}>
                <ToolCard tool={tool} />
              </Col>
            ))}
          </Row>
        </div>
      )}
    </div>
  );
}

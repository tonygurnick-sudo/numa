import { useState, useEffect } from 'react';
import { Row, Col, Dropdown } from 'react-bootstrap';
import { formatCategory } from '../../utils/textUtils';

export const AppSearch = ({
  onSearch,
  categories = [],
  onCategoryFilter,
  onSort,
  initialCategories = [],
  initialSortOrder = 'asc',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategories, setSelectedCategories] = useState(initialCategories);
  const [sortOrder, setSortOrder] = useState(initialSortOrder);

  useEffect(() => {
    setSelectedCategories(initialCategories);
  }, [initialCategories]);

  useEffect(() => {
    setSortOrder(initialSortOrder);
  }, [initialSortOrder]);

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    onSearch(value);
  };

  const handleCategoryClick = (category) => {
    const newCategories = selectedCategories.includes(category)
      ? selectedCategories.filter((c) => c !== category)
      : [...selectedCategories, category];
    setSelectedCategories(newCategories);
    onCategoryFilter(newCategories);
  };

  const handleClearCategories = () => {
    setSelectedCategories([]);
    onCategoryFilter([]);
  };

  const handleSort = (order) => {
    setSortOrder(order);
    onSort(order);
  };

  return (
    <Row className="g-4">
      <Col xs={12}>
        <div className="app-search-container">
          <div className="search-input-wrapper">
            <i className="bi bi-search search-icon"></i>
            <input
              type="text"
              placeholder="Type to Filter Apps"
              value={searchTerm}
              onChange={handleSearch}
              className="search-input"
            />
          </div>

          <div className="filter-controls">
            <div className="category-filters">
              {categories.map((category) => (
                <button
                  key={category}
                  className={`category-filter ${selectedCategories.includes(category) ? 'active' : ''}`}
                  onClick={() => handleCategoryClick(category)}
                  data-category={category.toLowerCase()}
                >
                  {formatCategory(category)}
                </button>
              ))}
              {selectedCategories.length > 0 && (
                <button className="category-filter clear" onClick={handleClearCategories}>
                  Clear
                  <i className="bi bi-x ms-2"></i>
                </button>
              )}
            </div>

            <Dropdown>
              <Dropdown.Toggle variant="" id="sort-dropdown">
                <i className="bi bi-sort-alpha-down me-2"></i>
                Sort {sortOrder === 'asc' ? 'A to Z' : 'Z to A'}
              </Dropdown.Toggle>

              <Dropdown.Menu>
                <Dropdown.Item onClick={() => handleSort('asc')} active={sortOrder === 'asc'}>
                  <i className="bi bi-sort-alpha-down me-2"></i>
                  Sort A to Z
                </Dropdown.Item>
                <Dropdown.Item onClick={() => handleSort('desc')} active={sortOrder === 'desc'}>
                  <i className="bi bi-sort-alpha-up me-2"></i>
                  Sort Z to A
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          </div>
        </div>
      </Col>
    </Row>
  );
};

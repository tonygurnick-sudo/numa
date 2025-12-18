import React from 'react';
import { Form, InputGroup, ButtonGroup, Button, Dropdown } from 'react-bootstrap';
import { Search, Grid, List, Funnel, SortDown } from 'react-bootstrap-icons';

export type ViewMode = 'row' | 'card';
export type SortField = 'created' | 'email';
export type SortDirection = 'asc' | 'desc';

export interface Filters {
  roles: string[];
}

interface UserActionsBarProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  sortField: SortField;
  onSortFieldChange: (field: SortField) => void;
  sortDirection: SortDirection;
  onSortDirectionChange: (direction: SortDirection) => void;
  userCount?: { filtered: number; total: number };
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'standard', label: 'Standard' },
];

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'created', label: 'Created Date' },
  { value: 'email', label: 'Email' },
];

export function UserActionsBar({
  searchTerm,
  onSearchChange,
  viewMode,
  onViewModeChange,
  filters,
  onFiltersChange,
  sortField,
  onSortFieldChange,
  sortDirection,
  onSortDirectionChange,
  userCount,
}: UserActionsBarProps): React.JSX.Element {
  const handleRoleToggle = (role: string) => {
    const newRoles = filters.roles.includes(role) ? filters.roles.filter((r) => r !== role) : [...filters.roles, role];
    onFiltersChange({ ...filters, roles: newRoles });
  };

  const clearFilters = () => {
    onFiltersChange({ roles: [] });
  };

  const activeFilterCount = filters.roles.length;

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      onSortFieldChange(field);
      onSortDirectionChange('desc');
    }
  };

  return (
    <div className="d-flex align-items-center justify-content-between w-100">
      <div className="d-flex gap-2 align-items-center">
        {/* Search Input */}
        <InputGroup style={{ maxWidth: '300px' }}>
          <InputGroup.Text>
            <Search size={14} />
          </InputGroup.Text>
          <Form.Control
            type="text"
            placeholder="Search by email..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search users by email"
          />
        </InputGroup>

        {/* View Toggle */}
        <ButtonGroup size="sm">
          <Button
            variant={viewMode === 'row' ? 'primary' : 'outline-secondary'}
            onClick={() => onViewModeChange('row')}
            title="Table view"
            aria-label="Table view"
          >
            <List size={16} />
          </Button>
          <Button
            variant={viewMode === 'card' ? 'primary' : 'outline-secondary'}
            onClick={() => onViewModeChange('card')}
            title="Card view"
            aria-label="Card view"
          >
            <Grid size={16} />
          </Button>
        </ButtonGroup>

        {/* Filter Dropdown */}
        <Dropdown autoClose="outside">
          <Dropdown.Toggle variant="outline-secondary" size="sm" id="filter-dropdown">
            <Funnel size={14} className="me-1" />
            Filter
            {activeFilterCount > 0 && <span className="badge badge-outline-primary ms-1">{activeFilterCount}</span>}
          </Dropdown.Toggle>
          <Dropdown.Menu style={{ minWidth: '250px' }} className="p-3">
            <div className="mb-3">
              <small className="text-muted fw-semibold d-block mb-2">Role</small>
              {ROLE_OPTIONS.map((option) => (
                <Form.Check
                  key={option.value}
                  type="checkbox"
                  id={`filter-role-${option.value}`}
                  label={option.label}
                  checked={filters.roles.includes(option.value)}
                  onChange={() => handleRoleToggle(option.value)}
                />
              ))}
            </div>
            {activeFilterCount > 0 && (
              <Button variant="link" size="sm" className="p-0" onClick={clearFilters}>
                Clear all filters
              </Button>
            )}
          </Dropdown.Menu>
        </Dropdown>

        {/* Sort Dropdown */}
        <Dropdown>
          <Dropdown.Toggle variant="outline-secondary" size="sm" id="sort-dropdown">
            <SortDown size={14} className="me-1" />
            Sort
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {SORT_OPTIONS.map((option) => (
              <Dropdown.Item
                key={option.value}
                onClick={() => handleSortClick(option.value)}
                active={sortField === option.value}
              >
                {option.label}
                {sortField === option.value && (
                  <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-2`}></i>
                )}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown>
      </div>

      {/* User Count */}
      {userCount && (
        <small className="text-muted">
          {userCount.filtered} of {userCount.total} users
        </small>
      )}
    </div>
  );
}

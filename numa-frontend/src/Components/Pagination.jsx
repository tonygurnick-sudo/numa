import { Pagination as BSPagination } from 'react-bootstrap';

export const Pagination = ({ currentPage, totalPages, onPageChange, maxVisiblePages = 5, className = '' }) => {
  if (totalPages <= 1) return null;

  let items = [];
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  // Adjust start page if we're near the end
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  // Add first page and ellipsis if needed
  if (startPage > 1) {
    items.push(
      <BSPagination.Item key={1} onClick={() => onPageChange(1)}>
        1
      </BSPagination.Item>,
    );
    if (startPage > 2) {
      items.push(<BSPagination.Ellipsis key="ellipsis1" />);
    }
  }

  // Add page numbers
  for (let number = startPage; number <= endPage; number++) {
    items.push(
      <BSPagination.Item key={number} active={number === currentPage} onClick={() => onPageChange(number)}>
        {number}
      </BSPagination.Item>,
    );
  }

  // Add last page and ellipsis if needed
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      items.push(<BSPagination.Ellipsis key="ellipsis2" />);
    }
    items.push(
      <BSPagination.Item key={totalPages} onClick={() => onPageChange(totalPages)}>
        {totalPages}
      </BSPagination.Item>,
    );
  }

  return (
    <BSPagination className={`justify-content-center mt-4 ${className}`}>
      <BSPagination.Prev onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} />
      {items}
      <BSPagination.Next onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} />
    </BSPagination>
  );
};

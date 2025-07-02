import { Spinner } from 'react-bootstrap';
import PropTypes from 'prop-types';

const UploadStatusRow = ({
  text,
  showSpinner = false,
  spinnerSize = 'sm',
  className = '',
  showCheckmark = false,
  variant = 'default',
}) => {
  // Determine status class based on state
  const getStatusClass = () => {
    if (showSpinner) return 'status-loading';
    if (showCheckmark) return 'status-success';
    if (variant === 'error') return 'status-error';
    if (variant === 'warning') return 'status-warning';
    return 'status-default';
  };

  const statusClass = getStatusClass();

  return (
    <div className={`status-indicator ${statusClass} ${className}`}>
      {showSpinner && (
        <Spinner animation="border" size={spinnerSize} role="status" aria-label="Loading" className="status-icon" />
      )}
      {showCheckmark && <i className="bi bi-check-circle-fill status-icon" />}
      {variant === 'error' && !showSpinner && !showCheckmark && (
        <i className="bi bi-exclamation-circle-fill status-icon" />
      )}
      {variant === 'warning' && !showSpinner && !showCheckmark && (
        <i className="bi bi-exclamation-triangle-fill status-icon" />
      )}
      <span className="status-text">{text}</span>
    </div>
  );
};

UploadStatusRow.propTypes = {
  text: PropTypes.string.isRequired,
  showSpinner: PropTypes.bool,
  spinnerSize: PropTypes.string,
  className: PropTypes.string,
  showCheckmark: PropTypes.bool,
  variant: PropTypes.oneOf(['default', 'error', 'warning']),
};

export { UploadStatusRow };

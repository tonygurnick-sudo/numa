import React from 'react';
import { useTranslation } from 'react-i18next';

const Notification = ({
  show,
  variant = 'warning',
  title,
  message,
  actions = [],
  onDismiss,
  autoDismiss = false,
  autoDismissDelay = 5000,
  showProgress = false,
  progressValue = 0,
  progressMax = 100,
  className = '',
  style = {},
}) => {
  const { t } = useTranslation('common');

  React.useEffect(() => {
    if (autoDismiss && show) {
      const timer = setTimeout(() => {
        onDismiss?.();
      }, autoDismissDelay);

      return () => clearTimeout(timer);
    }
  }, [autoDismiss, show, autoDismissDelay, onDismiss]);

  if (!show) return null;

  const getVariantClass = () => {
    switch (variant) {
      case 'success':
        return 'alert-success';
      case 'danger':
        return 'alert-danger';
      case 'info':
        return 'alert-info';
      case 'warning':
        return 'alert-warning';
      default:
        return 'alert-warning';
    }
  };

  const getIcon = () => {
    switch (variant) {
      case 'success':
        return 'bi-check-circle-fill';
      case 'danger':
        return 'bi-exclamation-triangle-fill';
      case 'info':
        return 'bi-info-circle-fill';
      case 'warning':
        return 'bi-exclamation-triangle-fill';
      default:
        return 'bi-exclamation-triangle-fill';
    }
  };

  return (
    <div className="position-fixed top-0 start-0 w-100 p-3" style={{ zIndex: 9999, ...style }}>
      <div className={`alert ${getVariantClass()} alert-dismissible fade show m-0 ${className}`} role="alert">
        <div className="d-flex align-items-center justify-content-between">
          <div className="d-flex align-items-center flex-grow-1">
            <i className={`bi ${getIcon()} me-2`}></i>
            <div className="flex-grow-1">
              {title && <strong className="d-block">{title}</strong>}
              {message && <div className="small">{message}</div>}
            </div>
          </div>

          {actions.length > 0 && (
            <div className="d-flex gap-2 ms-3">
              {actions.map((action, index) => (
                <button
                  key={index}
                  type="button"
                  className={`btn btn-${action.variant || 'outline-secondary'} btn-sm`}
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {onDismiss && (
            <button
              type="button"
              className="btn-close ms-2"
              onClick={onDismiss}
              aria-label={t('common.close')}
            ></button>
          )}
        </div>

        {showProgress && (
          <div className="mt-2">
            <div className="progress" style={{ height: '4px' }}>
              <div
                className={`progress-bar bg-${variant === 'warning' ? 'warning' : variant}`}
                style={{
                  width: `${(progressValue / progressMax) * 100}%`,
                  transition: 'width 1s linear',
                }}
              ></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Notification;

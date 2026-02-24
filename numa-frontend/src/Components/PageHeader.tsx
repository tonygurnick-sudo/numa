import React, { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string | ReactNode;
  subtitle?: string | ReactNode;
  icon?: {
    element: ReactNode;
    backgroundColor?: string;
    color?: string;
  };
  actions?: ReactNode;
  className?: string;
  actionsClassName?: string;
}

/**
 * Shared page header component for consistent layout across all Numa pages.
 *
 * Features:
 * - Title and subtitle on the left
 * - Optional icon before title
 * - Optional action buttons on the right
 * - Responsive layout (stacks on mobile)
 * - Uses standard .page-header styling from _layout.scss
 *
 * @example
 * // Simple header
 * <PageHeader
 *   title="Company Info"
 *   subtitle="Manage your company information and settings"
 * />
 *
 * @example
 * // Header with icon and buttons
 * <PageHeader
 *   title="AI Agents"
 *   subtitle="Design, deploy, and manage your intelligent AI assistants"
 *   icon={{
 *     element: <i className="bi bi-robot" />,
 *     backgroundColor: brandPrimaryColor,
 *     color: brandPrimaryContrast
 *   }}
 *   actions={
 *     <>
 *       <Button variant="secondary" onClick={handleRefresh}>
 *         <i className="bi bi-arrow-clockwise me-1"></i> Refresh
 *       </Button>
 *       <Button onClick={handleCreate}>
 *         <i className="bi bi-plus-circle me-2"></i> Create Agent
 *       </Button>
 *     </>
 *   }
 * />
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  icon,
  actions,
  className = '',
  actionsClassName = '',
}) => {
  const headerClassName = ['page-header', className].filter(Boolean).join(' ');
  const actionsClassNames = ['page-header__actions', actionsClassName].filter(Boolean).join(' ');

  return (
    <header className={headerClassName}>
      <div className="page-header__inner">
        <div className="page-header__title-wrap">
          {icon && (
            <div
              className="page-icon"
              style={{
                backgroundColor: icon.backgroundColor,
                flexShrink: 0,
              }}
            >
              {React.isValidElement(icon.element)
                ? React.cloneElement(icon.element as React.ReactElement, {
                    style: {
                      fontSize: '28px',
                      color: icon.color,
                      ...(icon.element as React.ReactElement).props?.style,
                    },
                  })
                : icon.element}
            </div>
          )}
          <div className="page-header__title-group">
            <h1 className="page-title" title={typeof title === 'string' ? title : undefined}>
              {title}
            </h1>
            {subtitle && (
              <p className="page-subtitle" title={typeof subtitle === 'string' ? subtitle : undefined}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {actions && <div className={actionsClassNames}>{actions}</div>}
      </div>
    </header>
  );
};

export default PageHeader;

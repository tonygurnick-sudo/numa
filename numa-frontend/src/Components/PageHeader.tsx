import React, { ReactNode } from 'react';
import { Container, Row, Col } from 'react-bootstrap';

export interface PageHeaderProps {
  title: string | ReactNode;
  subtitle?: string;
  icon?: {
    element: ReactNode;
    backgroundColor?: string;
    color?: string;
  };
  actions?: ReactNode;
  className?: string;
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
export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, icon, actions, className = '' }) => {
  return (
    <header className={`page-header ${className}`}>
      <Container fluid>
        <Row>
          <Col lg={12}>
            <div className="d-flex flex-column flex-lg-row align-items-start align-items-lg-center justify-content-between gap-3">
              <div className="d-flex align-items-center gap-3 flex-grow-1 min-w-0">
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
                <div className="min-w-0 flex-grow-1">
                  <h1
                    className="page-title text-truncate"
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginBottom: subtitle ? '0.25rem' : '0',
                    }}
                    title={typeof title === 'string' ? title : undefined}
                  >
                    {title}
                  </h1>
                  {subtitle && (
                    <p
                      className="page-subtitle text-truncate"
                      style={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginBottom: '0',
                      }}
                      title={subtitle}
                    >
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>
              {actions && <div className="d-flex gap-2 align-items-center flex-shrink-0 flex-wrap">{actions}</div>}
            </div>
          </Col>
        </Row>
      </Container>
    </header>
  );
};

export default PageHeader;

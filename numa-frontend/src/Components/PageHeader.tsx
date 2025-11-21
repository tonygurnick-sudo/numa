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
            <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3">
              <div className="d-flex align-items-center gap-3">
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
                <div>
                  <h1 className="page-title">{title}</h1>
                  {subtitle && <p className="page-subtitle">{subtitle}</p>}
                </div>
              </div>
              {actions && <div className="d-flex gap-2 align-items-center">{actions}</div>}
            </div>
          </Col>
        </Row>
      </Container>
    </header>
  );
};

export default PageHeader;

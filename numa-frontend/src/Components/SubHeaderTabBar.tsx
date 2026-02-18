import { Container, Nav } from 'react-bootstrap';

const joinClassNames = (...classes: Array<string | undefined>) => classes.filter(Boolean).join(' ');

export interface SubHeaderTabItem {
  key: string;
  label: string;
  iconClassName?: string;
}

interface SubHeaderTabBarProps {
  items: SubHeaderTabItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  ariaLabel?: string;
  className?: string;
  navClassName?: string;
}

export function SubHeaderTabBar({
  items,
  activeKey,
  onSelect,
  ariaLabel,
  className,
  navClassName,
}: SubHeaderTabBarProps) {
  return (
    <div className={joinClassNames('sub-header-tabs-bar', className)}>
      <Container fluid className="sub-header-tabs-bar__inner">
        <Nav
          variant="tabs"
          activeKey={activeKey}
          onSelect={(key) => key && onSelect(key)}
          className={joinClassNames('mb-0 styled-tabs-nav', navClassName)}
          aria-label={ariaLabel}
        >
          {items.map((item) => (
            <Nav.Item key={item.key}>
              <Nav.Link eventKey={item.key}>
                {item.iconClassName ? <i className={item.iconClassName} aria-hidden="true"></i> : null}
                <span>{item.label}</span>
              </Nav.Link>
            </Nav.Item>
          ))}
        </Nav>
      </Container>
    </div>
  );
}

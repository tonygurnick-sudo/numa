import { useCallback, useEffect, useRef, useState } from 'react';
import { Container, Dropdown, Nav } from 'react-bootstrap';
import { Bot } from 'lucide-react';

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

function TabIcon({ iconClassName }: { iconClassName?: string }) {
  if (!iconClassName) return null;
  if (iconClassName === 'bi bi-robot') return <Bot size={16} aria-hidden="true" />;
  return <i className={iconClassName} aria-hidden="true" />;
}

const OVERFLOW_BUTTON_WIDTH = 36;

export function SubHeaderTabBar({
  items,
  activeKey,
  onSelect,
  ariaLabel,
  className,
  navClassName,
}: SubHeaderTabBarProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [overflowIndex, setOverflowIndex] = useState(items.length);

  const recalculate = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // Items are always in flow (never position:absolute) so offsetLeft is reliable
    const availableWidth = wrapper.offsetWidth - OVERFLOW_BUTTON_WIDTH;
    let cutoff = items.length;

    for (let i = 0; i < itemRefs.current.length; i++) {
      const el = itemRefs.current[i];
      if (!el) continue;
      if (el.offsetLeft + el.offsetWidth > availableWidth) {
        cutoff = i;
        break;
      }
    }

    // All tabs fit with overflow button space reserved — check if they
    // also fit at full width so we can skip showing the button entirely
    if (cutoff === items.length) {
      const lastEl = itemRefs.current[items.length - 1];
      if (lastEl && lastEl.offsetLeft + lastEl.offsetWidth <= wrapper.offsetWidth) {
        cutoff = items.length;
      }
    }

    setOverflowIndex(cutoff);
  }, [items.length]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    if (typeof ResizeObserver === 'undefined') {
      requestAnimationFrame(recalculate);
      return;
    }

    // Observe the wrapper (not the nav) — its width is stable regardless
    // of whether the overflow dropdown is rendered, preventing feedback loops
    const observer = new ResizeObserver(() => recalculate());
    observer.observe(wrapper);

    requestAnimationFrame(recalculate);

    return () => observer.disconnect();
  }, [recalculate]);

  // Recalculate when items change
  useEffect(() => {
    requestAnimationFrame(recalculate);
  }, [items, recalculate]);

  const overflowItems = items.slice(overflowIndex);
  const hasOverflow = overflowItems.length > 0;
  const activeInOverflow = overflowItems.some((item) => item.key === activeKey);

  return (
    <div className={joinClassNames('sub-header-tabs-bar', className)}>
      <Container fluid className="sub-header-tabs-bar__inner">
        <div ref={wrapperRef} className="sub-header-tabs-bar__nav-wrapper">
          <Nav
            ref={navRef}
            variant="tabs"
            activeKey={activeKey}
            onSelect={(key) => key && onSelect(key)}
            className={joinClassNames('mb-0 styled-tabs-nav sub-header-tabs-bar__nav-nowrap', navClassName)}
            aria-label={ariaLabel}
          >
            {items.map((item, i) => (
              <Nav.Item
                key={item.key}
                ref={(el: HTMLElement | null) => {
                  itemRefs.current[i] = el;
                }}
              >
                <Nav.Link
                  eventKey={item.key}
                  tabIndex={i >= overflowIndex ? -1 : undefined}
                  aria-hidden={i >= overflowIndex ? true : undefined}
                >
                  <TabIcon iconClassName={item.iconClassName} />
                  <span>{item.label}</span>
                </Nav.Link>
              </Nav.Item>
            ))}
          </Nav>

          {hasOverflow && (
            <Dropdown align="end" className="sub-header-tabs-bar__overflow">
              <Dropdown.Toggle
                variant="link"
                className={joinClassNames(
                  'sub-header-tabs-bar__overflow-btn',
                  activeInOverflow ? 'sub-header-tabs-bar__overflow-btn--active' : undefined
                )}
                aria-label="More tabs"
              >
                <i className="bi bi-chevron-down" />
              </Dropdown.Toggle>
              <Dropdown.Menu>
                {overflowItems.map((item) => (
                  <Dropdown.Item key={item.key} active={item.key === activeKey} onClick={() => onSelect(item.key)}>
                    <TabIcon iconClassName={item.iconClassName} />
                    <span className="ms-2">{item.label}</span>
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>
          )}
        </div>
      </Container>
    </div>
  );
}

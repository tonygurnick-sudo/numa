import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { Nav } from '../Components/Nav';
import { WelcomeProfileSetupModal } from '../Components/WelcomeProfileSetupModal';
import '../assets/styles/layouts/AppLayout.scss';

interface AppLayoutProps {
  children: ReactNode;
}

const SIDEBAR_COLLAPSE_BREAKPOINT = 1200;
const SIDEBAR_COLLAPSE_KEY = 'numa-sidebar-collapsed';

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  // Initialize collapse state from localStorage or default to expanded (false)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    if (stored !== null) return stored === 'true';
    return false;
  });

  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : SIDEBAR_COLLAPSE_BREAKPOINT
  );

  // Skip auto-collapse on initial mount so localStorage preference is respected
  const hasMounted = useRef(false);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-collapse/expand only on actual window resizes (not initial mount)
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    if (windowWidth < SIDEBAR_COLLAPSE_BREAKPOINT && windowWidth > 768) {
      setIsCollapsed(true);
    } else if (windowWidth >= SIDEBAR_COLLAPSE_BREAKPOINT) {
      setIsCollapsed(false);
    }
  }, [windowWidth]);

  // Persist collapse state to localStorage
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, String(isCollapsed));
  }, [isCollapsed]);

  // Listen for custom collapse event (e.g., when opening file preview)
  useEffect(() => {
    const handleCollapseEvent = () => {
      setIsCollapsed(true);
    };
    window.addEventListener('numa-collapse-sidebar', handleCollapseEvent);
    return () => window.removeEventListener('numa-collapse-sidebar', handleCollapseEvent);
  }, []);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Don't render the 2-panel layout on mobile (≤768px)
  // Mobile uses horizontal top nav (handled by Nav component)
  const isMobile = windowWidth <= 768;

  if (isMobile) {
    return (
      <div className="app-layout-mobile">
        <Nav isCollapsed={false} onToggleCollapse={toggleCollapse} />
        <div className="app-layout-mobile-content">{children}</div>
        <WelcomeProfileSetupModal />
      </div>
    );
  }

  return (
    <div className={`app-layout ${isCollapsed ? 'sidebar-collapsed' : 'sidebar-expanded'}`}>
      <aside className="app-layout-sidebar">
        <Nav isCollapsed={isCollapsed} onToggleCollapse={toggleCollapse} />
      </aside>
      <main className="app-layout-content">{children}</main>
      <WelcomeProfileSetupModal />
    </div>
  );
};

export default AppLayout;

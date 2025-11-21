import React, { useState, useEffect, ReactNode } from 'react';
import { Nav } from '../Components/Nav';
import '../assets/styles/layouts/AppLayout.scss';

interface AppLayoutProps {
  children: ReactNode;
}

const SIDEBAR_COLLAPSE_BREAKPOINT = 1200;
const SIDEBAR_COLLAPSE_KEY = 'numa-sidebar-collapsed';

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  // Initialize collapse state from localStorage or default to false
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    return stored === 'true';
  });

  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : SIDEBAR_COLLAPSE_BREAKPOINT,
  );

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-collapse/expand based on window width
  useEffect(() => {
    if (windowWidth < SIDEBAR_COLLAPSE_BREAKPOINT && windowWidth > 768) {
      // Auto-collapse for medium screens (between mobile and large desktop)
      setIsCollapsed(true);
    } else if (windowWidth >= SIDEBAR_COLLAPSE_BREAKPOINT) {
      // Auto-expand for large screens
      setIsCollapsed(false);
    }
  }, [windowWidth]);

  // Persist collapse state to localStorage
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, String(isCollapsed));
  }, [isCollapsed]);

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
      </div>
    );
  }

  return (
    <div className={`app-layout ${isCollapsed ? 'sidebar-collapsed' : 'sidebar-expanded'}`}>
      <aside className="app-layout-sidebar">
        <Nav isCollapsed={isCollapsed} onToggleCollapse={toggleCollapse} />
      </aside>
      <main className="app-layout-content">{children}</main>
    </div>
  );
};

export default AppLayout;

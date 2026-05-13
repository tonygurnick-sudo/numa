import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { Nav } from '../Components/Nav';
import { WelcomeProfileSetupModal } from '../Components/WelcomeProfileSetupModal';
import { AskNumaButton } from '../Components/AskNuma/AskNumaButton';
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

  // Track previous width so we only act on actual breakpoint crossings,
  // not on initial mount (which would clobber the stored preference,
  // especially under StrictMode's effect double-invoke in dev).
  const prevWidthRef = useRef(windowWidth);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-collapse only when the viewport crosses INTO the narrow range.
  // No auto-expand on widen — the user's toggle/localStorage wins from there.
  useEffect(() => {
    const prev = prevWidthRef.current;
    prevWidthRef.current = windowWidth;
    if (prev >= SIDEBAR_COLLAPSE_BREAKPOINT && windowWidth < SIDEBAR_COLLAPSE_BREAKPOINT && windowWidth > 768) {
      setIsCollapsed(true);
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
        <WelcomeProfileSetupModal />
        <AskNumaButton />
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
      <AskNumaButton />
    </div>
  );
};

export default AppLayout;

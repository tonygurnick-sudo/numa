/**
 * Demo Layout — wraps the public demo page with a static, non-interactive
 * sidebar so visitors see the full Numa shell (instead of just a chat bot).
 *
 * Defaults to collapsed. Sidebar renders on desktop in both standalone and
 * embed (?mode=embed) modes -- embed styling picks up the lavender palette
 * via the `.demo-embed` scope on the outer page. Hidden on mobile where the
 * iframe/phone experience would be cramped.
 */

import { ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DemoNav } from '../Components/DemoNav';
import '../assets/styles/layouts/AppLayout.scss';

interface DemoLayoutProps {
  children: ReactNode;
}

const MOBILE_BREAKPOINT = 768;

const DemoLayout = ({ children }: DemoLayoutProps) => {
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get('mode') === 'embed';

  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth <= MOBILE_BREAKPOINT : false
  );

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Mobile: drop the sidebar entirely (narrow screen / iframe-on-phone).
  if (isMobile) {
    return <>{children}</>;
  }

  const layoutClass = [
    'app-layout',
    'demo-layout',
    isCollapsed ? 'sidebar-collapsed' : 'sidebar-expanded',
    isEmbed ? 'demo-layout--embed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={layoutClass}>
      <aside className="app-layout-sidebar">
        <DemoNav isCollapsed={isCollapsed} onToggleCollapse={() => setIsCollapsed((v) => !v)} />
      </aside>
      <main className="app-layout-content">{children}</main>
    </div>
  );
};

export default DemoLayout;

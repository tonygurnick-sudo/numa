import { ReactNode } from 'react';

interface LayoutDashboardProps {
  children: ReactNode;
}

const LayoutDashboard = ({ children }: LayoutDashboardProps) => {
  return <div className="app-content">{children}</div>;
};

export { LayoutDashboard };

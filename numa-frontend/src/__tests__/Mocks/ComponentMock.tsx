import { vi } from 'vitest';

// Breadcrumbs Mock
export const MockBreadcrumbs = () => <div data-testid="mock-breadcrumbs">Breadcrumbs</div>;
vi.mock('../../Components/Breadcrumbs', () => ({
  Breadcrumbs: MockBreadcrumbs,
}));

// Preloader Mock
export const MockPreloader = ({ smallscreen }) => (
  <div data-testid={`mock-preloader${smallscreen ? '-small' : ''}`}>Loading...</div>
);
vi.mock('../../Components/Preloader', () => ({
  Preloader: MockPreloader,
}));

// LayoutDashboard Mock with outer and inner wrappers
export const MockLayoutDashboard = ({ children }) => (
  <div data-testid="mock-layout-dashboard-outer">
    <div data-testid="mock-layout-dashboard-inner">{children}</div>
  </div>
);
vi.mock('../../Layouts/LayoutDashboard', () => ({
  LayoutDashboard: MockLayoutDashboard,
}));

// Mock Nav component
export const MockNav = () => <div data-testid="mock-nav">Nav</div>;
vi.mock(
  '../../Components/Nav',
  () => ({
    Nav: MockNav,
  }),
  { virtual: true }
);

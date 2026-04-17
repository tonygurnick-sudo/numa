import { Navigate } from 'react-router-dom';

/**
 * CompanyInfo standalone page is deprecated.
 * Redirects to Settings > Admin > Company Profile tab.
 */
const CompanyInfo = () => {
  return <Navigate to="/settings/admin/company-profile" replace />;
};

export { CompanyInfo };

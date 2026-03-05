import { AuthProvider } from './AuthProvider';
import { NumaRequestProvider } from './RequestProvider';
import { NumaAppProvider } from './NumaAppProvider';
import { JobStatusProvider } from './JobStatusProvider';
import { KnowledgeBaseProvider } from './KnowledgeBaseProvider';
import { AdminCapabilityGateLoader } from './AdminCapabilityGateLoader';

const AppProviders = ({ children }) => {
  return (
    <AuthProvider>
      <NumaRequestProvider>
        <AdminCapabilityGateLoader />
        <KnowledgeBaseProvider>
          <NumaAppProvider>
            <JobStatusProvider>{children}</JobStatusProvider>
          </NumaAppProvider>
        </KnowledgeBaseProvider>
      </NumaRequestProvider>
    </AuthProvider>
  );
};

export default AppProviders;

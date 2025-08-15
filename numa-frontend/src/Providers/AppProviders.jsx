import { AuthProvider } from './AuthProvider';
import { NumaRequestProvider } from './RequestProvider';
import { NumaAppProvider } from './NumaAppProvider';
import { JobStatusProvider } from './JobStatusProvider';

const AppProviders = ({ children }) => {
  return (
    <AuthProvider>
      <NumaRequestProvider>
        <NumaAppProvider>
          <JobStatusProvider>{children}</JobStatusProvider>
        </NumaAppProvider>
      </NumaRequestProvider>
    </AuthProvider>
  );
};

export default AppProviders;

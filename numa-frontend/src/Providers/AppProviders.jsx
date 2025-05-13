import { AuthProvider } from './AuthProvider';
import { NumaRequestProvider } from './RequestProvider';
import { NumaAppProvider } from './NumaAppProvider';

const AppProviders = ({ children }) => {
  return (
    <AuthProvider>
      <NumaRequestProvider>
        <NumaAppProvider>{children}</NumaAppProvider>
      </NumaRequestProvider>
    </AuthProvider>
  );
};

export default AppProviders;

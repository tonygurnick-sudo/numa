import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import 'bootstrap-icons/font/bootstrap-icons.css';
//import './assets/css/Styles.scss';
import './assets/styles/Main.scss';

import { NumaRoutes } from './Routes';
import { BrandingProvider } from './Providers/BrandingProvider';

function App() {
  return (
    <BrandingProvider>
      <NumaRoutes />
    </BrandingProvider>
  );
}

export default App;

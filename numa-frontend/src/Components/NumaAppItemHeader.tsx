import { useNumaApp } from '../Providers/NumaAppProvider';
import { useTranslation } from 'react-i18next';

const NumaAppItemHeader = () => {
  const { numaAppData } = useNumaApp();
  const { t } = useTranslation('common');

  return (
    <div className="app-header py-4">
      <div className="container">
        <div className="row">
          <div className="col">
            <h1 className="mb-2">{numaAppData?.title || t('loading.generic')}</h1>
            <p className="text-muted mb-0">{numaAppData?.description || ''}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export { NumaAppItemHeader };

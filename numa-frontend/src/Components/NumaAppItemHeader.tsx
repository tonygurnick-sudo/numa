import { useNumaApp } from '../Providers/NumaAppProvider';

const NumaAppItemHeader = () => {
  const { numaAppData } = useNumaApp();

  return (
    <div className="app-header py-4">
      <div className="container">
        <div className="row">
          <div className="col">
            <h1 className="mb-2">{numaAppData?.title || 'Loading...'}</h1>
            <p className="text-muted mb-0">{numaAppData?.description || ''}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export { NumaAppItemHeader };

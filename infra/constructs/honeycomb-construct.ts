import { HoneycombioProvider } from '../.gen/providers/honeycombio/provider';
import { Environment } from '../.gen/providers/honeycombio/environment';
import { ApiKey } from '../.gen/providers/honeycombio/api-key';
import { Construct } from 'constructs';

export class Honeycomb extends Construct {
  readonly frontendKey: string;
  readonly backendKey: string;

  constructor(scope: Construct, name: string, props: HoneycombProps) {
    super(scope, name);

    new HoneycombioProvider(this, 'honeycomb-provider', {});
    const honeycombEnvironment = new Environment(this, 'honeycomb-environment', {
      name: props.name,
      color: 'purple',
    });
    const apiKey = new ApiKey(this, 'honeycomb-backend-ingest-key', {
      name: 'Backend Ingest Key',
      type: 'ingest',
      environmentId: honeycombEnvironment.id,
      permissions: [
        {
          createDatasets: true, // This key is only used in the backend, so it can create datasets.
        },
      ],
    });
    const frontendKey = new ApiKey(this, 'honeycomb-frontend-ingest-key', {
      name: 'Frontend Ingest Key',
      type: 'ingest',
      environmentId: honeycombEnvironment.id,
      permissions: [
        {
          // We expose this key, so don't want to it to have too many privileges.
          // The dataset for frontend usage will need to be manually created.
          createDatasets: false,
        },
      ],
    });

    // Keys are comprised of the key id concatenated with the key secret.
    this.backendKey = apiKey.id + apiKey.secret;
    this.frontendKey = frontendKey.id + frontendKey.secret;
  }
}

export interface HoneycombProps {
  name: string;
}

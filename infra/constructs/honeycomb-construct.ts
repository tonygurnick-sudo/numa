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
    // Remove this tempoarily to decrease the number of keys we create.
    // const apiKey = new ApiKey(this, 'honeycomb-backend-ingest-key', {
    //   name: 'Backend Ingest Key',
    //   type: 'ingest',
    //   environmentId: honeycombEnvironment.id,
    //   permissions: [
    //     {
    //       createDatasets: true, // This key is only used in the backend, so it can create datasets.
    //     },
    //   ],
    // });
    // this.backendKey = apiKey.id + apiKey.secret;
    const frontendKey = new ApiKey(this, 'honeycomb-frontend-ingest-key', {
      name: 'Frontend Ingest Key',
      type: 'ingest',
      environmentId: honeycombEnvironment.id,
      permissions: [
        {
          // We expose this key, so don't want to it to have too many privileges.
          // However, we can't currently programmatically create the appropriate key needed for explicit dataset creation.
          // So for now, make this true.
          createDatasets: true,
        },
      ],
    });

    // Keys are comprised of the key id concatenated with the key secret.
    this.frontendKey = frontendKey.id + frontendKey.secret;
    this.backendKey = this.frontendKey; // TODO: remove this when we create the backend key.
  }
}

export interface HoneycombProps {
  name: string;
}

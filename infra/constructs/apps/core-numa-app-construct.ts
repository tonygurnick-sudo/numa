import { Construct } from 'constructs';
import { AppStatus, BaseNumaApp, BaseNumaAppProps } from './base-numa-app-construct';

// TODO: This isn't really an app, but wants addLambdaFunction. We should refactor that out so this doesn't need a manifest.
export class CoreNumaApp extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: CoreNumaAppProps) {
    super(scope, name, props);

    this.manifest = {
      appName: 'Core',
      id: 'core-app',
      type: 'core',
      status: AppStatus.INTERNAL,
      createdDate: '2025-01-01',
      appDescription: 'Core Numa App',
      tasks: [],
    };

    // SRP Proxy
    const environment = {
      variables: {
        ALLOWED_ORIGIN: '*', // TODO: More closely scope this.
        CLIENT_SECRET: props.clientSecret,
        COGNITO_CLIENT_ID: props.clientId,
        COGNITO_REGION: 'us-east-1',
      },
    };

    this.addLambdaFunction(this, 'cors', {
      addAuthorizer: false,
      lambdaDirectory: 'node/srp-proxy',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      route: {
        verb: 'OPTIONS',
        path: '{PROXY+}',
      },
      environment,
    });
    this.addLambdaFunction(this, 'initiate', {
      addAuthorizer: false,
      lambdaDirectory: 'node/srp-proxy',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      route: {
        verb: 'POST',
        path: 'initiate',
      },
      environment,
    });
    this.addLambdaFunction(this, 'refresh', {
      addAuthorizer: false,
      lambdaDirectory: 'node/srp-proxy',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      route: {
        verb: 'POST',
        path: 'refresh',
      },
      environment,
    });
    this.addLambdaFunction(this, 'respond', {
      addAuthorizer: false,
      lambdaDirectory: 'node/srp-proxy',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      route: {
        verb: 'POST',
        path: 'respond',
      },
      environment,
    });
  }
}

export interface CoreNumaAppProps extends BaseNumaAppProps {
  clientId: string;
  clientSecret: string;
}

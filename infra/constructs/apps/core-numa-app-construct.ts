import { Construct } from 'constructs';
import { BaseNumaApp, BaseNumaAppProps } from './base-numa-app-construct';

export class CoreNumaApp extends BaseNumaApp {
  constructor(scope: Construct, name: string, props: CoreNumaAppProps) {
    super(scope, name, props);

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

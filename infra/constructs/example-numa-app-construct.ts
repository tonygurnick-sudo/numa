import { Construct } from 'constructs';
import { BaseNumaApp, BaseNumaAppProps } from './base-numa-app-construct';

export class ExampleNumaApp extends BaseNumaApp {
  constructor(scope: Construct, name: string, props: ExampleNumaAppProps) {
    props.pathPrefix ??= 'example';
    super(scope, name, props);

    // Add a lambda that responds to a POST at ${prefix}/a
    this.addLambdaFunction(this, 'post-lambda', {
      route: {
        verb: 'POST',
        path: 'a',
      },
      functionName: 'example-1',
    });

    // Add a lambda that responds to a GET at ${prefix}/b
    this.addLambdaFunction(this, 'get-lambda', {
      route: {
        verb: 'GET',
        path: 'b',
      },
      functionName: 'example-2',
    });

    // Add a lambda that doesn't have a route, e.g. for use in a Step Function.
    this.addLambdaFunction(this, 'non-routed-lambda', {
      functionName: 'example-3',
    });
  }
}

export interface ExampleNumaAppProps extends BaseNumaAppProps {} // eslint-disable-line @typescript-eslint/no-empty-object-type

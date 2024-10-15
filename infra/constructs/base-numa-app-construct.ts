import { Construct } from 'constructs';

export class BaseNumaApp extends Construct {
  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name);
    props.name = props.name; // Placeholder to fix linting issues in way both tsc and eslint like.
  }
}

export interface BaseNumaAppProps {
  name: string;
}

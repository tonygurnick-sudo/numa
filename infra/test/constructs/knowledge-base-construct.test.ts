import { TerraformStack, Testing } from 'cdktf';
import { Construct } from 'constructs';
import assert from 'node:assert';
import { before, describe, it } from 'node:test';
import { KnowledgeBase } from '../../constructs/knowledge-base-construct';

class TestStack extends TerraformStack {
  constructor(scope: Construct, name: string, props: TestStackProps) {
    super(scope, name);
    new KnowledgeBase(this, 'test', {
      region: 'ap-southeast-2',
      clientName: props.clientName,
      embeddingModel: 'amazon.titan-embed-text-v2:0',
      bedrockParserModel: 'anthropic.claude-3-haiku-20240307-v1:0',
    });
  }
}

interface TestStackProps {
  clientName: string;
}

type Synthed = {
  resource: Record<string, Record<string, unknown>>;
};

const testCases = {
  basic: {
    clientName: 'test',
    clusterName: 'test-knowledge-base',
  },
  leadingNumber: {
    clientName: '123test',
    clusterName: 'numa-123test-knowledge-base',
  },
};

Object.entries(testCases).forEach(([name, props]) =>
  describe('KnowledgeBaseConstruct-' + name, () => {
    let synthesized: string;
    let stackObject: Synthed;
    before(() => {
      const app = Testing.app();
      const stack = new TestStack(app, 'test', props);
      synthesized = Testing.synth(stack);
      stackObject = JSON.parse(synthesized);
    });
    it('Creates a VPC', () => {
      const vpc = stackObject.resource.aws_vpc;
      assert.equal(Object.keys(vpc).length, 1);
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_vpc', {
          cidrBlock: '10.32.0.0/16',
          enableDnsSupport: true,
          enableDnsHostnames: true,
          tags: {
            Name: props.clientName + '-knowledge-base',
          },
        }),
      );
    });
    it('Creates subnets', () => {
      const vpc = stackObject.resource.aws_vpc;
      const vpcId = Object.keys(vpc)[0];

      assert.equal(Object.keys(stackObject.resource.aws_subnet).length, 2);
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_subnet', {
          vpcId: '${aws_vpc.' + vpcId + '.id}',
          availabilityZone: 'ap-southeast-2a',
          cidrBlock: '${cidrsubnet("10.32.0.0/16", 8, 0)}',
          tags: {
            Name: props.clientName + '-knowledge-base-ap-southeast-2a',
          },
        }),
      );
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_subnet', {
          vpcId: '${aws_vpc.' + vpcId + '.id}',
          availabilityZone: 'ap-southeast-2b',
          cidrBlock: '${cidrsubnet("10.32.0.0/16", 8, 1)}',
          tags: {
            Name: props.clientName + '-knowledge-base-ap-southeast-2b',
          },
        }),
      );
    });

    it('Creates a DB subnet group', () => {
      const dbSubnetGroup = stackObject.resource.aws_db_subnet_group;
      assert.equal(Object.keys(dbSubnetGroup).length, 1);
      const subnetIds = Object.keys(stackObject.resource.aws_subnet);
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_db_subnet_group', {
          subnetIds: ['${aws_subnet.' + subnetIds[0] + '.id}', '${aws_subnet.' + subnetIds[1] + '.id}'],
        }),
      );
    });

    it('Creates a security group', () => {
      const vpc = stackObject.resource.aws_vpc;
      const vpcId = Object.keys(vpc)[0];
      const securityGroup = stackObject.resource.aws_security_group;
      assert.equal(Object.keys(securityGroup).length, 1);
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_security_group', {
          vpcId: '${aws_vpc.' + vpcId + '.id}',
        }),
      );

      const securityGroupEgress = stackObject.resource.aws_vpc_security_group_egress_rule;
      assert.equal(securityGroupEgress, undefined);
      const securityGroupIngress = stackObject.resource.aws_vpc_security_group_ingress_rule;
      assert.equal(securityGroupIngress, undefined);
    });

    it('Creates a RDS cluster', () => {
      const securityGroupId = Object.keys(stackObject.resource.aws_security_group)[0];
      const dbSubnetGroupId = Object.keys(stackObject.resource.aws_db_subnet_group)[0];
      const rdsCluster = stackObject.resource.aws_rds_cluster;
      assert.equal(Object.keys(rdsCluster).length, 1);
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_rds_cluster', {
          clusterIdentifier: props.clusterName,
          vpcSecurityGroupIds: ['${aws_security_group.' + securityGroupId + '.id}'],
          dbSubnetGroupName: '${aws_db_subnet_group.' + dbSubnetGroupId + '.name}',
          engine: 'aurora-postgresql',
          engineMode: 'provisioned',
          serverlessv2ScalingConfiguration: {
            minCapacity: 0,
            maxCapacity: 1,
            secondsUntilAutoPause: 300,
          },

          lifecycle: {
            ignoreChanges: ['engine_version'],
          },
        }),
      );
    });

    it('Creates a RDS cluster instance', () => {
      const rdsClusterId = Object.keys(stackObject.resource.aws_rds_cluster)[0];
      const rdsClusterInstance = stackObject.resource.aws_rds_cluster_instance;
      assert.equal(Object.keys(rdsClusterInstance).length, 1);
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_rds_cluster_instance', {
          clusterIdentifier: '${aws_rds_cluster.' + rdsClusterId + '.id}',
          instanceClass: 'db.serverless',
          engine: '${aws_rds_cluster.' + rdsClusterId + '.engine}',
          engineVersion: '${aws_rds_cluster.' + rdsClusterId + '.engine_version}',
          lifecycle: {
            ignoreChanges: ['engine_version'],
          },
        }),
      );
    });

    it('Creates a knowledge base', () => {
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_iam_role', {
          name: props.clientName + '-knowledge-base',
        }),
      );
      const roleId = Object.entries(stackObject.resource.aws_iam_role as Record<string, { name: string }>).filter(
        ([, value]) => value.name === props.clientName + '-knowledge-base',
      )[0][0];
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_iam_policy', {
          name: props.clientName + '-knowledge-base',
        }),
      );
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_iam_role_policy_attachment', {
          role: '${aws_iam_role.' + roleId + '.name}',
        }),
      );

      const secretId = Object.entries(
        stackObject.resource.aws_secretsmanager_secret as Record<string, { name: string }>,
      ).filter(([, value]) => value.name === props.clientName + '-bedrock-user')[0][0];
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_bedrockagent_knowledge_base', {
          name: props.clientName + '-knowledge-base',
          roleArn: '${aws_iam_role.' + roleId + '.arn}',
          storageConfiguration: [
            {
              type: 'RDS',
              rds_configuration: [
                {
                  resourceArn: '${aws_rds_cluster.' + Object.keys(stackObject.resource.aws_rds_cluster)[0] + '.arn}',
                  credentialsSecretArn: '${aws_secretsmanager_secret.' + secretId + '.arn}',
                },
              ],
            },
          ],
        }),
      );
    });

    it('Creates the bedrock user secret', () => {
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_secretsmanager_secret', {
          name: props.clientName + '-bedrock-user',
        }),
      );
    });

    it('Creates the lambda function', () => {
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_iam_role', {
          name: props.clientName + '-knowledge-base-init',
        }),
      );
      const roleId = Object.entries(stackObject.resource.aws_iam_role as Record<string, { name: string }>).filter(
        ([, value]) => value.name === props.clientName + '-knowledge-base-init',
      )[0][0];
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_iam_policy', {
          name: props.clientName + '-knowledge-base-init',
        }),
      );
      const policyId = Object.entries(stackObject.resource.aws_iam_policy as Record<string, { name: string }>).filter(
        ([, value]) => value.name === props.clientName + '-knowledge-base-init',
      )[0][0];
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_iam_role_policy_attachment', {
          role: '${aws_iam_role.' + roleId + '.name}',
          policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        }),
      );
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_iam_role_policy_attachment', {
          role: '${aws_iam_role.' + roleId + '.name}',
          policyArn: '${aws_iam_policy.' + policyId + '.arn}',
        }),
      );

      const lambdaFunction = stackObject.resource.aws_lambda_function;
      assert.equal(Object.keys(lambdaFunction).length, 2);
      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_lambda_function', {
          functionName: props.clientName + '-knowledge-base-init',
          handler: 'index.handler',
          runtime: 'nodejs22.x',
          timeout: 60,
          role: '${aws_iam_role.' + roleId + '.arn}',
        }),
      );

      assert(
        Testing.toHaveResourceWithProperties(synthesized, 'aws_lambda_function', {
          functionName: props.clientName + '-knowledge-base-cleanup',
          handler: 'index.handler',
          runtime: 'nodejs22.x',
          timeout: 300,
        }),
      );

      assert(Testing.toHaveResourceWithProperties(synthesized, 'aws_lambda_invocation', {}));
    });
  }),
);

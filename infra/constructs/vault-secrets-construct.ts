import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { Construct } from 'constructs';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { NumaLogGroup } from './numa-log-group';

// ─── Vault Secrets Construct ──────────────────────────────────────────────────
// Wires the vault-secrets Python Lambda into API Gateway behind the authorizer.
// The Lambda handles its own internal routing via _route(), so a single
// ANY vault/{proxy+} route is sufficient.

export interface VaultSecretsConstructProps extends ApiGatewayLambdaCollectionProps {
  region: string;
  vaultAuditLogTableName: string;
  vaultAuditLogTableArn: string;
}

export class VaultSecretsConstruct extends ApiGatewayLambdaCollection {
  protected logGroup: CloudwatchLogGroup;

  constructor(scope: Construct, name: string, props: VaultSecretsConstructProps) {
    super(scope, name, props);

    const clientName = props.clientName;

    this.logGroup = new NumaLogGroup(this, 'vault-log-group', {
      logGroupName: `${clientName}-vault-secrets`,
    }).logGroup;

    this.addLambdaFunction(this, 'vault-secrets-api', {
      addAuthorizer: true,
      lambdaDirectory: 'python/vault-secrets',
      runtime: 'python3.13',
      handler: 'lambda_function.handler',
      memorySize: 256,
      timeout: 29,
      environment: {
        CLIENT_NAME: clientName,
        VAULT_AUDIT_LOG_TABLE_NAME: props.vaultAuditLogTableName,
        OTEL_METRICS_EXPORTER: 'none',
      },
      additionalPolicyStatements: [
        // Secrets Manager — per-user and company secrets
        {
          effect: 'Allow',
          actions: [
            'secretsmanager:GetSecretValue',
            'secretsmanager:PutSecretValue',
            'secretsmanager:CreateSecret',
            'secretsmanager:UpdateSecret',
            'secretsmanager:DeleteSecret',
            'secretsmanager:DescribeSecret',
          ],
          resources: [
            `arn:aws:secretsmanager:*:*:secret:${clientName}/vault/users/*`,
            `arn:aws:secretsmanager:*:*:secret:${clientName}/vault/company*`,
          ],
        },
        // DynamoDB — audit log writes and queries
        {
          effect: 'Allow',
          actions: ['dynamodb:PutItem', 'dynamodb:Query'],
          resources: [props.vaultAuditLogTableArn],
        },
      ],
      route: [{ verb: 'ANY', path: 'vault/{proxy+}' }],
    });
  }
}

import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { Construct } from 'constructs';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { NumaLogGroup } from './numa-log-group';

// ─── Search Construct ───────────────────────────────────────────────────────────
// Foundational infrastructure for site-wide search. Creates a DynamoDB search
// index table (with a GSI for cross-type queries ordered by recency) and an
// API Lambda exposing `GET /api/search?q=&type=`.
//
// Index population is handled by producer services (ops, agents, apps, CRM,
// etc.) in follow-up work — this construct provisions only the query surface.
// Gated behind the `siteWideSearch` feature flag in the client stack.

export interface SearchConstructProps extends ApiGatewayLambdaCollectionProps {
  environmentName: string;
}

export class SearchConstruct extends ApiGatewayLambdaCollection {
  protected logGroup: CloudwatchLogGroup;

  public readonly searchIndexTable: DynamodbTable;

  constructor(scope: Construct, name: string, props: SearchConstructProps) {
    super(scope, name, props);

    const clientName = props.clientName;

    this.logGroup = new NumaLogGroup(this, 'search-log-group', {
      logGroupName: `${clientName}-search`,
    }).logGroup;

    // ── DynamoDB Search Index Table ────────────────────────────────────────
    //
    // Record shape:
    //   PK             `TYPE#{type}`           — partition per entity type
    //   SK             `ENTITY#{entityId}`
    //   GSI1PK         `ALL`                   — single partition for cross-type
    //                                             queries (hot; acceptable for
    //                                             MVP — revisit with a sharded
    //                                             partition or OpenSearch later)
    //   GSI1SK         `{updatedAt}#{entityId}` — sort by recency
    //   type           'ticket' | 'customer' | 'supplier' | 'project' | ...
    //   entityId       stable id within the producer system
    //   title          primary display string
    //   subtitle       optional secondary line
    //   searchableText lowercased concatenation of searchable fields
    //   userId         optional — if set, only visible to that user
    //   updatedAt      ISO-8601 timestamp
    //   navigateTo     frontend route to deep-link to the entity

    this.searchIndexTable = new DynamodbTable(this, 'search-index-table', {
      name: `${clientName}-search-index`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'PK',
      rangeKey: 'SK',
      attribute: [
        { name: 'PK', type: 'S' },
        { name: 'SK', type: 'S' },
        { name: 'GSI1PK', type: 'S' },
        { name: 'GSI1SK', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'GSI1',
          hashKey: 'GSI1PK',
          rangeKey: 'GSI1SK',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: { enabled: true },
      tags: {
        Name: `${clientName}-search-index`,
        Environment: props.environmentName,
        Purpose: 'numa-search-index',
      },
    });

    // ── Search API Lambda ──────────────────────────────────────────────────
    this.addLambdaFunction(this, 'search-api', {
      addAuthorizer: true,
      lambdaDirectory: 'node/numa-search-api',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      memorySize: 512,
      environment: {
        CLIENT_NAME: clientName,
        SEARCH_INDEX_TABLE: this.searchIndexTable.name,
        OTEL_METRICS_EXPORTER: 'none',
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:Query', 'dynamodb:GetItem'],
          resources: [this.searchIndexTable.arn, `${this.searchIndexTable.arn}/index/*`],
        },
      ],
      route: [{ verb: 'GET', path: 'search' }],
    });
  }
}

import { Construct } from 'constructs';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  DROPDOWN_TABLE_TASK,
  HTTP_REQUEST_TASK,
} from './base-numa-app-construct';

const description = 'Automate cost calculations for custom shapes (pre-meshed, plastered, or poly-only)';

export class CostingCalculator extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'costing-calculator', enableJobs: true });

    this.manifest = {
      appName: 'Costing Calculator',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.FINANCE,
      createdDate: '2025-04-01',
      appDescription: description,
      tags: ['costing', 'calculator', 'shapes', 'finance', '3d-shapes'],
      tasks: [
        {
          id: 'specifications',
          title: 'Specifications',
          description: 'Enter all parameters for calculating the shape cost',
          type: DROPDOWN_TABLE_TASK,
          required: true,
          order: 1,
          params: {
            fields: [
              {
                id: 'costing_model',
                label: 'Costing Model',
                type: 'dropdown' as const,
                options: ['decrashape', '3d-2d-poly'],
                defaultValue: 'decrashape',
                description: 'DecraShape includes mesh and plaster; 3D-2D-Poly is for poly-only (no mesh/plaster)',
                required: true,
              },
              {
                id: 'width',
                label: 'Width (mm)',
                type: 'number' as const,
                placeholder: 'Enter width in mm',
                required: true,
                validation: { min: 1, max: 10000 },
              },
              {
                id: 'length',
                label: 'Length (mm)',
                type: 'number' as const,
                placeholder: 'Enter length in mm',
                required: true,
                validation: { min: 1, max: 10000 },
              },
              {
                id: 'poly_type',
                label: 'Material Type',
                type: 'dropdown' as const,
                options: ['ACCA', 'ACCB', 'ACCC', 'ACCD', 'ACCE', 'ACCF'],
                description: 'Material type from standard (ACCA) to premium (ACCF)',
                required: true,
                defaultValue: 'ACCA',
              },
              {
                id: 'complexity',
                label: 'Complexity',
                type: 'dropdown' as const,
                options: ['S', 'H', 'VH'],
                required: true,
                defaultValue: 'S',
                description: 'S=Standard, H=High, VH=Very High',
              },
              {
                id: 'mesh_type',
                label: 'Mesh Type',
                type: 'dropdown' as const,
                options: ['standard', 'premium'],
                description: 'Type of mesh to use (Only needed for DecraShape model)',
                required: false,
                defaultValue: 'standard',
              },
              {
                id: 'profit_margin',
                label: 'Profit Margin',
                type: 'number' as const,
                placeholder: 'E.g. 1.15 for 15% margin',
                description: 'Multiplier for profit margin (default is 1.15)',
                required: false,
                defaultValue: '1.15',
                validation: { min: 1, max: 2 },
              },
            ],
          },
        },
        {
          id: 'call-step-function',
          title: 'Calculate Costs',
          type: HTTP_REQUEST_TASK,
          endpoint: 'costing-calculator',
          params: {
            payload: {
              specifications: '@specifications',
            },
          },
          order: 2,
        },
      ],
    };

    const costingCalculatorLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
      },
      {
        actions: ['bedrock:InvokeModel'],
        effect: 'Allow',
        resources: ['arn:aws:bedrock:*::foundation-model/*', 'arn:aws:bedrock:*:*:inference-profile/*'],
      },
    ];

    const costingCalculatorLambda = this.addLambdaFunction(this, 'calculate', {
      additionalPolicyStatements: costingCalculatorLambdaPolicyStatements,
      environment: {
        BUCKET: props.outputsBucket.bucket,
      },
      lambdaDirectory: 'python/costing-calculator',
      timeout: 300,
    });

    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: this.writeProcessingStatus(),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'job_id.$': '$.job_id',
            'specifications.$': '$.specifications',
          },
          Next: 'ProcessCostCalculation',
        },
        ProcessCostCalculation: this.addLambdaTask(
          costingCalculatorLambda.arn,
          {
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'specifications.$': '$.specifications',
            'output_key.$': `States.Format('${this.appId}/{}/costing-results.json', $$.Execution.Input.job_id)`,
          },
          'WriteSuccessStatus',
          {
            OutputPath: '$.Payload',
            Catch: [
              {
                // @ts-expect-error Type 'string[]' is not assignable to type 'string'
                ErrorEquals: ['States.ALL'],
                Next: 'WriteFailureStatus',
                ResultPath: '$.error',
              },
            ],
          },
        ),
        WriteFailureStatus: this.writeFailureStatus(),
        WriteSuccessStatus: this.writeSuccessStatus(),
        Success: {
          Type: 'Succeed',
        },
        Failure: {
          Type: 'Fail',
        },
      },
    };

    this.addStepFunction(this, 'main', {
      outputsBucket: props.outputsBucket,
      additionalPolicyStatements: [
        {
          actions: ['lambda:InvokeFunction'],
          effect: 'Allow',
          resources: [costingCalculatorLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          effect: 'Allow',
          resources: [costingCalculatorLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}

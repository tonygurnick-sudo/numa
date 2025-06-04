import { CloudcontrolapiResource } from '@cdktf/provider-aws/lib/cloudcontrolapi-resource';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import { z } from 'zod';
import { SetCallbackUrl } from './set-callback-url-construct';

export const webExperiencePropsSchema = z.object({
  clientName: z.string(),
  environmentName: z.string(),
  domainName: z.string(),
  region: z.string(),
  applicationId: z.string(),
  applicationArn: z.string(),
  userPoolId: z.string(),
  userPoolClientId: z.string(),
  enableIFrame: z.boolean().optional(),
  webexIdentityConfig: z.any(),
  qBusinessProvider: z.any().optional(),
  qBusinessApplicationArn: z.string().optional(),
});

export type WebExperienceProps = z.infer<typeof webExperiencePropsSchema>;

export class WebExperienceConstruct extends Construct {
  readonly webExUrl: string;
  readonly webExperienceRoleArn: string;

  constructor(scope: Construct, name: string, props: WebExperienceProps) {
    super(scope, name);

    const callerId = new DataAwsCallerIdentity(this, 'caller-id', {});
    const numaClient = `numa-${props.clientName}${props.environmentName !== 'prod' ? `-${props.environmentName}` : ''}`;

    // Create web experience trust document
    const webExArn = `arn:aws:iam::${callerId.accountId}:oidc-provider/cognito-idp.${props.region}.amazonaws.com/${props.userPoolId}`;

    const webExperienceTrustDocument = new DataAwsIamPolicyDocument(this, 'webex-policy-trust-doc', {
      statement: [
        {
          actions: ['sts:AssumeRoleWithWebIdentity'],
          principals: [
            {
              type: 'Federated',
              identifiers: [webExArn],
            },
          ],
        },
        {
          actions: ['sts:TagSession'],
          principals: [
            {
              type: 'Federated',
              identifiers: [webExArn],
            },
          ],
          condition: [
            {
              test: 'StringLike',
              values: ['*'],
              variable: 'aws:RequestTag/Email',
            },
            {
              test: 'ForAllValues:StringEquals',
              values: ['Email'],
              variable: 'sts:TransitiveTagKeys',
            },
          ],
        },
      ],
    });

    // Create web experience role
    const role = new IamRole(this, 'web-experience-role', {
      name: `web-experience-role-${numaClient}`,
      assumeRolePolicy: webExperienceTrustDocument.json,
    });

    this.webExperienceRoleArn = role.arn;

    // Create web experience role policy
    // This is based on the default policy for the web experience role.
    // https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/web-experience-iam-role-iam.html
    const webExperienceRolePolicyDocument = new DataAwsIamPolicyDocument(this, 'web-experience-permission-policy-doc', {
      version: '2012-10-17',
      statement: [
        // QBusiness permissions
        {
          sid: 'QBusinessConversationPermission',
          effect: 'Allow',
          actions: [
            'qbusiness:Chat',
            'qbusiness:ChatSync',
            'qbusiness:ListMessages',
            'qbusiness:ListConversations',
            'qbusiness:DeleteConversation',
            'qbusiness:PutFeedback',
            'qbusiness:GetWebExperience',
            'qbusiness:GetApplication',
            'qbusiness:ListPlugins',
            'qbusiness:GetChatControlsConfiguration',
            'qbusiness:ListRetrievers',
            'qbusiness:ListPluginActions',
            'qbusiness:ListAttachments',
            'qbusiness:GetMedia',
            'qbusiness:DeleteAttachment',
          ],
          resources: [props.applicationArn],
        },
        {
          sid: 'QBusinessPluginDiscoveryPermissions',
          effect: 'Allow',
          actions: ['qbusiness:ListPluginTypeMetadata', 'qbusiness:ListPluginTypeActions'],
          resources: ['*'],
        },
        {
          sid: 'QBusinessAutoSubscriptionPermission',
          effect: 'Allow',
          actions: ['user-subscriptions:CreateClaim'],
          condition: [
            {
              test: 'Bool',
              variable: 'user-subscriptions:CreateForSelf',
              values: ['true'],
            },
            {
              test: 'StringEquals',
              variable: 'aws:CalledViaLast',
              values: ['qbusiness.amazonaws.com'],
            },
          ],
          resources: ['*'],
        },
        {
          sid: 'QBusinessRetrieverPermission',
          effect: 'Allow',
          actions: ['qbusiness:GetRetriever'],
          resources: [props.applicationArn, `${props.applicationArn}/retriever/*`],
        },
        {
          sid: 'QBusinessKMSDecryptPermissions',
          effect: 'Allow',
          actions: ['kms:Decrypt'],
          resources: [`arn:aws:kms:${props.region}:${callerId.accountId}:key/*`],
          condition: [
            {
              test: 'StringLike',
              variable: 'kms:ViaService',
              values: [`qbusiness.${props.region}.amazonaws.com`, `qapps.${props.region}.amazonaws.com`],
            },
          ],
        },
        // QApps permissions
        {
          sid: 'QAppsResourceAgnosticPermissions',
          effect: 'Allow',
          actions: [
            'qapps:CreateQApp',
            'qapps:PredictQApp',
            'qapps:PredictProblemStatementFromConversation',
            'qapps:PredictQAppFromProblemStatement',
            'qapps:ListQApps',
            'qapps:ListLibraryItems',
            'qapps:CreateSubscriptionToken',
          ],
          resources: [props.applicationArn],
        },
        {
          sid: 'QAppsAppUniversalPermissions',
          effect: 'Allow',
          actions: ['qapps:DisassociateQAppFromUser'],
          resources: [`arn:aws:qapps:${props.region}:${callerId.accountId}:application/${props.applicationId}/qapp/*`],
        },
        {
          sid: 'QAppsAppOwnerPermissions',
          effect: 'Allow',
          actions: [
            'qapps:GetQApp',
            'qapps:CopyQApp',
            'qapps:UpdateQApp',
            'qapps:DeleteQApp',
            'qapps:ImportDocument',
            'qapps:ImportDocumentToQApp',
            'qapps:CreateLibraryItem',
            'qapps:UpdateLibraryItem',
            'qapps:StartQAppSession',
          ],
          resources: [`arn:aws:qapps:${props.region}:${callerId.accountId}:application/${props.applicationId}/qapp/*`],
          condition: [
            {
              test: 'StringEqualsIgnoreCase',
              variable: 'qapps:UserIsAppOwner',
              values: ['true'],
            },
          ],
        },
        {
          sid: 'QAppsPublishedAppPermissions',
          effect: 'Allow',
          actions: [
            'qapps:GetQApp',
            'qapps:CopyQApp',
            'qapps:AssociateQAppWithUser',
            'qapps:GetLibraryItem',
            'qapps:CreateLibraryItemReview',
            'qapps:AssociateLibraryItemReview',
            'qapps:DisassociateLibraryItemReview',
            'qapps:StartQAppSession',
          ],
          resources: [`arn:aws:qapps:${props.region}:${callerId.accountId}:application/${props.applicationId}/qapp/*`],
          condition: [
            {
              test: 'StringEqualsIgnoreCase',
              variable: 'qapps:AppIsPublished',
              values: ['true'],
            },
          ],
        },
        {
          sid: 'QAppsAppSessionModeratorPermissions',
          effect: 'Allow',
          actions: [
            'qapps:ImportDocument',
            'qapps:ImportDocumentToQAppSession',
            'qapps:GetQAppSession',
            'qapps:GetQAppSessionMetadata',
            'qapps:UpdateQAppSession',
            'qapps:UpdateQAppSessionMetadata',
            'qapps:StopQAppSession',
          ],
          resources: [
            `arn:aws:qapps:${props.region}:${callerId.accountId}:application/${props.applicationId}/qapp/*/session/*`,
          ],
          condition: [
            {
              test: 'StringEqualsIgnoreCase',
              variable: 'qapps:UserIsSessionModerator',
              values: ['true'],
            },
          ],
        },
        {
          sid: 'QAppsSharedAppSessionPermissions',
          effect: 'Allow',
          actions: [
            'qapps:ImportDocument',
            'qapps:ImportDocumentToQAppSession',
            'qapps:GetQAppSession',
            'qapps:GetQAppSessionMetadata',
            'qapps:UpdateQAppSession',
          ],
          resources: [
            `arn:aws:qapps:${props.region}:${callerId.accountId}:application/${props.applicationId}/qapp/*/session/*`,
          ],
          condition: [
            {
              test: 'StringEqualsIgnoreCase',
              variable: 'qapps:SessionIsShared',
              values: ['true'],
            },
          ],
        },
      ],
    });

    new IamRolePolicy(this, 'web-experience-policy', {
      name: 'policy',
      role: role.name,
      policy: webExperienceRolePolicyDocument.json,
    });

    // Configure origins for iFrame support if enabled
    const origins = props.enableIFrame
      ? {
          Origins: [`https://${props.domainName}`],
        }
      : {};

    // Create web experience
    const webexperience = new CloudcontrolapiResource(this, 'web-experience', {
      typeName: 'AWS::QBusiness::WebExperience',
      desiredState: Fn.jsonencode({
        ApplicationId: props.applicationId,
        RoleArn: role.arn,
        ...props.webexIdentityConfig,
        ...origins,
      }),
      provider: props.qBusinessProvider,
    });

    this.webExUrl = Fn.lookup(Fn.jsondecode(webexperience.properties), 'DefaultEndpoint');

    // Set callback URL for authentication
    new SetCallbackUrl(this, 'callback', {
      callbackAddress: this.webExUrl + 'authorization-code/callback',
      userPoolClientId: props.userPoolClientId,
      userPoolId: props.userPoolId,
      region: props.region,
    });
  }
}

export function generatePolicy({ Region, AccountId, ApplicationId }) {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'qbusiness:Chat*',
          'qbusiness:List*',
          'qbusiness:DeleteConversation',
          'qbusiness:PutFeedback',
          'qbusiness:StartDataSourceSyncJob',
          'qapps:*',
          'qbusiness:Get*',
        ],
        Resource: [
          `arn:aws:qbusiness:${Region}:${AccountId}:application/${ApplicationId}`,
          `arn:aws:qbusiness:${Region}:${AccountId}:application/${ApplicationId}/index/*`,
          `arn:aws:qbusiness:${Region}:${AccountId}:application/${ApplicationId}/retriever/*`,
        ],
      },
      {
        Effect: 'Allow',
        Action: ['kms:Decrypt'],
        Resource: ['*'],
        Condition: {
          StringLike: {
            'aws:InvokedBy': ['qbusiness.amazonaws.com', 'qapps.amazonaws.com'],
          },
        },
      },
      {
        Effect: 'Allow',
        Action: ['qapps:*'],
        Resource: [
          `arn:aws:qbusiness:${Region}:${AccountId}:application/${ApplicationId}`,
          `arn:aws:qapps:${Region}:${AccountId}:application/${ApplicationId}/qapp/*`,
        ],
      },
      {
        Effect: 'Allow',
        Action: ['user-subscriptions:CreateClaim', 'user-subscriptions:CreateUserClaim'],
        Resource: ['*'],
      },
    ],
  };
}

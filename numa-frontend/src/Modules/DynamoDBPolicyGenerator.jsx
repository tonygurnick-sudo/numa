export function generateDynamoDBPolicy({ Region, AccountId, NumaChatHistoryTableName}) {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'dynamodb:Query',
          'dynamodb:PutItem',
          'dynamodb:Scan',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
        ],
        Resource: [
          `arn:aws:dynamodb:${Region}:${AccountId}:table/${NumaChatHistoryTableName}`,
        ],
      },
    ],
  };
}

export function generateBedrockPolicy({ Region, AccountId }) {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        Resource: [
          `arn:aws:bedrock:${Region}::foundation-model/*`,
        ],
      },
    ],
  };
}

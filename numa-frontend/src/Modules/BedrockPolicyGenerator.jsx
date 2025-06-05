export function generateBedrockPolicy() {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        Resource: [`arn:aws:bedrock:*::foundation-model/*`, 'arn:aws:bedrock:*:*:inference-profile/*'], // All all regions as it routes to multiple us regions cross region (can't just use us-east-1)
      },
    ],
  };
}

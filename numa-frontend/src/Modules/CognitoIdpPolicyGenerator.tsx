export function generateCognitoIdpPolicy({ Region, AccountId, UserPoolId }) {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['cognito-idp:ListUsers', 'cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword'],
        Resource: [`arn:aws:cognito-idp:${Region}:${AccountId}:userpool/${UserPoolId}`],
      },
    ],
  };
}

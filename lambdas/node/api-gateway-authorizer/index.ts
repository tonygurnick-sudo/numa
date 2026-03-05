import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayRequestSimpleAuthorizerHandlerV2 } from 'aws-lambda';

const CLOUDFRONT_SECRET = process.env.CLOUDFRONT_SECRET ?? '';

const USER_POOL_CLIENT_ID = process.env.COGNITO_USER_POOL_CLIENT_ID ?? '';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';

const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'access',
  clientId: USER_POOL_CLIENT_ID,
  includeRawJwtInErrors: true,
});

export const handler: APIGatewayRequestSimpleAuthorizerHandlerV2 = async (event) => {
  console.info('Event received:', JSON.stringify(event, null, 2));

  if (!event.headers) {
    console.error('Headers are missing');
    return { isAuthorized: false };
  }

  const cloudfrontSecret = event.headers['x-arcanum-cloudfront-secret'];
  if (!cloudfrontSecret) {
    console.error('Cloudfront secret header is missing');
    return { isAuthorized: false };
  }
  if (cloudfrontSecret !== CLOUDFRONT_SECRET) {
    console.error('Cloudfront secret header does not match');
    return { isAuthorized: false };
  }

  const jwt = event.headers['authorization'];
  if (!jwt) {
    console.error('Authorization header is missing');
    return { isAuthorized: false };
  }

  // Strip "Bearer " prefix if present
  const cleanJwt = jwt.startsWith('Bearer ') ? jwt.slice(7) : jwt;

  try {
    const payload = await verifier.verify(cleanJwt);
    console.info('JWT is valid');
    return {
      isAuthorized: true,
      context: {
        jwt: JSON.stringify({
          claims: {
            sub: payload.sub,
            'cognito:groups': (payload as Record<string, unknown>)['cognito:groups'] ?? '',
            username: (payload as Record<string, unknown>).username ?? '',
          },
        }),
      },
    };
  } catch (err) {
    console.error('JWT verification failed:', err);
    return { isAuthorized: false };
  }
};

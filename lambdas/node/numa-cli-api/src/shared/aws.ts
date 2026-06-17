/**
 * AWS SDK clients — singletons. AWS SDK v3 clients are heavy to construct
 * (HTTPS agent, credential provider chain, signing prep), so we hold one of
 * each at module scope. Lambdas reuse modules across warm invocations, so
 * subsequent requests get instant client access.
 */

import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';

import { REGION } from './config.js';

export const cognito = new CognitoIdentityProviderClient({ region: REGION });
export const lambdaClient = new LambdaClient({ region: REGION });
export const s3 = new S3Client({ region: REGION });

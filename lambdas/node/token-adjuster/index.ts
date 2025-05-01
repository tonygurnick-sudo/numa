import { PreTokenGenerationV2TriggerHandler } from 'aws-lambda';

export const handler: PreTokenGenerationV2TriggerHandler = async function (event) {
  console.log(event);
  const email = event.request.userAttributes.email;
  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {
        claimsToAddOrOverride: {
          // @ts-expect-error: Library has incorrect typing.
          'https://aws.amazon.com/tags': {
            principal_tags: { Email: [email] },
          },
        },
      },
    },
  };
  console.log(JSON.stringify(event));
  return event;
};

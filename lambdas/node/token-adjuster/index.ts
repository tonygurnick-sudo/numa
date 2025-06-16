import { PreTokenGenerationV2TriggerHandler } from 'aws-lambda';

export const handler: PreTokenGenerationV2TriggerHandler = async function (event) {
  console.log(event);
  const { groupsToOverride } = event.request.groupConfiguration;

  const email = event.request.userAttributes.email;
  const groups = groupsToOverride && groupsToOverride.length > 0 ? groupsToOverride : ['standard'];

  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {
        claimsToAddOrOverride: {
          // @ts-expect-error: Library has incorrect typing.
          'https://aws.amazon.com/tags': {
            principal_tags: {
              Email: [email],
              username: [event.request.userAttributes.sub],
              aud: [event.callerContext.clientId],
              Groups: groups,
            },
          },
        },
      },
    },
  };
  console.log(JSON.stringify(event));
  return event;
};

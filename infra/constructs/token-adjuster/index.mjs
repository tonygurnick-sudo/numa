export async function handler(event, _context) {
  console.log(event);
  const email = event.request.userAttributes.email;
  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {
        claimsToAddOrOverride: {
          'https://aws.amazon.com/tags': {
            principal_tags: { Email: [email] },
          },
        },
      },
    },
  };
  console.log(JSON.stringify(event));
  return event;
}

# client-config

This library provides functionality for interacting with client configs.

## Storage locations

There are two locations that client configs can be stored:

- DynamoDB in our deployer account.
- clientConfigProd.json file in this repo.

## Functions

### listClients

Returns a combined list of `clientName`s as strings from the storage locations.

### getClientConfig

This takes a `clientName` and optionally a zod schema.

The client config for the specified `clientName` is returned from the client stores. Preference is given to the clientConfigProd.json file over the DynamoDB table.

If a zod schema is specified the retrieved config is checked against it and an error is thrown if they don't match.

### putClientConfig

This takes a `clientName`, a client config and optionally a zod schema.

The provided client config for the specified `clientName` is written to the DynamoDB table.

If a zod schema is specified the provided config is checked against it and an error is thrown if they don't match.

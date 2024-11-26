# Infra

The infrastructure for this project is written using CDKTF. Deployments are done via GitLab (TODO).

## Infra layout

As with all CDKTF infracode, this project consists of three main parts:

- App: The top-level grouping of all the associated parts of the infrastructure.
- Stacks: Groupings of resources that need to be deployed together.
- Constructs: Reusable components consisting of a single resource (or tightly coupled group of resources).

The App for this project is defined in main.ts, while the stacks and constructs are in the stacks and constructs directories, or imported from other projects.

## Installation

### Dependencies

This project uses yarn 4 as the package manager and requires node >= 20.

To install the dependencies run:

```bash
yarn install
```

If you receive error messages about dependencies not being found, see [the setup instructions for yarn >= 2](https://gitlab.com/arcanumai/cdktf-resources/-/blob/main/README.md#accessing-the-packages).

### AWS Profiles

The deploy script for this project requires you to have access to the arcanum-q-deployer accounts and expects their profiles in your .aws/config file to be named `arcanum-q-deployer-dev` and `arcanum-q-deployer-prod`.

## Usage

Usage of this project is facilitated via the `yarn cdktf` helper script. This requires a `TF_ENVIRONMENT` variable to be set. For all development, this should be set to `dev`.

---

**Note**

Some stack require the lambdas to be build, a quick way of doing that is (from
the infra directory):

```bash
for directory in ../lambdas/*/; do
pushd $directory;
poetry build-lambda;
popd;
done;
```

---

The main command to give to `yarn cdktf` is `plan`. This will produce a plan of the changes that the infracode will make to the infrastructure.

```bash
export TF_ENVIRONMENT=dev # Only need to do this once per shell.
export AWS_REGION=us-east-1
yarn cdktf plan
```

`plan` will need to be followed by the identifier of the stack to plan if there is more than one stack defined, however a maximum of one stack can be supplied at a time.

```bash
yarn cdktf plan q-apps-deployer
```

### Deploying stacks to customer accounts

Customer accounts grant access to our production deployer account.

To run the deploy of Numa to a customer account, do the following:

```bash
export TF_ENVIRONMENT=prod # All customer deployments are prod.
export AWS_REGION=us-east-1 # Important: These stacks can only be deployed in us-east-1.
yarn cdktf deploy --auto-approve numa-{client-id}
```

The client-id must be the name of an entry from the clientsProd list in numa-client-stack.ts.

## Development

Linting can be run with `yarn lint`. This will run eslint and then tsc for type checking.

Tests (TODO) can be run with `yarn test`.

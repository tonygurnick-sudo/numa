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

Some stacks require the lambdas to be build, a quick way of doing that on Linux
is (from the infra directory):

```bash
for directory in ../lambdas/*/; do
pushd $directory;
[ -f pyproject.toml ] && poetry build-lambda;
[ -f package.json ] && yarn && yarn bundle;
popd;
done;
```

On Mac it's a little more complicated:

```bash
rm -rf build_venv
python3.12 -m venv build_venv
source build_venv/bin/activate

for directory in ../lambdas/*/; do
    case $directory in
        *srp-proxy*) continue;;
    esac
    pushd $directory;
        rm -rf lambda_function.build;
        rm -f lambda_function.zip;
        pip install \
            --quiet \
            --disable-pip-version-check \
            --platform manylinux2014_x86_64 \
            --target=lambda_function.build \
            --python-version 3.12 \
            --only-binary=:all: \
            .
        pushd lambda_function.build;
            zip --quiet --recurse-paths ../lambda_function.zip *
        popd
        rm -rf lambda_function.build;
    popd;
done;

deactivate
rm -rf build_venv
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

## Web Crawler Configuration

The Numa infrastructure supports two methods for configuring web crawlers:

1. Direct URL Crawling
   The simplest method is to specify URLs directly in the client configuration:

"webCrawlerConfigs": [
{
"url": "https://example.com"
}
]

2. Sitemap-based Crawling
   For more comprehensive crawling, you can use XML sitemaps.

Download the client's sitemap and save it in the client-sitemaps directory
Configure the crawler to use this sitemap in the client configuration:

"webCrawlerConfigs": [
{
"siteMapFiles": [
["client-sitemaps", "client-name-sitemap.xml"]
]
}
]

Important Notes:

1. Before deploying: You must manually download and place the sitemap file in the client-sitemaps directory
2. The sitemap path is relative to the project root
3. You can combine both URL-based and sitemap-based configurations for the same client
4. Sitemaps must be in valid XML format

## Index Configuration

Amazon Q Business requires an index to be configured for each application. There are two types of indexes available:

### Index Types
- **STARTER**: Default index type
  - Supports up to 5 units
  - Each unit provides capacity for 20,000 documents or 200 MB (whichever is reached first)

- **ENTERPRISE**: Advanced index type
  - Supports up to 50 units
  - Each unit provides capacity for 20,000 documents or 200 MB (whichever is reached first)

### Configuration

Index configuration can be specified in the client config JSON files (`clientConfigDev.json` and `clientConfigProd.json`):

```json
{
  "clientname": {
    "indexType": "ENTERPRISE",  // Optional. Defaults to "STARTER" if not specified
    "indexUnits": 5,           // Optional. Defaults to 1 if not specified
    // ... other configurations
  }
}

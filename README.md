# NUMA PoC

The `arcanum-ai-initial-setup.yaml` Cloudformation template sets up the role
needed for initial setup, currently with admin permission so we don't have to
ask customers to repeatedly update the stack. It's stored in the
`arcanum-numa-templates` bucket. We can share [this
link](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=https://arcanum-numa-templates.s3.amazonaws.com/arcanum-ai-initial-setup.yaml&stackName=ArcanaumAiInitialSetup)
with them for easy setup.

For testing there is `arcanum-ai-initial-setup-dev.yaml` (stored in
`arcanum-numa-templates-dev`) which points to the Q Deployer Dev account.
[This](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=https://arcanum-numa-templates-dev.s3.amazonaws.com/arcanum-ai-initial-setup-dev.yaml&stackName=ArcanaumAiInitialSetup)
is the testing link.

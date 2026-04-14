#!/usr/bin/env python3
"""Helper for easier access to client accounts in the AWS Console.

Generates html with links to assume our admin role.

Access to the deployer account through Identity Center
(https://arcanum.awsapps.com/start/) is required before assuming the role in
the client account.

Usage:

```bash
./generate_assume_role_links_html.py > accounts.html

```
"""

import json

HTML = """
<!DOCTYPE html>
<html>
    <head>
        <meta charset="UTF-8">
        <title></title>
    </head>
    <body>
        <ol>
            {list_items}
        </ol>
    </body>
</html>
"""


def main():
    with open("clientConfigProd.json", "rb") as config_file:
        config = json.load(config_file)
    clients = {
        client_name: client_config["clientAccountId"]
        for client_name, client_config in config.items()
    }
    urls = {
        client_name: f"https://signin.aws.amazon.com/switchrole?roleName=ArcanumAIAccess&account={account_id}&displayName={client_name}&color=f2b0a9"
        for client_name, account_id in clients.items()
    }
    links = [f'<a href="{url}">{client_name}</a>' for client_name, url in urls.items()]
    print(HTML.format(list_items=f"<li>{'</li><li>'.join(links)}</li>"))


if __name__ == "__main__":
    main()

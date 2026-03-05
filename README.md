# Numa

This is the repo for the Numa project.

The main directories of note are:

## numa-frontend

Frontend code.

## infra

CDKTF infrastructure code.

## lambdas

Lambda functions that make up the backend of the app.

### lambdas/python

Lambdas written in python.

### lambdas/node

Lambdas written in TypeScript.

## tools

Tools for maintenance and support of the running apps.

## style

Combined style and linting configuration for the JS and TS parts of the project.

## Git Workflow

### Setup (one-time after cloning)

Enable the repo git hooks:

```bash
git config core.hooksPath .githooks
```

This enables warnings when checking out or branching from `main` instead of `dev`.

### Branches

| Branch | Purpose                                                  | Deploy                                                      |
| ------ | -------------------------------------------------------- | ----------------------------------------------------------- |
| `dev`  | Integration branch. Feature branches merge here via MR.  | Optional deploy to `arcanum-demo` via manual pipeline gate. |
| `main` | Production release branch. `dev` merges here when ready. | Full pipeline: package, build, deploy to all customers.     |

### Day-to-day workflow

1. **Start a feature:** branch from `dev`
   ```bash
   git checkout dev && git pull origin dev && git checkout -b feat/your-feature
   ```
2. **Open an MR** targeting `dev` (this is the default target)
3. **Merge to `dev`** — a blocked pipeline appears with a manual "Deploy to demo" button. Click it to deploy to `arcanum-demo` for testing, or leave it.
4. **Release:** create an MR from `dev` to `main`. Merging triggers the full pipeline (package, build, deploy).

### Hotfixes

For urgent production fixes, branch from `main` and MR directly to `main`. After the hotfix deploys, merge `main` back into `dev` to stay aligned:

```bash
git checkout dev && git pull origin dev && git merge origin/main && git push origin dev
```

SHELL := /bin/bash

# ---- AWS + CDKTF ----
export HOME := /Users/arcanum
export AWS_PROFILE := default
export AWS_REGION := us-east-1
export AWS_SDK_LOAD_CONFIG := 1

export TF_ENVIRONMENT := prod
export TF_PLUGIN_CACHE_DIR := $(HOME)/.terraform.d/plugin-cache

# ---------- Terraform ----------
export TF_INPUT := 0
export TF_LOG := TRACE
export TF_LOG_PROVIDER := TRACE
export TF_LOG_SDK_FRAMEWORK := 1
export TF_LOG_PATH := $(PWD)/tf-debug.log

# ---------- CDKTF / Node / App ----------
export CDKTF_LOG_LEVEL := debug
# merge both usages
export NODE_OPTIONS := --max-old-space-size=4096 --trace-deprecation
export CLIENT_OVERRIDE := arcanum-demo-tony
export HONEYCOMB_KEY_SECRET := 56sdgz9z60ah0jfrvezhc0q1n61h8vyg
export HONEYCOMB_KEY_ID := hcamk_01jp5y4xp1z77ed2p3sj7jn2dx

CDKTF := yarn --cwd infra dlx cdktf-cli
STACK := numa-arcanum-demo-tony
SYSTEM_USER_FUNCTION_RESOURCE := aws_lambda_function.numa_system-user_function_38BDAEEC
SYSTEM_USER_FUNCTION_NAME := system-user-creator---TfToken-TOKEN-81--

.PHONY: init get plan import deploy clean pipelinefix cli
.DEFAULT_GOAL := deploy

init:
	mkdir -p "$(TF_PLUGIN_CACHE_DIR)"
	yarn --cwd infra

get:
	$(CDKTF) get

plan:
	$(CDKTF) diff $(STACK)

import: init get
	@if $(CDKTF) terraform state list $(STACK) | rg -q --fixed-strings "$(SYSTEM_USER_FUNCTION_RESOURCE)"; then \
		echo "Lambda function already imported into state"; \
	else \
		$(CDKTF) terraform import "$(STACK).$(SYSTEM_USER_FUNCTION_RESOURCE)" "$(SYSTEM_USER_FUNCTION_NAME)"; \
	fi

deploy: init get
	lambdas/package-all.sh
	yarn --cwd numa-frontend build
	$(CDKTF) deploy $(STACK) --auto-approve

clean:
	rm -rf cdktf.out .gen tf-debug.log "$(TF_PLUGIN_CACHE_DIR)" || true

# ---- Pre-commit Pipeline Fix ----
pipelinefix:
	@echo "🔧 Setting up pre-commit hooks to fix pipeline failures..."
	@echo ""

	# Check if pre-commit is installed, if not install it
	@if ! command -v pre-commit >/dev/null 2>&1; then \
		echo "📦 Installing pre-commit..."; \
		if command -v pipx >/dev/null 2>&1; then \
			pipx install pre-commit; \
		elif command -v pip3 >/dev/null 2>&1; then \
			pip3 install --user pre-commit; \
		elif command -v pip >/dev/null 2>&1; then \
			pip install --user pre-commit; \
		else \
			echo "❌ Could not find pip or pipx. Please install pre-commit manually:"; \
			echo "   brew install pre-commit  # or"; \
			echo "   pip install pre-commit"; \
			exit 1; \
		fi; \
	else \
		echo "✅ pre-commit already installed"; \
	fi

	# Install the pre-commit hooks
	@echo "🪝 Installing pre-commit hooks..."
	@pre-commit install
	@pre-commit install --hook-type commit-msg

	# Run pre-commit on all files to fix any current issues
	@echo "🧹 Running pre-commit on all files to fix formatting..."
	@echo "   This may take a moment on first run..."
	@if pre-commit run --all-files; then \
		echo ""; \
		echo "✅ All pre-commit checks passed!"; \
	else \
		echo ""; \
		echo "🔄 Some files were reformatted. Running again to verify..."; \
		pre-commit run --all-files; \
		echo ""; \
		echo "✅ All formatting issues fixed!"; \
	fi

	@echo ""
	@echo "🎉 Setup complete! Your repository is now ready for clean commits."
	@echo ""
	@echo "📝 Usage:"
	@echo "   • Hooks will run automatically on 'git commit'"
	@echo "   • Run 'pre-commit run --all-files' to check all files"
	@echo "   • Run 'pre-commit run' to check only staged files"
	@echo "   • Use conventional commit format: feat:/fix:/docs: etc."
	@echo ""

# ---- CLI Installation ----
cli:
	@echo "🔧 Building and installing Numa CLI..."
	yarn --cwd numa-cli install
	yarn --cwd numa-cli build
	@echo "📦 Linking CLI globally..."
	cd numa-cli && npm link
	@echo ""
	@echo "✅ Numa CLI installed! You can now use:"
	@echo "   numa init                         - Initialize CLI"
	@echo "   numa env list                     - List environments"
	@echo "   numa env use <name>               - Switch environment"
	@echo "   numa env add <name> -c <client>   - Add environment"
	@echo "   numa login                        - Log in to Numa"
	@echo "   numa logout                       - Log out"
	@echo "   numa whoami                       - Show current user"
	@echo "   numa create shared doc <file>     - Create shared document"
	@echo ""
	@echo "Run 'numa --help' for more information."

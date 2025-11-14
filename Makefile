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

.PHONY: init get plan deploy clean
.DEFAULT_GOAL := deploy

init:
	mkdir -p "$(TF_PLUGIN_CACHE_DIR)"
	yarn --cwd infra

get:
	$(CDKTF) get

plan:
	$(CDKTF) diff $(STACK)

deploy: init get
	lambdas/package-all.sh
	yarn --cwd numa-frontend build
	$(CDKTF) deploy $(STACK) --auto-approve

clean:
	rm -rf cdktf.out .gen tf-debug.log "$(TF_PLUGIN_CACHE_DIR)" || true

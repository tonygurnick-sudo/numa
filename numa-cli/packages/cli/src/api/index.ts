/**
 * Public API surface for @numa/cli/api consumers (mainly @numa/cli-dev).
 *
 * The thin HTTP clients that talk to the numa-cli-api Lambda — bootstrap,
 * tool dispatch, integration doc fetcher. Everything in here is
 * authoritative; nothing else in cli should reach past these for network
 * I/O.
 */

export { invokeTool, type ToolInvokeRequest, type ToolInvokeResponse } from './tools.js';
export { fetchBootstrap } from './bootstrap.js';
export { fetchIntegrationDocs } from './integrations-docs.js';
export { apiCall } from './client.js';

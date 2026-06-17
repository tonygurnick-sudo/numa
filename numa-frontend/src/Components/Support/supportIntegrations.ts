/**
 * Integration slugs the Support agent is allowed to use — email only, so it
 * can send an escalation email to customer success on the user's behalf. Only
 * the user's CONNECTED ones are ever enabled (see applySupportConfiguration in
 * the chat page), so the agent offers to send only when it actually can.
 *
 * Mirrors `_EMAIL_INTEGRATION_SLUGS` in the workspace agent
 * (services/numa-workspace-agent/numa_workspace_agent/prompts.py).
 */
export const SUPPORT_EMAIL_INTEGRATION_SLUGS = new Set(['gmail', 'microsoft_outlook']);

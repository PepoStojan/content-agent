import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * Centralized Anthropic access. Per Architecture V1: one configurable
 * model for V1, never hardcoded per call site. Every generation stage
 * (Brief, Blueprint, Content, AI QA) must import getModelId() rather
 * than naming a model string itself, so the model can change from one
 * place (ANTHROPIC_MODEL / settings.ai_model_id) without touching
 * stage-specific code.
 *
 * Server-only: the API key must never reach the client bundle.
 */

let client: Anthropic | null = null;

export function getAnthropicClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * V1 uses a single org-wide model, sourced from env for now.
 * Once `settings` (organization-scoped) exists in the database, this
 * should read `settings.ai_model_id` instead — env var remains the
 * fallback/default.
 */
export function getModelId(): string {
  const model = process.env.ANTHROPIC_MODEL;
  if (!model) {
    throw new Error(
      "ANTHROPIC_MODEL is not configured. Set it in the environment before calling any generation stage."
    );
  }
  return model;
}

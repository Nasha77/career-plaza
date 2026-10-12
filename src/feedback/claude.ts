import type { FeedbackInput, FeedbackProvider, FeedbackResult } from './provider';

/**
 * Placeholder for a live Claude provider. Not used in this build.
 *
 * TODO: Implement once a small backend/proxy exists to hold the API key.
 * - NEVER put an API key in client code. The browser should call your own proxy
 *   endpoint, and the proxy calls the Claude API server-side.
 * - Send the scenario content, the student's choice, written response and twist,
 *   and ask the model to stay in character, react in 1-3 sentences, acknowledge the
 *   written response without grading it, and end with a reflective question
 *   (never a verdict, score or "correct answer").
 * - Keep `skills` from the content file so the growth record stays consistent.
 * - Fall back to ScriptedProvider on any error or timeout.
 */
export class ClaudeProvider implements FeedbackProvider {
  getFeedback(_input: FeedbackInput): Promise<FeedbackResult> {
    return Promise.reject(new Error('ClaudeProvider is not implemented in this build.'));
  }
}

import { fail } from '../utils/errors.js';

export function isAiConfigured() {
  return Boolean(process.env.AI_API_KEY);
}

export async function completeChat(messages, { json = false } = {}) {
  if (!isAiConfigured()) return null;
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  if (!['openai', 'openai-compatible'].includes(provider)) {
    throw fail(503, `Unsupported AI_PROVIDER "${provider}". Use openai or openai-compatible.`);
  }
  const base = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  let response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'gpt-4o-mini',
        messages,
        temperature: 0.2,
        ...(json ? { response_format: { type: 'json_object' } } : {})
      }),
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw fail(504, 'AI provider request timed out');
    throw fail(502, `Could not reach the AI provider: ${error.message}`);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw fail(502, `AI provider returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw fail(502, 'AI provider returned an empty response');
  return content.trim();
}

export function parseJsonResponse(content) {
  try {
    return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw fail(502, 'AI provider did not return valid JSON');
  }
}

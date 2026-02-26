// ─────────────────────────────────────────────────────────────
// NVIDIA NIM API CLIENT
// OpenAI-compatible. Supports streaming + tool calling.
// ─────────────────────────────────────────────────────────────

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

// Recommended models — choose based on your needs:
export const NIM_MODELS = {
  FAST: "meta/llama-3.1-8b-instruct", // Fastest, cheapest, good for simple tasks
  SMART: "meta/llama-3.3-70b-instruct", // Best balance of speed + intelligence ← RECOMMENDED
  LARGE: "meta/llama-4-maverick-17b-128e-instruct", // Multimodal, huge context
  CODER: "qwen/qwen2.5-coder-32b-instruct", // Best for code-heavy tasks
  REASON: "nvidia/llama-3.1-nemotron-70b-instruct", // Best for multi-step reasoning
};

/**
 * Call NVIDIA NIM with streaming support
 * @param {object} params
 * @param {string} params.apiKey         - Your nvapi-xxx key
 * @param {string} params.model          - Model ID from NIM_MODELS
 * @param {Array}  params.messages       - OpenAI-format message array
 * @param {Array}  params.tools          - Optional tool definitions
 * @param {string} params.systemPrompt   - Optional system prompt
 * @param {number} params.maxTokens      - Max output tokens (default: 1024)
 * @param {function} params.onChunk      - Called with each streamed text chunk
 * @returns {Promise<{text: string, tool_calls: Array, finish_reason: string}>}
 */
export async function callNIM({
  apiKey,
  model = NIM_MODELS.SMART,
  messages,
  tools = null,
  systemPrompt = null,
  maxTokens = 1024,
  temperature = 0.2,
  onChunk = null,
}) {
  if (!apiKey)
    throw new Error(
      "NVIDIA NIM API key not set. Please configure in extension settings.",
    );

  const body = {
    model,
    messages: systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages,
    max_tokens: maxTokens,
    temperature,
    stream: !!onChunk, // Only stream if callback provided
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: onChunk ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`NIM API error ${response.status}: ${errText}`);
  }

  // ── STREAMING MODE ──────────────────────────────────────────
  if (onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let tool_calls = [];
    let finish_reason = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const json = JSON.parse(data);
          const choice = json.choices?.[0];
          if (!choice) continue;

          finish_reason = choice.finish_reason || finish_reason;

          // Stream text delta
          const delta = choice.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk(delta);
          }

          // Accumulate tool call deltas
          if (choice.delta?.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              if (!tool_calls[tc.index]) {
                tool_calls[tc.index] = {
                  id: tc.id || `call_${tc.index}`,
                  type: "function",
                  function: { name: "", arguments: "" },
                };
              }
              if (tc.function?.name)
                tool_calls[tc.index].function.name += tc.function.name;
              if (tc.function?.arguments)
                tool_calls[tc.index].function.arguments +=
                  tc.function.arguments;
            }
          }
        } catch (e) {
          /* skip malformed chunks */
        }
      }
    }

    // Parse accumulated tool call arguments
    tool_calls = tool_calls.filter(Boolean).map((tc) => {
      try {
        tc.function.arguments = JSON.parse(tc.function.arguments);
      } catch (e) {
        tc.function.arguments = {};
      }
      return tc;
    });

    return { text: fullText, tool_calls, finish_reason };
  }

  // ── NON-STREAMING MODE ──────────────────────────────────────
  const json = await response.json();
  const choice = json.choices?.[0];
  const tool_calls = (choice?.message?.tool_calls || []).map((tc) => {
    try {
      tc.function.arguments = JSON.parse(tc.function.arguments);
    } catch (e) {
      tc.function.arguments = {};
    }
    return tc;
  });

  return {
    text: choice?.message?.content || "",
    tool_calls,
    finish_reason: choice?.finish_reason,
    usage: json.usage,
  };
}

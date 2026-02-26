// ─────────────────────────────────────────────────────────────
// BACKGROUND SERVICE WORKER — Orchestrator
// Runs the agent loop, calls NIM, dispatches actions to tabs
// ─────────────────────────────────────────────────────────────

import { callNIM, NIM_MODELS } from "../utils/nim_client.js";

// ── BROWSER TOOLS SCHEMA ────────────────────────────────────────
// Tells the LLM what browser capabilities are available.
// Uses OpenAI-compatible "function" tool format (NIM supports this fully).

const BROWSER_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_page",
      description: "Read the current page. Always call this first before any other action to understand what is on the page.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "click_element",
      description: "Click a button, link, or interactive element. Use element_index from read_page results, or a CSS selector.",
      parameters: {
        type: "object",
        properties: {
          element_index: { type: "integer", description: "Index from the interactable elements list returned by read_page" },
          selector: { type: "string", description: "CSS selector as fallback" },
          description: { type: "string", description: "Describe what you are clicking (for user display)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fill_form",
      description: "Fill in a form field (input, textarea, select). Use field_name (name/id attribute) or selector.",
      parameters: {
        type: "object",
        properties: {
          field_name: { type: "string", description: "The name or id attribute of the field" },
          selector: { type: "string", description: "CSS selector as fallback" },
          value: { type: "string", description: "The value to fill in" }
        },
        required: ["value"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate the browser to a new URL.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full URL including https://" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "scroll",
      description: "Scroll the page up or down to reveal more content.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down"] },
          pixels: { type: "integer", description: "How many pixels to scroll. Default 600." }
        },
        required: ["direction"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_text",
      description: "Extract text from a specific element by CSS selector.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the element to read" }
        },
        required: ["selector"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait",
      description: "Wait for a specified number of milliseconds (useful after navigation or clicking async elements).",
      parameters: {
        type: "object",
        properties: {
          ms: { type: "integer", description: "Milliseconds to wait (max 5000)" }
        },
        required: ["ms"]
      }
    }
  }
];

const SYSTEM_PROMPT = `You are an intelligent browser assistant, similar to Perplexity Comet. You can understand web pages and take actions on behalf of the user.

RULES:
1. Always call read_page FIRST before any action, unless you have just navigated and need to wait.
2. After navigation, call wait (1000-2000ms) then read_page to see the loaded page.
3. Be concise — explain what you are doing in 1-2 short sentences before each action.
4. Never guess selectors — use the element_index from read_page results when possible.
5. If a task requires multiple steps, plan them and execute them one by one.
6. When a task is complete, summarize what was accomplished.
7. If you cannot complete a task (permission issue, captcha, login required), explain clearly.
8. Never submit forms without explicitly confirming with the user first.

SAFETY:
- Do not click "delete", "remove", "cancel subscription" or destructive actions without explicit confirmation.
- Do not enter payment information.
- Stop and ask if unsure about an action's consequence.`;

// ── AGENT LOOP ──────────────────────────────────────────────────

async function runAgentLoop(userMessage, tabId, onUpdate) {
  const { nimApiKey, nimModel } = await chrome.storage.sync.get(["nimApiKey", "nimModel"]);
  if (!nimApiKey) {
    onUpdate({ type: "error", message: "⚠️ No NVIDIA NIM API key found. Click the extension icon to add your key." });
    return;
  }

  // Get initial page context to inject into system prompt
  let pageCtx;
  try {
    const ctxResponse = await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_CONTEXT" });
    pageCtx = ctxResponse.context;
  } catch (e) {
    pageCtx = { url: "unknown", title: "unknown", error: "Could not read page" };
  }

  const enhancedSystem = `${SYSTEM_PROMPT}

CURRENT PAGE STATE:
URL: ${pageCtx.url}
Title: ${pageCtx.title}
Page is ${pageCtx.pageHeight}px tall, currently scrolled to ${pageCtx.scrollY}px.`;

  const messages = [{ role: "user", content: userMessage }];
  const MAX_ITERATIONS = 15; // Safety cap — prevent infinite loops
  let iterations = 0;

  onUpdate({ type: "status", message: "🤔 Thinking..." });

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Call NIM with streaming for text, non-streaming for tool calls
    let responseText = "";
    let tool_calls = [];

    try {
      const result = await callNIM({
        apiKey: nimApiKey,
        model: nimModel || NIM_MODELS.SMART,
        messages,
        tools: BROWSER_TOOLS,
        systemPrompt: enhancedSystem,
        maxTokens: 1024,
        onChunk: (chunk) => {
          responseText += chunk;
          onUpdate({ type: "stream_chunk", chunk });
        },
      });

      tool_calls = result.tool_calls;
      if (result.text && !responseText) responseText = result.text;

    } catch (err) {
      onUpdate({ type: "error", message: `NIM API error: ${err.message}` });
      return;
    }

    // Build assistant message for history
    const assistantMsg = {
      role: "assistant",
      content: responseText || null,
    };
    if (tool_calls.length > 0) {
      assistantMsg.tool_calls = tool_calls.map(tc => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.function.name,
          arguments: JSON.stringify(tc.function.arguments)
        }
      }));
    }
    messages.push(assistantMsg);

    // If no tool calls, the agent is done
    if (tool_calls.length === 0) {
      onUpdate({ type: "done", text: responseText });
      return;
    }

    // Execute each tool call
    for (const tc of tool_calls) {
      const toolName = tc.function.name;
      const toolArgs = tc.function.arguments;

      onUpdate({ type: "tool_start", tool: toolName, args: toolArgs });

      let toolResult;

      try {
        if (toolName === "read_page") {
          const resp = await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_CONTEXT" });
          toolResult = resp.context;
          onUpdate({ type: "tool_done", tool: "read_page", summary: `Read page: ${toolResult.title}` });

        } else if (toolName === "click_element") {
          toolResult = await chrome.tabs.sendMessage(tabId, {
            type: "EXECUTE_ACTION",
            action: { type: "click", element_index: toolArgs.element_index, selector: toolArgs.selector }
          });
          onUpdate({ type: "tool_done", tool: "click_element", summary: `Clicked: ${toolArgs.description || toolArgs.selector}` });
          await sleep(500); // Let DOM settle

        } else if (toolName === "fill_form") {
          toolResult = await chrome.tabs.sendMessage(tabId, {
            type: "EXECUTE_ACTION",
            action: { type: "fill_form", field_name: toolArgs.field_name, selector: toolArgs.selector, value: toolArgs.value }
          });
          onUpdate({ type: "tool_done", tool: "fill_form", summary: `Filled: ${toolArgs.field_name || toolArgs.selector}` });

        } else if (toolName === "navigate") {
          await chrome.tabs.update(tabId, { url: toolArgs.url });
          toolResult = { success: true, navigated_to: toolArgs.url };
          onUpdate({ type: "tool_done", tool: "navigate", summary: `Navigating to: ${toolArgs.url}` });
          await sleep(2500); // Wait for page load

        } else if (toolName === "scroll") {
          toolResult = await chrome.tabs.sendMessage(tabId, {
            type: "EXECUTE_ACTION",
            action: { type: "scroll", direction: toolArgs.direction, pixels: toolArgs.pixels || 600 }
          });
          onUpdate({ type: "tool_done", tool: "scroll", summary: `Scrolled ${toolArgs.direction}` });

        } else if (toolName === "get_text") {
          toolResult = await chrome.tabs.sendMessage(tabId, {
            type: "EXECUTE_ACTION",
            action: { type: "get_text", selector: toolArgs.selector }
          });
          onUpdate({ type: "tool_done", tool: "get_text", summary: `Got text from: ${toolArgs.selector}` });

        } else if (toolName === "wait") {
          const waitMs = Math.min(toolArgs.ms || 1000, 5000);
          await sleep(waitMs);
          toolResult = { success: true, waited_ms: waitMs };
          onUpdate({ type: "tool_done", tool: "wait", summary: `Waited ${waitMs}ms` });
        }

      } catch (err) {
        toolResult = { success: false, error: err.message };
        onUpdate({ type: "tool_error", tool: toolName, error: err.message });
      }

      // Feed result back to the model
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  onUpdate({ type: "error", message: "⚠️ Maximum iterations reached. Task may be incomplete." });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── OPEN SIDE PANEL ON KEYBOARD SHORTCUT ───────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-sidepanel") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ── MESSAGE HANDLER (from sidepanel) ───────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RUN_AGENT") {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      // We need a persistent port for streaming updates back to sidepanel
      // sendResponse is async — we use a port approach via chrome.runtime
      runAgentLoop(message.userMessage, tab.id, (update) => {
        chrome.runtime.sendMessage({ type: "AGENT_UPDATE", ...update }).catch(() => {});
      });
    });
    sendResponse({ started: true });
    return true;
  }

  if (message.type === "STOP_AGENT") {
    // Implement abort logic if needed
    sendResponse({ stopped: true });
    return true;
  }
});

console.log("[NIM Assistant] Background service worker started");

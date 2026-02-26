// ─────────────────────────────────────────────────────────────
// SIDE PANEL JAVASCRIPT
// Single-pane architecture — compare mode removed.
// Fixes: thinking indicator, streaming state, message ordering.
// ─────────────────────────────────────────────────────────────

// ── DOM REFS ─────────────────────────────────────────────────

const header     = document.getElementById("header");
const messagesEl = document.getElementById("messages");
const userInput  = document.getElementById("user-input");
const sendBtn    = document.getElementById("send-btn");
const sendIcon   = document.getElementById("send-icon");
const clearBtn   = document.getElementById("clear-btn");
const settingsBtn= document.getElementById("settings-btn");
const modelBadge = document.getElementById("model-badge");

// ── SVG ICONS ─────────────────────────────────────────────────

const SEND_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="22" y1="2" x2="11" y2="13"/>
  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
</svg>`;

const STOP_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
  <rect x="5" y="5" width="14" height="14" rx="2"/>
</svg>`;

const LOGO_MINI = `<svg width="11" height="11" viewBox="0 0 24 24" fill="#0BC5EA">
  <path d="M12 2L14.5 9H22L16 13.5L18 21L12 16.5L6 21L8 13.5L2 9H9.5L12 2Z"/>
</svg>`;

// ── STATE ─────────────────────────────────────────────────────

let isAgentRunning  = false;
let currentTextEl   = null;   // <div> currently receiving streamed tokens
let thinkingEl      = null;   // thinking bubble element
let toolElements    = {};     // toolName → DOM element for update

const TOOL_ICONS = {
  read_page:     "📄",
  click_element: "🖱️",
  fill_form:     "✏️",
  navigate:      "🌐",
  scroll:        "↕️",
  get_text:      "📝",
  wait:          "⏳",
  web_search:    "🔍",
  submit_form:   "✉️",
};

// ── MODEL BADGE ───────────────────────────────────────────────

const MODEL_LABELS = {
  "meta/llama-3.3-70b-instruct":               "Llama 3.3 70B",
  "meta/llama-3.1-8b-instruct":                "Llama 3.1 8B",
  "meta/llama-4-maverick-17b-128e-instruct":   "Llama 4 Maverick",
  "nvidia/llama-3.1-nemotron-70b-instruct":    "Nemotron 70B",
  "qwen/qwen2.5-coder-32b-instruct":           "Qwen 2.5 Coder",
  "ollama/llama3":                             "Ollama Llama3",
  "ollama/mistral":                            "Ollama Mistral",
};

chrome.storage.sync.get(["nimModel"], (data) => {
  const model = data.nimModel || "meta/llama-3.3-70b-instruct";
  modelBadge.textContent = MODEL_LABELS[model] || model.split("/").pop();
});

// ── UI HELPERS ────────────────────────────────────────────────

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, content, cssClass = "") {
  const div = document.createElement("div");
  div.className = `message ${role} ${cssClass}`.trim();

  const label = document.createElement("div");
  label.className = "message-label";
  label.innerHTML = role === "user"
    ? "You"
    : `${LOGO_MINI} NIM Assistant`;

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = content;

  div.appendChild(label);
  div.appendChild(text);
  messagesEl.appendChild(div);
  scrollToBottom();
  return { container: div, textEl: text };
}

// ── THINKING INDICATOR ────────────────────────────────────────
// FIX: Shown immediately when agent starts so there's no blank gap.

function showThinking() {
  removeThinking(); // safety — remove old one if any
  const wrap = document.createElement("div");
  wrap.className = "thinking-bubble";
  wrap.id = "thinking-bubble";

  wrap.innerHTML = `
    <div class="thinking-bubble-inner">
      <div class="thinking-label">${LOGO_MINI} NIM Assistant</div>
      <div class="thinking-dots">
        <span></span><span></span><span></span>
      </div>
    </div>`;

  messagesEl.appendChild(wrap);
  scrollToBottom();
  thinkingEl = wrap;
}

function removeThinking() {
  if (thinkingEl && thinkingEl.parentNode) {
    thinkingEl.parentNode.removeChild(thinkingEl);
  }
  thinkingEl = null;
}

// ── STREAMING ─────────────────────────────────────────────────

function startStreamingMessage() {
  // Remove thinking indicator — first real token arrived
  removeThinking();

  const div = document.createElement("div");
  div.className = "message assistant";

  const label = document.createElement("div");
  label.className = "message-label";
  label.innerHTML = `${LOGO_MINI} NIM Assistant`;

  const text = document.createElement("div");
  text.className = "message-text";

  const cursor = document.createElement("span");
  cursor.className = "cursor";

  div.appendChild(label);
  div.appendChild(text);
  text.appendChild(cursor);
  messagesEl.appendChild(div);
  scrollToBottom();

  currentTextEl = text;
  return text;
}

function appendChunk(chunk) {
  if (!currentTextEl) startStreamingMessage();
  const cursor = currentTextEl.querySelector(".cursor");
  const textNode = document.createTextNode(chunk);
  if (cursor) currentTextEl.insertBefore(textNode, cursor);
  else currentTextEl.appendChild(textNode);
  scrollToBottom();
}

function finalizeStream() {
  if (currentTextEl) {
    const cursor = currentTextEl.querySelector(".cursor");
    if (cursor) cursor.remove();
  }
  currentTextEl = null;
}

// ── TOOL EVENTS ───────────────────────────────────────────────

function addToolEvent(toolName) {
  const div = document.createElement("div");
  div.className = "tool-event";
  div.innerHTML = `<span class="spinner"></span> <strong>${toolName}</strong> Running…`;
  messagesEl.appendChild(div);
  scrollToBottom();
  toolElements[toolName + "_" + Date.now()] = div; // unique key per call
  return div;
}

function updateToolEvent(el, status, summary) {
  const icon = TOOL_ICONS[status === "error" ? "" : ""] || "";
  if (status === "done") {
    el.className = "tool-event done";
    const toolName = el.querySelector("strong")?.textContent || "";
    const icon = TOOL_ICONS[toolName] || "✅";
    el.innerHTML = `${icon} <strong>${toolName}</strong> ${summary}`;
  } else if (status === "error") {
    el.className = "tool-event error";
    const toolName = el.querySelector("strong")?.textContent || "";
    el.innerHTML = `❌ <strong>${toolName}</strong> ${summary}`;
  }
}

// ── LOADING STATE ─────────────────────────────────────────────

function setLoading(loading) {
  isAgentRunning = loading;
  userInput.disabled = loading;

  if (loading) {
    sendBtn.classList.add("running");
    sendIcon.innerHTML = STOP_SVG;
    header.classList.add("agent-active");
  } else {
    sendBtn.classList.remove("running");
    sendBtn.disabled = false;
    sendIcon.innerHTML = SEND_SVG;
    header.classList.remove("agent-active");
  }
}

// ── AGENT UPDATE RECEIVER ─────────────────────────────────────
// Receives events from background.js via chrome.runtime.sendMessage

// Track the last tool element added so we can update it
let lastToolEl = null;
let lastToolName = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "AGENT_UPDATE") return;

  const evt = msg.event;

  // ── Thinking (agent just started, API call in flight) ──
  if (evt === "thinking") {
    showThinking();
    return;
  }

  // ── Streaming text token ──
  if (evt === "stream_chunk") {
    appendChunk(msg.chunk);
    return;
  }

  // ── Tool starting ──
  if (evt === "tool_start") {
    // If thinking bubble is still up, remove it — tools are activity
    removeThinking();
    lastToolEl   = addToolEvent(msg.tool);
    lastToolName = msg.tool;
    return;
  }

  // ── Tool finished ──
  if (evt === "tool_done") {
    // Find the most recent tool element with this tool name
    const el = findLastToolEl(msg.tool);
    if (el) updateToolEvent(el, "done", msg.summary || "");
    return;
  }

  // ── Tool errored ──
  if (evt === "tool_error") {
    const el = findLastToolEl(msg.tool);
    if (el) updateToolEvent(el, "error", msg.error || "");
    return;
  }

  // ── Agent done ──
  if (evt === "done") {
    finalizeStream();
    removeThinking();
    setLoading(false);
    return;
  }

  // ── Error ──
  if (evt === "error") {
    finalizeStream();
    removeThinking();
    addMessage("assistant", msg.message || "An unknown error occurred.", "error");
    setLoading(false);
    return;
  }
});

// Find the last tool-event element for a given tool name
function findLastToolEl(toolName) {
  const all = messagesEl.querySelectorAll(".tool-event");
  for (let i = all.length - 1; i >= 0; i--) {
    const strong = all[i].querySelector("strong");
    if (strong && strong.textContent.trim() === toolName) return all[i];
  }
  return null;
}

// ── SEND MESSAGE ──────────────────────────────────────────────

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isAgentRunning) return;

  // Reset streaming state for new turn
  currentTextEl = null;
  toolElements  = {};
  lastToolEl    = null;
  lastToolName  = null;

  addMessage("user", text);
  userInput.value = "";
  userInput.style.height = "auto";
  setLoading(true);

  try {
    await chrome.runtime.sendMessage({
      type:        "RUN_AGENT",
      userMessage: text,
      targetPane:  1,
    });
  } catch (err) {
    // Background not ready — show error immediately
    addMessage("assistant", `Connection error: ${err.message}. Try reloading the extension.`, "error");
    setLoading(false);
  }
}

// ── EVENT LISTENERS ───────────────────────────────────────────

sendBtn.addEventListener("click", () => {
  if (isAgentRunning) {
    // Stop button pressed — reset UI state
    // Note: the background loop will finish its current iteration naturally
    finalizeStream();
    removeThinking();
    setLoading(false);
  } else {
    sendMessage();
  }
});

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});

clearBtn.addEventListener("click", () => {
  messagesEl.innerHTML = "";
  currentTextEl = null;
  toolElements  = {};
  chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" }).catch(() => {});
  showWelcome();
});

settingsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("popup/popup.html") });
});

// ── WELCOME MESSAGE ───────────────────────────────────────────

function showWelcome() {
  addMessage("assistant",
    "👋 Hi! I'm your NIM Browser Assistant powered by NVIDIA.\n\n" +
    "I can read this page, click things, fill forms, and navigate the web for you.\n\n" +
    "Try:\n• \"Summarize this page\"\n• \"Search the web for latest AI news\"\n• \"Fill in the contact form\""
  );
}

showWelcome();

// ─────────────────────────────────────────────────────────────
// SIDE PANEL JAVASCRIPT — Chat UI + Streaming Renderer
// ─────────────────────────────────────────────────────────────

const messagesEl = document.getElementById("messages");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const clearBtn = document.getElementById("clear-btn");
const settingsBtn = document.getElementById("settings-btn");

let isAgentRunning = false;
let currentAssistantEl = null;
let currentTextEl = null;

// ── UI HELPERS ─────────────────────────────────────────────────

function addMessage(role, content, cssClass = "") {
  const div = document.createElement("div");
  div.className = `message ${role} ${cssClass}`;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = role === "user" ? "You" : "NIM Assistant";
  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = content;
  div.appendChild(label);
  div.appendChild(text);
  messagesEl.appendChild(div);
  scrollToBottom();
  return { container: div, textEl: text };
}

function addToolEvent(toolName, status = "running", summary = "") {
  const div = document.createElement("div");
  div.className = `tool-event ${status === "running" ? "" : status}`;

  const icons = {
    read_page: "📄",
    click_element: "🖱️",
    fill_form: "✏️",
    navigate: "🌐",
    scroll: "↕️",
    get_text: "📝",
    wait: "⏳",
  };
  const icon = icons[toolName] || "🔧";

  div.innerHTML = status === "running"
    ? `<span class="spinner">⟳</span> <strong>${toolName}</strong>: Running...`
    : `${icon} <strong>${toolName}</strong>: ${summary}`;

  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function startStreamingMessage() {
  const div = document.createElement("div");
  div.className = "message assistant";
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = "NIM Assistant";
  const text = document.createElement("div");
  text.className = "message-text";
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  div.appendChild(label);
  div.appendChild(text);
  text.appendChild(cursor);
  messagesEl.appendChild(div);
  scrollToBottom();
  currentAssistantEl = div;
  currentTextEl = text;
  return { container: div, textEl: text, cursor };
}

function appendStreamChunk(textEl, chunk) {
  const cursor = textEl.querySelector(".cursor");
  const textNode = document.createTextNode(chunk);
  if (cursor) textEl.insertBefore(textNode, cursor);
  else textEl.appendChild(textNode);
  scrollToBottom();
}

function finalizeStream(textEl) {
  const cursor = textEl.querySelector(".cursor");
  if (cursor) cursor.remove();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setLoading(loading) {
  isAgentRunning = loading;
  sendBtn.disabled = loading;
  userInput.disabled = loading;
  document.getElementById("send-icon").textContent = loading ? "⏹" : "➤";
}

// ── AGENT UPDATE HANDLER ────────────────────────────────────────
// Receives updates from background.js during the agent loop

const toolElements = {};

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "AGENT_UPDATE") return;

  if (message.type === "AGENT_UPDATE") {
    const { type } = message;

    if (type === "status") {
      // Small status indicator — no need to show to user unless first
    }

    if (type === "stream_chunk") {
      if (!currentTextEl) {
        const { textEl } = startStreamingMessage();
        currentTextEl = textEl;
      }
      appendStreamChunk(currentTextEl, message.chunk);
    }

    if (type === "tool_start") {
      const el = addToolEvent(message.tool, "running");
      toolElements[message.tool] = el;
    }

    if (type === "tool_done") {
      const el = toolElements[message.tool];
      if (el) {
        el.className = "tool-event done";
        const icons = { read_page:"📄",click_element:"🖱️",fill_form:"✏️",navigate:"🌐",scroll:"↕️",get_text:"📝",wait:"⏳" };
        el.innerHTML = `${icons[message.tool]||"✅"} <strong>${message.tool}</strong>: ${message.summary}`;
      }
    }

    if (type === "tool_error") {
      const el = toolElements[message.tool];
      if (el) {
        el.className = "tool-event error";
        el.innerHTML = `❌ <strong>${message.tool}</strong> failed: ${message.error}`;
      }
    }

    if (type === "done") {
      if (currentTextEl) finalizeStream(currentTextEl);
      currentTextEl = null;
      currentAssistantEl = null;
      setLoading(false);
    }

    if (type === "error") {
      if (currentTextEl) finalizeStream(currentTextEl);
      addMessage("assistant", message.message, "error");
      currentTextEl = null;
      setLoading(false);
    }
  }
});

// ── SEND MESSAGE ────────────────────────────────────────────────

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isAgentRunning) return;

  addMessage("user", text);
  userInput.value = "";
  userInput.style.height = "auto";
  setLoading(true);

  // Reset streaming state
  currentTextEl = null;
  currentAssistantEl = null;
  Object.keys(toolElements).forEach(k => delete toolElements[k]);

  // Start the agent in background
  await chrome.runtime.sendMessage({ type: "RUN_AGENT", userMessage: text });
}

// ── EVENT LISTENERS ─────────────────────────────────────────────

sendBtn.addEventListener("click", sendMessage);

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
  currentAssistantEl = null;
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage?.() || chrome.tabs.create({ url: "popup/popup.html" });
});

// ── WELCOME MESSAGE ─────────────────────────────────────────────

addMessage("assistant",
  "👋 Hi! I'm your NIM Browser Assistant powered by NVIDIA. I can read this page, click things, fill forms, and navigate the web for you.\n\nTry: \"Summarize this page\" or \"Find the contact form and fill it in\""
);

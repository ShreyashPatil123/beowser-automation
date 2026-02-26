// ─────────────────────────────────────────────────────────────
// SIDE PANEL JAVASCRIPT — Chat UI + Streaming Renderer + Compare
// Marble × Turquoise Design — DOM rendering only
// ─────────────────────────────────────────────────────────────

const header = document.getElementById("header");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const clearBtn = document.getElementById("clear-btn");
const settingsBtn = document.getElementById("settings-btn");
const compareToggle = document.getElementById("compare-mode-toggle");
const modelBadge = document.getElementById("model-badge");

const pane1 = document.getElementById("chat-pane-1");
const pane2 = document.getElementById("chat-pane-2");
const messages1 = document.getElementById("messages-1");
const messages2 = document.getElementById("messages-2");
const modelSelect1 = document.getElementById("model-select-1");
const modelSelect2 = document.getElementById("model-select-2");
const modelBar1 = document.querySelector(".pane-1-select");

let isAgentRunning = false;
let compareMode = false;

const SEND_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
const STOP_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

const state = {
  1: { messagesEl: messages1, currentAssistantEl: null, currentTextEl: null, toolElements: {} },
  2: { messagesEl: messages2, currentAssistantEl: null, currentTextEl: null, toolElements: {} }
};

const MODELS = [
  { value: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { value: "meta/llama-3.1-8b-instruct", label: "Llama 3.1 8B" },
  { value: "meta/llama-4-maverick-17b-128e-instruct", label: "Llama 4 Maverick" },
  { value: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B" },
  { value: "qwen/qwen2.5-coder-32b-instruct", label: "Qwen 2.5 Coder" },
  { value: "ollama/llama3", label: "Ollama Llama3" },
  { value: "ollama/mistral", label: "Ollama Mistral" }
];

function initModels() {
  chrome.storage.sync.get(["nimModel"], (data) => {
    const defaultModel = data.nimModel || "meta/llama-3.3-70b-instruct";
    const alternateModel = "meta/llama-3.1-8b-instruct";

    MODELS.forEach(m => {
      const o1 = new Option(m.label, m.value, false, m.value === defaultModel);
      const o2 = new Option(m.label, m.value, false, m.value === alternateModel);
      modelSelect1.add(o1);
      modelSelect2.add(o2);
    });

    const found = MODELS.find(m => m.value === defaultModel);
    modelBadge.textContent = found ? found.label : "Llama 3.3 70B";
  });
}
initModels();

modelSelect1.addEventListener("change", () => {
  const found = MODELS.find(m => m.value === modelSelect1.value);
  if (found) modelBadge.textContent = found.label;
});

compareToggle.addEventListener("change", (e) => {
  compareMode = e.target.checked;
  pane2.style.display = compareMode ? "flex" : "none";
  modelBar1.style.display = compareMode ? "flex" : "none";
});

// ── UI HELPERS ────────────────────────────────────────────────

const LOGO_MINI = '<svg width="12" height="12" viewBox="0 0 24 24" fill="#0BC5EA"><path d="M12 2L14.5 9H22L16 13.5L18 21L12 16.5L6 21L8 13.5L2 9H9.5L12 2Z"/></svg>';

function addMessage(paneId, role, content, cssClass = "") {
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
  state[paneId].messagesEl.appendChild(div);
  scrollToBottom(paneId);
  return { container: div, textEl: text };
}

function addToolEvent(paneId, toolName, status = "running", summary = "") {
  const div = document.createElement("div");
  div.className = `tool-event ${status === "running" ? "" : status}`.trim();

  const icons = {
    read_page: "📄", click_element: "🖱️", fill_form: "✏️", navigate: "🌐",
    scroll: "↕️", get_text: "📝", wait: "⏳", web_search: "🔍", submit_form: "✉️"
  };

  if (status === "running") {
    div.innerHTML = `<span class="spinner"></span> <strong>${toolName}</strong> Running…`;
  } else {
    const icon = icons[toolName] || "✅";
    div.innerHTML = `${icon} <strong>${toolName}</strong> ${summary}`;
  }

  state[paneId].messagesEl.appendChild(div);
  scrollToBottom(paneId);
  return div;
}

function startStreamingMessage(paneId) {
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
  state[paneId].messagesEl.appendChild(div);
  scrollToBottom(paneId);

  state[paneId].currentAssistantEl = div;
  state[paneId].currentTextEl = text;
  return { container: div, textEl: text, cursor };
}

function appendStreamChunk(paneId, textEl, chunk) {
  const cursor = textEl.querySelector(".cursor");
  const textNode = document.createTextNode(chunk);
  if (cursor) textEl.insertBefore(textNode, cursor);
  else textEl.appendChild(textNode);
  scrollToBottom(paneId);
}

function finalizeStream(textEl) {
  const cursor = textEl.querySelector(".cursor");
  if (cursor) cursor.remove();
}

function scrollToBottom(paneId) {
  const el = state[paneId].messagesEl;
  el.scrollTop = el.scrollHeight;
}

function setLoading(loading) {
  isAgentRunning = loading;
  sendBtn.disabled = loading;
  userInput.disabled = loading;
  document.getElementById("send-icon").innerHTML = loading ? STOP_SVG : SEND_SVG;
  if (loading) header.classList.add("agent-active");
  else header.classList.remove("agent-active");
}

// ── AGENT UPDATE HANDLER ──────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "AGENT_UPDATE") return;

  const paneId = message.targetPane || 1;
  const pState = state[paneId];
  const evt = message.event;

  if (evt === "status") {
    // Thinking indicator — no visual needed
  }

  if (evt === "stream_chunk") {
    if (!pState.currentTextEl) startStreamingMessage(paneId);
    appendStreamChunk(paneId, pState.currentTextEl, message.chunk);
  }

  if (evt === "tool_start") {
    pState.toolElements[message.tool] = addToolEvent(paneId, message.tool, "running");
  }

  if (evt === "tool_done") {
    const el = pState.toolElements[message.tool];
    if (el) {
      el.className = "tool-event done";
      const icons = { read_page:"📄",click_element:"🖱️",fill_form:"✏️",navigate:"🌐",scroll:"↕️",get_text:"📝",wait:"⏳",web_search:"🔍",submit_form:"✉️" };
      el.innerHTML = `${icons[message.tool]||"✅"} <strong>${message.tool}</strong> ${message.summary}`;
    }
  }

  if (evt === "tool_error") {
    const el = pState.toolElements[message.tool];
    if (el) {
      el.className = "tool-event error";
      el.innerHTML = `❌ <strong>${message.tool}</strong> failed: ${message.error}`;
    }
  }

  if (evt === "done") {
    if (pState.currentTextEl) finalizeStream(pState.currentTextEl);
    pState.currentTextEl = null;
    pState.currentAssistantEl = null;
    setLoading(false);
  }

  if (evt === "error") {
    if (pState.currentTextEl) finalizeStream(pState.currentTextEl);
    addMessage(paneId, "assistant", message.message, "error");
    pState.currentTextEl = null;
    setLoading(false);
  }
});

// ── SEND MESSAGE ──────────────────────────────────────────────

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isAgentRunning) return;

  addMessage(1, "user", text);
  if (compareMode) addMessage(2, "user", text);

  userInput.value = "";
  userInput.style.height = "auto";
  setLoading(true);

  // Reset streaming state
  [1, 2].forEach(id => {
    state[id].currentTextEl = null;
    state[id].currentAssistantEl = null;
    Object.keys(state[id].toolElements).forEach(k => delete state[id].toolElements[k]);
  });

  chrome.runtime.sendMessage({
    type: "RUN_AGENT",
    userMessage: text,
    targetPane: 1,
    overrideModel: compareMode ? modelSelect1.value : null
  });

  if (compareMode) {
    chrome.runtime.sendMessage({
      type: "RUN_AGENT",
      userMessage: text,
      targetPane: 2,
      overrideModel: modelSelect2.value
    });
  }
}

// ── EVENT LISTENERS ───────────────────────────────────────────

sendBtn.addEventListener("click", sendMessage);

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});

clearBtn.addEventListener("click", () => {
  [1, 2].forEach(id => {
    state[id].messagesEl.innerHTML = "";
    state[id].currentTextEl = null;
    state[id].currentAssistantEl = null;
  });
  chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
  showWelcome();
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage?.() || chrome.tabs.create({ url: "popup/popup.html" });
});

// ── WELCOME ───────────────────────────────────────────────────

function showWelcome() {
  addMessage(1, "assistant",
    '👋 Hi! I\'m your NIM Browser Assistant. I can read pages, click things, fill forms, search the web, and navigate for you.\n\nTry: "Summarize this page" or "Search the web for latest AI news"'
  );
  addMessage(2, "assistant",
    '👋 Hi! Compare mode — I\'ll respond with whatever model you select here.'
  );
}
showWelcome();

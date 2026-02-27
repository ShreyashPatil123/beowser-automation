// ─────────────────────────────────────────────────────────────
// SIDE PANEL JAVASCRIPT
// Vertex AI Studio-inspired Compare Mode + single-pane default.
// Supports parallel streaming to dual panes via targetPane routing.
// ─────────────────────────────────────────────────────────────

// ── DOM REFS ─────────────────────────────────────────────────

const header          = document.getElementById("header");
const singlePane      = document.getElementById("single-pane");
const comparePane     = document.getElementById("compare-pane");
const userInput       = document.getElementById("user-input");
const sendBtn         = document.getElementById("send-btn");
const sendIcon        = document.getElementById("send-icon");
const clearBtn        = document.getElementById("clear-btn");
const settingsBtn     = document.getElementById("settings-btn");
const modelBadge      = document.getElementById("model-badge");
const compareToggle   = document.getElementById("compare-toggle");
const compareModelSel1= document.getElementById("compare-model-1");
const compareModelSel2= document.getElementById("compare-model-2");

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

// ── AVAILABLE MODELS ──────────────────────────────────────────

const ALL_MODELS = [
  { value: "meta/llama-3.3-70b-instruct",             label: "Llama 3.3 70B" },
  { value: "meta/llama-3.1-8b-instruct",              label: "Llama 3.1 8B" },
  { value: "meta/llama-4-maverick-17b-128e-instruct",  label: "Llama 4 Maverick" },
  { value: "nvidia/llama-3.1-nemotron-70b-instruct",   label: "Nemotron 70B" },
  { value: "qwen/qwen2.5-coder-32b-instruct",          label: "Qwen 2.5 Coder" },
  { value: "ollama/llama3",                            label: "Ollama Llama3" },
  { value: "ollama/mistral",                           label: "Ollama Mistral" },
];

const MODEL_LABELS = {};
ALL_MODELS.forEach(m => { MODEL_LABELS[m.value] = m.label; });

function populateModelSelect(selectEl, defaultVal) {
  selectEl.innerHTML = "";
  ALL_MODELS.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.value;
    opt.textContent = m.label;
    if (m.value === defaultVal) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

// ── STATE ─────────────────────────────────────────────────────

let isAgentRunning = false;
let isCompareMode  = false;

// Per-pane state
const paneState = {
  1: { textEl: null, thinkingEl: null },
  2: { textEl: null, thinkingEl: null },
};

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

chrome.storage.sync.get(["nimModel"], (data) => {
  const model = data.nimModel || "meta/llama-3.3-70b-instruct";
  modelBadge.textContent = MODEL_LABELS[model] || model.split("/").pop();
  populateModelSelect(compareModelSel1, model);
  // Default pane 2 to a different model
  const secondModel = ALL_MODELS.find(m => m.value !== model)?.value || model;
  populateModelSelect(compareModelSel2, secondModel);
});

// ── COMPARE MODE TOGGLE ──────────────────────────────────────

compareToggle.addEventListener("click", () => {
  isCompareMode = !isCompareMode;
  compareToggle.classList.toggle("active", isCompareMode);

  if (isCompareMode) {
    singlePane.style.display = "none";
    comparePane.style.display = "flex";
    modelBadge.textContent = "Compare";
  } else {
    singlePane.style.display = "flex";
    comparePane.style.display = "none";
    chrome.storage.sync.get(["nimModel"], (data) => {
      const model = data.nimModel || "meta/llama-3.3-70b-instruct";
      modelBadge.textContent = MODEL_LABELS[model] || model.split("/").pop();
    });
  }
});

// ── PANE HELPERS ──────────────────────────────────────────────

function getMessagesEl(paneId) {
  if (!isCompareMode) return document.getElementById("messages-1");
  return document.getElementById(`compare-messages-${paneId}`);
}

function scrollToBottom(el) {
  el.scrollTop = el.scrollHeight;
}

function addMessage(paneId, role, content, cssClass = "") {
  const container = getMessagesEl(paneId);
  const div = document.createElement("div");
  div.className = `message ${role} ${cssClass}`.trim();

  const label = document.createElement("div");
  label.className = "message-label";
  label.innerHTML = role === "user" ? "You" : `${LOGO_MINI} NIM Assistant`;

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = content;

  div.appendChild(label);
  div.appendChild(text);
  container.appendChild(div);
  scrollToBottom(container);
  return { container: div, textEl: text };
}

// ── THINKING INDICATOR ────────────────────────────────────────

function showThinking(paneId) {
  removeThinking(paneId);
  const container = getMessagesEl(paneId);
  const wrap = document.createElement("div");
  wrap.className = "thinking-bubble";
  wrap.innerHTML = `
    <div class="thinking-bubble-inner">
      <div class="thinking-label">${LOGO_MINI} NIM Assistant</div>
      <div class="thinking-dots">
        <span></span><span></span><span></span>
      </div>
    </div>`;
  container.appendChild(wrap);
  scrollToBottom(container);
  paneState[paneId].thinkingEl = wrap;
}

function removeThinking(paneId) {
  const el = paneState[paneId].thinkingEl;
  if (el && el.parentNode) el.parentNode.removeChild(el);
  paneState[paneId].thinkingEl = null;
}

// ── STREAMING ─────────────────────────────────────────────────

function startStreamingMessage(paneId) {
  removeThinking(paneId);
  const container = getMessagesEl(paneId);

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
  container.appendChild(div);
  scrollToBottom(container);

  paneState[paneId].textEl = text;
  return text;
}

function appendChunk(paneId, chunk) {
  if (!paneState[paneId].textEl) startStreamingMessage(paneId);
  const textEl = paneState[paneId].textEl;
  const cursor = textEl.querySelector(".cursor");
  const textNode = document.createTextNode(chunk);
  if (cursor) textEl.insertBefore(textNode, cursor);
  else textEl.appendChild(textNode);
  scrollToBottom(textEl.closest(".messages"));
}

function finalizeStream(paneId) {
  const textEl = paneState[paneId].textEl;
  if (textEl) {
    const cursor = textEl.querySelector(".cursor");
    if (cursor) cursor.remove();
  }
  paneState[paneId].textEl = null;
}

// ── TOOL EVENTS ───────────────────────────────────────────────

function addToolEvent(paneId, toolName) {
  const container = getMessagesEl(paneId);
  const div = document.createElement("div");
  div.className = "tool-event";
  div.innerHTML = `<span class="spinner"></span> <strong>${toolName}</strong> Running…`;
  container.appendChild(div);
  scrollToBottom(container);
  return div;
}

function updateToolEvent(el, status, summary) {
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
// Routes to correct pane via msg.targetPane

const lastToolElByPane = { 1: null, 2: null };

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "AGENT_UPDATE") return;

  const paneId = msg.targetPane || 1;
  const evt    = msg.event;

  if (evt === "thinking") {
    showThinking(paneId);
    return;
  }

  if (evt === "stream_chunk") {
    appendChunk(paneId, msg.chunk);
    return;
  }

  if (evt === "tool_start") {
    removeThinking(paneId);
    lastToolElByPane[paneId] = addToolEvent(paneId, msg.tool);
    return;
  }

  if (evt === "tool_done") {
    const el = findLastToolEl(paneId, msg.tool);
    if (el) updateToolEvent(el, "done", msg.summary || "");
    return;
  }

  if (evt === "tool_error") {
    const el = findLastToolEl(paneId, msg.tool);
    if (el) updateToolEvent(el, "error", msg.error || "");
    return;
  }

  if (evt === "done") {
    finalizeStream(paneId);
    removeThinking(paneId);
    // Only clear loading if both panes are done in compare mode
    if (isCompareMode) {
      panesDone[paneId] = true;
      if (panesDone[1] && panesDone[2]) {
        setLoading(false);
        panesDone[1] = false;
        panesDone[2] = false;
      }
    } else {
      setLoading(false);
    }
    return;
  }

  if (evt === "error") {
    finalizeStream(paneId);
    removeThinking(paneId);
    addMessage(paneId, "assistant", msg.message || "An unknown error occurred.", "error");
    if (isCompareMode) {
      panesDone[paneId] = true;
      if (panesDone[1] && panesDone[2]) {
        setLoading(false);
        panesDone[1] = false;
        panesDone[2] = false;
      }
    } else {
      setLoading(false);
    }
    return;
  }
});

const panesDone = { 1: false, 2: false };

function findLastToolEl(paneId, toolName) {
  const container = getMessagesEl(paneId);
  const all = container.querySelectorAll(".tool-event");
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

  // Reset per-pane streaming state
  paneState[1].textEl = null;
  paneState[2].textEl = null;
  lastToolElByPane[1] = null;
  lastToolElByPane[2] = null;
  panesDone[1] = false;
  panesDone[2] = false;

  setLoading(true);
  userInput.value = "";
  userInput.style.height = "auto";

  if (isCompareMode) {
    // Add user message to both panes
    addMessage(1, "user", text);
    addMessage(2, "user", text);

    const model1 = compareModelSel1.value;
    const model2 = compareModelSel2.value;

    // Fire both panes in parallel
    try {
      chrome.runtime.sendMessage({
        type: "RUN_AGENT",
        userMessage: text,
        targetPane: 1,
        overrideModel: model1,
      }).catch(() => {});
    } catch (err) { /* ignore */ }

    try {
      chrome.runtime.sendMessage({
        type: "RUN_AGENT",
        userMessage: text,
        targetPane: 2,
        overrideModel: model2,
      }).catch(() => {});
    } catch (err) { /* ignore */ }

  } else {
    // Single pane
    addMessage(1, "user", text);
    try {
      await chrome.runtime.sendMessage({
        type: "RUN_AGENT",
        userMessage: text,
        targetPane: 1,
      });
    } catch (err) {
      addMessage(1, "assistant", `Connection error: ${err.message}. Try reloading the extension.`, "error");
      setLoading(false);
    }
  }
}

// ── EVENT LISTENERS ───────────────────────────────────────────

sendBtn.addEventListener("click", () => {
  if (isAgentRunning) {
    finalizeStream(1);
    finalizeStream(2);
    removeThinking(1);
    removeThinking(2);
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

userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});

clearBtn.addEventListener("click", () => {
  document.getElementById("messages-1").innerHTML = "";
  const cm1 = document.getElementById("compare-messages-1");
  const cm2 = document.getElementById("compare-messages-2");
  if (cm1) cm1.innerHTML = "";
  if (cm2) cm2.innerHTML = "";
  paneState[1].textEl = null;
  paneState[2].textEl = null;
  chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" }).catch(() => {});
  showWelcome();
});

settingsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("popup/popup.html") });
});

// ── WELCOME MESSAGE ───────────────────────────────────────────

function showWelcome() {
  addMessage(1, "assistant",
    "👋 Hi! I'm your NIM Browser Assistant powered by NVIDIA.\n\n" +
    "I can read this page, click things, fill forms, and navigate the web for you.\n\n" +
    "Try:\n• \"Summarize this page\"\n• \"Search the web for latest AI news\"\n• \"Fill in the contact form\"\n\n" +
    "💡 Tip: Click the ⊞ icon to enter Compare Mode and evaluate two models side-by-side."
  );
}

showWelcome();

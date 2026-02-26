// ─────────────────────────────────────────────────────────────
// DOM EXTRACTOR — Converts page into token-efficient JSON
// Never send the full DOM to the LLM — this is the key insight
// ─────────────────────────────────────────────────────────────

function stripNullBytes(str) {
  if (!str) return str;
  return str.replace(/[\u0000-\u001f]/g, "");
}

function extractPageContext() {
  // Prioritize visible, meaningful content only
  const getText = (el) => stripNullBytes((el?.innerText || el?.textContent || "").trim().slice(0, 200));

  // Headings — page structure signal
  const headings = [...document.querySelectorAll("h1, h2, h3")]
    .slice(0, 15)
    .map(h => ({ tag: h.tagName, text: getText(h) }))
    .filter(h => h.text.length > 0);

  // Interactive elements — what the agent can act on
  const interactable = [...document.querySelectorAll(
    'button, a[href], input, select, textarea, [role="button"], [role="link"]'
  )]
    .slice(0, 40)
    .map((el, i) => ({
      index: i,
      tag: el.tagName,
      type: stripNullBytes(el.type || null),
      role: stripNullBytes(el.getAttribute("role") || null),
      text: stripNullBytes(getText(el) || el.getAttribute("aria-label") || el.placeholder || null),
      name: stripNullBytes(el.name || el.id || null),
      href: stripNullBytes(el.href || null),
      value: stripNullBytes(el.value || null),
    }))
    .filter(el => el.text || el.name || el.href);

  // Forms — structured capture of fillable fields
  const forms = [...document.querySelectorAll("form")].slice(0, 5).map(form => ({
    id: stripNullBytes(form.id || null),
    action: stripNullBytes(form.action || null),
    fields: [...form.querySelectorAll("input, select, textarea")].map(f => ({
      name: stripNullBytes(f.name || f.id),
      type: stripNullBytes(f.type),
      placeholder: stripNullBytes(f.placeholder || null),
      required: f.required,
    }))
  }));

  // Main content — truncated to avoid token overflow
  const mainEl = document.querySelector("main") || document.querySelector("article") || document.body;
  const mainText = stripNullBytes(mainEl.innerText
    .replace(/\s\s+/g, " ")
    .trim()
    .slice(0, 4000)); // ~1000 tokens max

  return {
    url: window.location.href,
    title: document.title,
    headings,
    interactable,
    forms,
    mainText,
    pageHeight: document.body.scrollHeight,
    scrollY: window.scrollY,
  };
}

// ─────────────────────────────────────────────────────────────
// ACTION EXECUTOR — Performs actions on behalf of the agent
// ─────────────────────────────────────────────────────────────

async function findElement(hints) {
  // Priority 1: exact CSS selector
  if (hints.selector) {
    try {
      const el = document.querySelector(hints.selector);
      if (el) return el;
    } catch (e) {}
  }
  // Priority 2: element_index from interactable list
  if (hints.element_index !== undefined) {
    const all = document.querySelectorAll(
      'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"]'
    );
    if (all[hints.element_index]) return all[hints.element_index];
  }
  // Priority 3: text content matching
  if (hints.text) {
    const all = document.querySelectorAll("button, a, [role='button']");
    const match = [...all].find(el =>
      el.innerText.trim().toLowerCase().includes(hints.text.toLowerCase())
    );
    if (match) return match;
  }
  // Priority 4: aria-label
  if (hints.ariaLabel) {
    try {
      const el = document.querySelector(`[aria-label="${hints.ariaLabel}"]`);
      if (el) return el;
    } catch (e) {}
  }
  // Priority 5: coordinates
  if (hints.x && hints.y) {
    return document.elementFromPoint(hints.x, hints.y);
  }
  return null;
}

async function executeAction(action) {
  const { type } = action;

  try {
    if (type === "click") {
      const target = await findElement(action);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(300);
        target.focus();
        target.click();
        return { success: true, action: "click", element: target.tagName };
      }
      return { success: false, error: "Element not found" };
    }

    if (type === "fill_form") {
      let target = null;
      if (action.selector) {
        try { target = document.querySelector(action.selector); } catch(e) {}
      }
      if (!target && action.field_name) {
        target = [...document.querySelectorAll("input, textarea, select")]
          .find(el => el.name === action.field_name || el.id === action.field_name);
      }
      if (target) {
        target.focus();
        target.value = action.value;
        // Fire React/Vue-compatible events
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true, action: "fill_form", field: action.selector || action.field_name, value: action.value };
      }
      return { success: false, error: `Field not found: ${action.selector || action.field_name}` };
    }

    if (type === "scroll") {
      const amount = action.direction === "up" ? -action.pixels : action.pixels;
      window.scrollBy({ top: amount, behavior: "smooth" });
      await sleep(500);
      return { success: true, action: "scroll", scrollY: window.scrollY };
    }

    if (type === "navigate") {
      window.location.href = action.url;
      return { success: true, action: "navigate", url: action.url };
    }

    if (type === "get_text") {
      const el = await findElement(action);
      return { success: true, text: el ? stripNullBytes(el.innerText.trim()) : null };
    }

    if (type === "submit_form") {
      const form = document.querySelector(action.selector || "form");
      if (form) {
        form.submit();
        return { success: true, action: "submit_form" };
      }
      return { success: false, error: "Form not found" };
    }

    return { success: false, error: `Unknown action type: ${type}` };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// MESSAGE LISTENER — Handles requests from background.js
// ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_PAGE_CONTEXT") {
    sendResponse({ success: true, context: extractPageContext() });
    return true;
  }

  if (message.type === "EXECUTE_ACTION") {
    executeAction(message.action)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // required for async sendResponse
  }

  if (message.type === "PING") {
    sendResponse({ alive: true });
    return true;
  }
});

console.log("[NIM Assistant] Content script loaded on:", window.location.hostname);

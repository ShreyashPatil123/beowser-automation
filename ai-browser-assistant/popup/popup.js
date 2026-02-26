// ─────────────────────────────────────────────────────────────
// POPUP SETTINGS — Load / Save + Password Toggle
// ─────────────────────────────────────────────────────────────

// Load saved settings on open
chrome.storage.sync.get(
  ["nimApiKey", "perplexityApiKey", "nimModel", "nimMaxTokens", "confirmForms", "confirmNav"],
  (data) => {
    if (data.nimApiKey) document.getElementById("api-key").value = data.nimApiKey;
    if (data.perplexityApiKey) document.getElementById("perplexity-api-key").value = data.perplexityApiKey;
    if (data.nimModel) document.getElementById("model-select").value = data.nimModel;
    if (data.nimMaxTokens) document.getElementById("max-tokens").value = data.nimMaxTokens;
    document.getElementById("confirm-forms").checked = data.confirmForms !== false;
    document.getElementById("confirm-nav").checked = data.confirmNav === true;
  }
);

// Save settings
document.getElementById("save-btn").addEventListener("click", () => {
  const settings = {
    nimApiKey: document.getElementById("api-key").value.trim(),
    perplexityApiKey: document.getElementById("perplexity-api-key").value.trim(),
    nimModel: document.getElementById("model-select").value,
    nimMaxTokens: parseInt(document.getElementById("max-tokens").value),
    confirmForms: document.getElementById("confirm-forms").checked,
    confirmNav: document.getElementById("confirm-nav").checked,
  };

  chrome.storage.sync.set(settings, () => {
    const statusEl = document.getElementById("status");
    statusEl.classList.add("visible");
    setTimeout(() => { statusEl.classList.remove("visible"); }, 2200);
  });
});

// Password show/hide toggles
function setupToggle(toggleId, inputId) {
  const toggle = document.getElementById(toggleId);
  const input = document.getElementById(inputId);
  toggle.addEventListener("click", () => {
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    toggle.textContent = isPassword ? "🙈" : "👁";
  });
}

setupToggle("toggle-key", "api-key");
setupToggle("toggle-pplx-key", "perplexity-api-key");

// Open Side Panel button
document.getElementById("open-panel-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" });
  window.close(); // Close popup after opening side panel
});

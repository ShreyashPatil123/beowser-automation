// Load saved settings on open
chrome.storage.sync.get(
  ["nimApiKey", "nimModel", "nimMaxTokens", "confirmForms", "confirmNav"],
  (data) => {
    if (data.nimApiKey) document.getElementById("api-key").value = data.nimApiKey;
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
    nimModel: document.getElementById("model-select").value,
    nimMaxTokens: parseInt(document.getElementById("max-tokens").value),
    confirmForms: document.getElementById("confirm-forms").checked,
    confirmNav: document.getElementById("confirm-nav").checked,
  };

  chrome.storage.sync.set(settings, () => {
    const status = document.getElementById("status");
    status.style.display = "block";
    setTimeout(() => { status.style.display = "none"; }, 2000);
  });
});

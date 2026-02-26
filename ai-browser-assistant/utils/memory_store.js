// ─────────────────────────────────────────────────────────────
// MEMORY STORE — Cross-tab context, session persistence
// Uses chrome.storage.session (in-memory, cleared on browser close)
// and chrome.storage.local (persists across sessions)
// ─────────────────────────────────────────────────────────────

export class MemoryStore {

  // ── SESSION MEMORY (cleared when browser closes) ────────────

  async setSession(key, value) {
    await chrome.storage.session.set({ [key]: value });
  }

  async getSession(key) {
    const result = await chrome.storage.session.get(key);
    return result[key] ?? null;
  }

  // ── CONVERSATION HISTORY ────────────────────────────────────

  async appendToHistory(tabId, message) {
    const key = `history_${tabId}`;
    const history = await this.getSession(key) || [];
    history.push({ ...message, timestamp: Date.now() });
    // Keep last 20 messages to avoid context overflow
    await this.setSession(key, history.slice(-20));
  }

  async getHistory(tabId) {
    return await this.getSession(`history_${tabId}`) || [];
  }

  async clearHistory(tabId) {
    await chrome.storage.session.remove(`history_${tabId}`);
  }

  // ── TAB CONTEXT CACHE ────────────────────────────────────────

  async cacheTabContext(tabId, context) {
    const key = `tab_ctx_${tabId}`;
    await this.setSession(key, { ...context, cachedAt: Date.now() });
  }

  async getCachedTabContext(tabId, maxAgeMs = 30000) {
    const key = `tab_ctx_${tabId}`;
    const cached = await this.getSession(key);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt > maxAgeMs) return null; // stale
    return cached;
  }

  // ── PERSISTENT PREFERENCES ──────────────────────────────────

  async savePreference(key, value) {
    await chrome.storage.sync.set({ [key]: value });
  }

  async getPreference(key, defaultValue = null) {
    const result = await chrome.storage.sync.get(key);
    return result[key] ?? defaultValue;
  }

  // ── ALL TAB CONTEXTS (for cross-tab reasoning) ──────────────

  async getAllTabContexts() {
    const tabs = await chrome.tabs.query({});
    const contexts = {};
    for (const tab of tabs) {
      const ctx = await this.getCachedTabContext(tab.id);
      if (ctx) contexts[tab.id] = { ...ctx, tabTitle: tab.title, tabUrl: tab.url };
    }
    return contexts;
  }
}

export const memory = new MemoryStore();

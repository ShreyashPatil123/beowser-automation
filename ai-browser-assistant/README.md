# NIM Browser Assistant

A Perplexity Comet-style AI assistant powered by NVIDIA NIM for Chrome and MS Edge.

This extension can read the current webpage, click elements, fill forms, scroll, and navigate on your behalf — all orchestrated by local state management and a powerful NIM LLM.

## Loading into Chrome / Edge

### Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the `ai-browser-assistant/` folder
5. Pin the extension from the puzzle icon
6. Click the extension icon → enter your `nvapi-xxx` key (from [build.nvidia.com](https://build.nvidia.com))
7. Click the extension icon to set your APIs and click the Side Panel icon or press `Ctrl+Shift+A` (Win) / `Cmd+Shift+A` (Mac) to open the assistant.

### Microsoft Edge

1. Open `edge://extensions/`
2. Enable "Developer mode" (bottom-left toggle)
3. Click "Load unpacked"
4. Select the `ai-browser-assistant/` folder

### Reload After Code Changes

1. Go to `chrome://extensions/`
2. Find the NIM Assistant extension
3. Click the ↺ refresh icon

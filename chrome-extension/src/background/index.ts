import 'webextension-polyfill';
import { exampleThemeStorage } from '@extension/storage';

exampleThemeStorage.get().then(theme => {
  console.log('theme', theme);
});

// Handle messages for BI event mapping
chrome.runtime.onMessage.addListener((message, sender) => {
  console.log('Background received message:', message, 'from:', sender);

  if (message.type === 'ELEMENT_SELECTED') {
    // Only forward to side panel, not back to content scripts to avoid loops
    chrome.runtime.sendMessage(message).catch(() => {
      // Ignore errors if no listeners
    });
  } else if (message.type === 'SELECTION_CANCELLED') {
    // Forward the cancellation message
    chrome.runtime.sendMessage(message).catch(() => {
      // Ignore errors if no listeners
    });
  }

  return false; // Don't keep message channel open
});

console.log('Background loaded');
console.log("Edit 'chrome-extension/src/background/index.ts' and save to reload.");

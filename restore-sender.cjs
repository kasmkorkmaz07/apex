'use strict';
const path = require('path');
const { fileURLToPath } = require('url');
module.exports = function isRestoreSender(event, expectedFile) {
  try {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    const url = new URL(event.senderFrame.url);
    if (url.protocol !== 'file:') return false;
    // loadFile appends apexDataDir as a query parameter. Compare the decoded
    // filesystem path, not the full URL suffix, while rejecting other frames.
    return path.resolve(fileURLToPath(url)).toLowerCase() === path.resolve(expectedFile).toLowerCase();
  } catch { return false; }
};

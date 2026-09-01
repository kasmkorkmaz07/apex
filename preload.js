const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apexDesktop', {
  getPaths: () => ipcRenderer.invoke('apex:get-paths'),
  readJson: (key, fallback = null) => ipcRenderer.invoke('apex:read-json', key, fallback),
  writeJson: (key, value) => ipcRenderer.invoke('apex:write-json', key, value),
  protectSecret: (value) => ipcRenderer.invoke('apex:protect-secret', value),
  unprotectSecret: (value) => ipcRenderer.invoke('apex:unprotect-secret', value),
  createBackup: (reason, payload = null) => ipcRenderer.invoke('apex:create-backup', reason, payload),
  saveInvoicePdf: (payload) => ipcRenderer.invoke('apex:save-invoice-pdf', payload),
  readInvoicePdf: (id) => ipcRenderer.invoke('apex:read-invoice-pdf', id),
  renderInvoicePdfPage: (payload) => ipcRenderer.invoke('apex:render-invoice-pdf-page', payload),
  listBackups: () => ipcRenderer.invoke('apex:list-backups'),
  openFolder: (name) => ipcRenderer.invoke('apex:open-folder', name),
  exportSnapshot: () => ipcRenderer.invoke('apex:export-snapshot'),
  getSyncServerInfo: () => ipcRenderer.invoke('apex:sync-server-info'),
  getMarketRates: () => ipcRenderer.invoke('apex:market-rates'),
  checkUpdate: () => ipcRenderer.invoke('apex:check-update'),
  downloadAndInstallUpdate: (update) => ipcRenderer.invoke('apex:download-and-install-update', update),
  onUpdateProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('apex:update-progress', listener);
    return () => ipcRenderer.removeListener('apex:update-progress', listener);
  },
  verifyProfilePassword: (password) => ipcRenderer.invoke('apex:verify-profile-password', password),
  openUpdateUrl: (url) => ipcRenderer.invoke('apex:open-update-url', url),
  openGibSession: () => ipcRenderer.invoke('apex:gib-open'),
  openGibUrl: (url) => ipcRenderer.invoke('apex:gib-open-url', url),
  openGibUrlVisible: (url) => ipcRenderer.invoke('apex:gib-open-url-visible', url),
  startGibTeachMode: (url) => ipcRenderer.invoke('apex:gib-teach-start', url),
  stopGibTeachMode: () => ipcRenderer.invoke('apex:gib-teach-stop'),
  getGibStatus: () => ipcRenderer.invoke('apex:gib-status'),
  searchGibDocs: (request) => ipcRenderer.invoke('apex:gib-search', request),
  scanGibRows: () => ipcRenderer.invoke('apex:gib-scan'),
  downloadGibDocs: (request) => ipcRenderer.invoke('apex:gib-download-docs', request),
  searchEbeyanApi: (request) => ipcRenderer.invoke('apex:ebeyan-api-search', request),
  openTahakkukGonder: () => ipcRenderer.invoke('apex:open-tahakkuk-gonder'),
  loadTahakkukGonder: () => ipcRenderer.invoke('apex:tahakkuk-load'),
  saveTahakkukGonder: (payload) => ipcRenderer.invoke('apex:tahakkuk-save', payload),
  scanTahakkukGonder: (request) => ipcRenderer.invoke('apex:tahakkuk-scan', request),
  chooseTahakkukFolder: () => ipcRenderer.invoke('apex:tahakkuk-choose-folder'),
  chooseTahakkukFiles: () => ipcRenderer.invoke('apex:tahakkuk-choose-files'),
  folderTahakkukFiles: (request) => ipcRenderer.invoke('apex:tahakkuk-folder-export', request),
  copyTahakkukFiles: (request) => ipcRenderer.invoke('apex:tahakkuk-copy-files', request),
  printTahakkukFiles: (request) => ipcRenderer.invoke('apex:tahakkuk-print-files', request),
  sendTahakkukGonder: (request) => ipcRenderer.invoke('apex:tahakkuk-send', request),
  convertWordToPdf: (filePath) => ipcRenderer.invoke('apex:word-to-pdf', filePath),
  startZirveInvoiceRobot: (request) => ipcRenderer.invoke('apex:zirve-invoice-start', request),
  getZirveInvoiceStatus: () => ipcRenderer.invoke('apex:zirve-invoice-status'),
  stopZirveInvoiceRobot: () => ipcRenderer.invoke('apex:zirve-invoice-stop')
});



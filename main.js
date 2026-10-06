const { app, BrowserWindow, shell, ipcMain, session } = require('electron');
const path = require('path');
const { Menu } = require('electron');
const { dialog } = require('electron');
const { safeStorage } = require('electron');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const os = require('os');
const crypto = require('crypto');

const APP_NAME = 'Apex';
const primaryInstance=app.requestSingleInstanceLock();
if(!primaryInstance)app.quit();
app.on('second-instance',(_event,args)=>{if(args.includes('--fis-asistani'))require('./receipt-desktop').standalone();else{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/app/index.html'));if(win){if(win.isMinimized())win.restore();win.focus();}else createWindow();}});
const READER_PORT = 8765;
const SYNC_PORT = 8788;
const DEFAULT_UPDATE_MANIFEST_URL = 'https://api.github.com/repos/kasmkorkmaz07/apex/releases/latest';
const PROFILE_PASSWORD_HASH = 'c371fdf89b42ef241ac9de343e0040bd2798f1db39dc525b4dd5934c7dde5d56';
let readerProcess = null;
let syncServer = null;
let gibWindow = null;
let gibTeachMode = { active: false, clicks: [] };
let zirveInvoiceRunStartedAt = 0;
let marketRatesCache = { at: 0, payload: null };
const DATA_FILES = {
  beyanname_takip_v6: 'main-store.json',
  beyanname_paket_programlar_deneme_v1: 'package-store.json',
  beyanname_takip_guvenli_yedekler_v1: 'backups.json',
  apex_settings: 'settings.json',
  apex_sync_settings: 'sync-settings.json'
};
const MAX_FILE_BACKUPS = 30;

function protectSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return `safe:${safeStorage.encryptString(text).toString('base64')}`;
    }
  } catch (err) {}
  return `plain:${Buffer.from(text, 'utf8').toString('base64')}`;
}

function unprotectSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  try {
    if (text.startsWith('safe:')) {
      return safeStorage.decryptString(Buffer.from(text.slice(5), 'base64'));
    }
    if (text.startsWith('plain:')) {
      return Buffer.from(text.slice(6), 'base64').toString('utf8');
    }
  } catch (err) {
    return '';
  }
  return text;
}

function runPowerShell(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, {
      windowsHide: true,
      ...options
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `PowerShell hata kodu: ${code}`).trim()));
    });
  });
}

async function convertWordDocumentToPdf(inputPath) {
  const sourcePath = String(inputPath || '').trim();
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('DOCX dosyasi secilemedi.');
  }
  if (!/\.docx$/i.test(sourcePath)) {
    throw new Error('Sadece DOCX dosyasi PDF olarak imzaya alinabilir.');
  }
  const outputDir = path.join(app.getPath('temp'), 'ApexWordToPdf');
  fs.mkdirSync(outputDir, { recursive: true });
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const outputPath = path.join(outputDir, `${baseName}-${Date.now()}.pdf`);
  const script = [
    '$inputPath = $args[0]',
    '$outputPath = $args[1]',
    '$word = $null',
    '$doc = $null',
    'try {',
    '  $word = New-Object -ComObject Word.Application',
    '  $word.Visible = $false',
    '  $word.DisplayAlerts = 0',
    '  $doc = $word.Documents.Open($inputPath, $false, $true)',
    '  $doc.ExportAsFixedFormat($outputPath, 17)',
    '} finally {',
    '  if ($doc -ne $null) { try { $doc.Close($false) } catch {} }',
    '  if ($word -ne $null) { try { $word.Quit() } catch {} }',
    '}',
    'if (!(Test-Path -LiteralPath $outputPath)) { throw "PDF olusturulamadi." }'
  ].join('; ');
  await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, sourcePath, outputPath]);
  const data = fs.readFileSync(outputPath);
  return {
    ok: true,
    inputPath: sourcePath,
    outputPath,
    fileName: `${baseName}.pdf`,
    base64: data.toString('base64')
  };
}

function updateDownloadPath(version) {
  const root = ensureApexFolders();
  const safeVersion = String(version || 'update').replace(/[^0-9a-z._-]/gi, '-');
  return path.join(root, 'updates', `Apex-Kurulum-${safeVersion}.exe`);
}

function appRoot() {
  return path.join(__dirname, 'app');
}

function appUnpackedRoot() {
  if (!app.isPackaged) return appRoot();
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'app');
}

function seedBundledDataFile(root, bundledName, targetName) {
  const target = path.join(root, 'data', targetName);
  if (fs.existsSync(target)) return;
  const source = path.join(appRoot(), bundledName);
  if (!fs.existsSync(source)) return;
  try {
    fs.copyFileSync(source, target);
  } catch (err) {}
}

function ensureKaseImzaHtml(root) {
  const relativeHtml = path.join('Paket Programlar', 'KASE-IMZA', 'imza-kase-masaustu.html');
  const target = path.join(root, relativeHtml);
  const source = path.join(appRoot(), relativeHtml);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) && fs.existsSync(source)) {
      fs.copyFileSync(source, target);
    }
  } catch (err) {
    console.warn('Kaşe İmza HTML yeniden oluşturulamadı:', err.message || err);
  }
}

function ensureApexFolders() {
  const documents = app.getPath('documents');
  const root = path.join(documents, 'Apex');
  for (const folder of ['data', 'backups', 'invoices', 'exports', 'logs', 'GIB-Evrak']) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
  }
  seedBundledDataFile(root, 'sync-settings-seed.json', 'sync-settings.json');
  ensureKaseImzaHtml(root);
  return root;
}

function invoicePdfStoreDir() {
  const dir = path.join(ensureApexFolders(), 'data', 'invoice-pdfs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanInvoicePdfId(value) {
  const id = String(value || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 120);
  if (!id) throw new Error('PDF kayıt numarası geçersiz.');
  return id.endsWith('.pdf') ? id.slice(0, -4) : id;
}

function invoicePdfPath(id) {
  return path.join(invoicePdfStoreDir(), `${cleanInvoicePdfId(id)}.pdf`);
}

function saveInvoicePdf(payload = {}) {
  const base64 = String(payload.base64 || '').replace(/^data:application\/pdf;base64,/i, '').replace(/\s+/g, '');
  if (!base64) throw new Error('PDF verisi boş.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.slice(0, 4).toString('latin1') !== '%PDF') {
    throw new Error('Kaydedilecek dosya geçerli PDF değil.');
  }
  const id = cleanInvoicePdfId(payload.id || crypto.randomUUID());
  const target = invoicePdfPath(id);
  fs.writeFileSync(target, buffer);
  return { ok: true, id, path: target, size: buffer.length };
}

function readInvoicePdf(id) {
  const target = invoicePdfPath(id);
  if (!fs.existsSync(target)) throw new Error('PDF dosyası Apex arşivinde bulunamadı. Faturayı tekrar yükleyin.');
  const buffer = fs.readFileSync(target);
  return { ok: true, id: cleanInvoicePdfId(id), base64: buffer.toString('base64'), size: buffer.length };
}

function popplerPdftoppmPath() {
  const candidates = [
    path.join(appUnpackedRoot(), 'tools', 'poppler', 'bin', 'pdftoppm.exe'),
    path.join(appRoot(), 'tools', 'poppler', 'bin', 'pdftoppm.exe'),
    'C:\\Users\\kasim\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe'
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || '';
}

function renderInvoicePdfPage(payload = {}) {
  const base64 = String(payload.base64 || '').replace(/^data:application\/pdf;base64,/i, '').replace(/\s+/g, '');
  if (!base64) throw new Error('PNG önizleme için PDF verisi yok.');
  const pdftoppm = popplerPdftoppmPath();
  if (!pdftoppm) throw new Error('Poppler PDF görüntüleyici Apex paketinde bulunamadı.');
  const page = Math.max(1, Math.min(9999, Number(payload.pageNumber || 1) || 1));
  const dpi = Math.max(120, Math.min(260, Number(payload.dpi || 190) || 190));
  const tempRoot = path.join(app.getPath('temp'), 'ApexPdfPreview');
  fs.mkdirSync(tempRoot, { recursive: true });
  const id = crypto.randomUUID();
  const pdfPath = path.join(tempRoot, `${id}.pdf`);
  const outPrefix = path.join(tempRoot, `${id}-page`);
  const pngPath = `${outPrefix}.png`;
  fs.writeFileSync(pdfPath, Buffer.from(base64, 'base64'));
  return new Promise((resolve, reject) => {
    const child = spawn(pdftoppm, ['-f', String(page), '-l', String(page), '-r', String(dpi), '-png', '-singlefile', pdfPath, outPrefix], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      try { fs.rmSync(pdfPath, { force: true }); } catch {}
      if (code !== 0) return reject(new Error((stderr || `Poppler hata kodu: ${code}`).trim()));
      try {
        const image = fs.readFileSync(pngPath);
        try { fs.rmSync(pngPath, { force: true }); } catch {}
        resolve({ ok: true, pageNumber: page, mime: 'image/png', base64: image.toString('base64'), size: image.length });
      } catch (err) {
        reject(new Error('PDF sayfası PNG olarak üretilemedi.'));
      }
    });
  });
}

function safeFilePart(value, fallback = 'Adsiz') {
  return String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || fallback;
}

function gibArchiveFolder(request) {
  const root = ensureApexFolders();
  const client = `${safeFilePart(request.clientName || 'Mukellef')} - ${safeFilePart(request.taxId || 'VKN-yok')}`;
  const year = safeFilePart(request.periodYear || new Date().getFullYear());
  const type = safeFilePart(request.declarationType || 'KDV1');
  const folder = path.join(root, 'GIB-Evrak', client, year, type);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function gibArchiveFilePath(request, docKind) {
  const month = String(request.periodMonth || '').padStart(2, '0');
  const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const period = `${safeFilePart(request.clientName || 'Mukellef')} ${monthNames[Number(request.periodMonth)] || month} ${request.periodYear}`;
  const kind = docKind === 'tahakkuk' ? 'TAHAKKUK' : 'BEYAN';
  const type = safeFilePart(request.declarationType || 'KDV1');
  return path.join(gibArchiveFolder(request), `${period} ${type} ${kind}.pdf`);
}

function powershellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function zirveRobotScriptPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'scripts', 'zirve-express-robot.ps1'),
    path.join(__dirname, 'scripts', 'zirve-express-robot.ps1'),
    path.join(app.getAppPath(), 'scripts', 'zirve-express-robot.ps1'),
    path.join(process.resourcesPath || '', 'app', 'scripts', 'zirve-express-robot.ps1')
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || candidates[0];
}

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function httpGetJson(url, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Apex/1.0',
        'Accept': 'application/json,text/plain,*/*'
      }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Zaman aşımı'));
    });
  });
}

function parseRateNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value)
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function pickRate(source, keys) {
  for (const key of keys) {
    const item = source && source[key];
    if (!item) continue;
    const buy = parseRateNumber(item.Alış || item.alis || item.buying || item.Buying || item.buy || item.alış);
    const sell = parseRateNumber(item.Satış || item.satis || item.selling || item.Selling || item.sell || item.satış);
    if (buy || sell) return { buy: buy || sell || 0, sell: sell || buy || 0 };
  }
  return null;
}

function normalizeMarketRates(raw) {
  return {
    updatedAt: new Date().toISOString(),
    source: 'finans.truncgil.com',
    rates: {
      usd: pickRate(raw, ['USD', 'Dolar', 'Amerikan Doları', 'Amerikan Doları']),
      eur: pickRate(raw, ['EUR', 'Euro']),
      gbp: pickRate(raw, ['GBP', 'İngiliz Sterlini', 'Sterlin']),
      gram: pickRate(raw, ['Gram Altın', 'Gram Altin', 'gram-altin']),
      quarter: pickRate(raw, ['Çeyrek Altın', 'Ceyrek Altin', 'ceyrek-altin'])
    }
  };
}

function hasAnyMarketRate(payload) {
  const rates = payload && payload.rates ? Object.values(payload.rates) : [];
  return rates.some(rate => rate && (Number(rate.buy) > 0 || Number(rate.sell) > 0));
}

function waitForDownload(savePath, timeoutMs = 30000) {
  const ses = gibWindow ? gibWindow.webContents.session : session.defaultSession;
  let timer = null;
  let settled = false;
  let onDownload = null;
  const promise = new Promise((resolve, reject) => {
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (onDownload) ses.removeListener('will-download', onDownload);
    };
    onDownload = (_event, item) => {
      if (settled) return;
      settled = true;
      cleanup();
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
      item.setSavePath(savePath);
      item.once('done', (_e, state) => {
        if (state === 'completed') resolve({ ok: true, path: savePath });
        else reject(new Error(`PDF indirilemedi: ${state}`));
      });
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('PDF indirme baÅŸlamadÄ±. GÄ°B oturumu aÃ§Ä±k mÄ± ve B/T simgesi tÄ±klanabilir mi?'));
    }, timeoutMs);
    ses.once('will-download', onDownload);
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (onDownload) ses.removeListener('will-download', onDownload);
    }
  };
}

function createGibWindow(options = {}) {
  if (gibWindow && !gibWindow.isDestroyed()) {
    if (options.show === false) gibWindow.hide();
    else gibWindow.focus();
    return gibWindow;
  }
  gibWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    title: 'Apex - GÄ°B Evrak Oturumu',
    backgroundColor: '#f3f4f6',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    show: options.show !== false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:apex-gib'
    }
  });
  gibWindow.on('closed', () => {
    if (gibTeachMode.active && gibTeachMode.clicks.length) {
      saveGibTeachModeClicks();
    }
    gibWindow = null;
  });
  gibWindow.webContents.on('console-message', (_event, _level, message) => {
    const marker = '__APEX_GIB_CLICK__';
    if (!gibTeachMode.active || typeof message !== 'string' || !message.startsWith(marker)) return;
    try {
      const payload = JSON.parse(message.slice(marker.length));
      gibTeachMode.clicks.push({
        ...payload,
        url: gibWindow && !gibWindow.isDestroyed() ? gibWindow.webContents.getURL() : '',
        at: new Date().toISOString()
      });
    } catch {}
  });
  gibWindow.webContents.on('did-finish-load', () => {
    if (gibTeachMode.active) injectGibTeachRecorder().catch(() => {});
  });
  gibWindow.webContents.on('did-create-window', childWindow => {
    gibWindow = childWindow;
    try {
      childWindow.setTitle('Apex - GİB Evrak Oturumu');
      childWindow.setMenuBarVisibility(false);
    } catch {}
    childWindow.on('closed', () => {
      if (gibWindow === childWindow) gibWindow = null;
    });
    childWindow.webContents.on('did-finish-load', () => {
      if (gibTeachMode.active) injectGibTeachRecorder().catch(() => {});
    });
    childWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) return { action: 'allow' };
      return { action: 'deny' };
    });
    childWindow.show();
    childWindow.focus();
  });
  gibWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) return { action: 'allow' };
    return { action: 'deny' };
  });
  return gibWindow;
}

function saveGibTeachModeClicks() {
  const payload = {
    updatedAt: new Date().toISOString(),
    clicks: gibTeachMode.clicks.slice(-50)
  };
  writeJsonFile(dataFilePath('gib_teach_steps'), payload);
  gibTeachMode.active = false;
  return payload;
}

async function injectGibTeachRecorder() {
  if (!gibWindow || gibWindow.isDestroyed()) return false;
  await gibWindow.webContents.executeJavaScript(`
(() => {
  if (window.__apexGibTeachInstalled) return true;
  window.__apexGibTeachInstalled = true;
  function cssPath(el) {
    if (!el || !el.tagName) return '';
    const parts = [];
    let node = el;
    for (let i = 0; i < 7 && node && node.nodeType === 1; i++) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + CSS.escape(node.id);
        parts.unshift(part);
        break;
      }
      const cls = Array.from(node.classList || []).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
      part += cls;
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(child => child.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }
  function clean(value) {
    return String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 180);
  }
  document.addEventListener('click', event => {
    const el = event.target;
    const payload = {
      selector: cssPath(el),
      text: clean([el.innerText, el.textContent, el.value, el.title, el.alt].join(' ')),
      href: clean(el.href || (el.closest && el.closest('a') && el.closest('a').href) || ''),
      tag: String(el.tagName || '').toLowerCase()
    };
    console.log('__APEX_GIB_CLICK__' + JSON.stringify(payload));
  }, true);
  return true;
})()
  `, true);
  return true;
}

const GIB_PAGE_SCRIPT = `
(() => {
  const wantedTexts = {
    b: ['beyanname', 'beyan', ' be ', ' b '],
    t: ['tahakkuk', ' tah ', ' t ']
  };
  function norm(value) {
    return String(value || '')
      .replace(/\\s+/g, ' ')
      .replace(/[Ã„Â°Ä°IÄ±]/g, 'i')
      .replace(/[ÄÄŸÃ„Å¸]/g, 'g')
      .replace(/[ÃœÃ¼ÃƒÂ¼]/g, 'u')
      .replace(/[ÅÅŸÃ…Å¸]/g, 's')
      .replace(/[Ã–Ã¶ÃƒÂ¶]/g, 'o')
      .replace(/[Ã‡Ã§ÃƒÂ§]/g, 'c')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('tr-TR')
      .trim();
  }
  function docs(win = window, out = []) {
    try { out.push(win.document); } catch (e) {}
    let frames = [];
    try { frames = Array.from(win.frames || []); } catch (e) {}
    frames.forEach(frame => docs(frame, out));
    return out;
  }
  function clickableInfo(row) {
    return Array.from(row.querySelectorAll('a, button, input[type="button"], img, span, i'))
      .filter(el => {
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 1, height: 1 };
        const text = norm([el.innerText, el.textContent, el.value, el.title, el.alt, el.getAttribute('aria-label'), el.getAttribute('src'), el.getAttribute('href')].join(' '));
        return text || rect.width || rect.height;
      })
      .map((el, index) => {
        const raw = [el.innerText, el.textContent, el.value, el.title, el.alt, el.getAttribute('aria-label'), el.getAttribute('src'), el.getAttribute('href')].join(' ');
        const text = norm(raw);
        const compact = text.replace(/[^a-z0-9]/gi, '');
        const isB = text.includes('beyanname') || compact === 'b' || /(^|\\s)b($|\\s)/.test(text);
        const isT = text.includes('tahakkuk') || compact === 't' || /(^|\\s)t($|\\s)/.test(text);
        return { index, text, isB, isT };
      });
  }
  function collectRows() {
    const all = [];
    docs().forEach((doc, docIndex) => {
      Array.from(doc.querySelectorAll('tr')).forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('td, th')).map(cell => cell.innerText || cell.textContent || '');
        const joined = norm(cells.join(' '));
        if (cells.length < 6 || !joined) return;
        if (!/kdv|muh|geÃ§ici|gecici|kurum|gelir|beyan|onay|tahakkuk/.test(joined)) return;
        const clickables = clickableInfo(row);
        all.push({ docIndex, rowIndex, cells, clickables });
      });
    });
    return all;
  }
  function clickDocRow(globalIndex, kind) {
    const rowInfo = collectRows()[globalIndex];
    if (!rowInfo) return { ok: false, error: 'SatÄ±r bulunamadÄ±.' };
    const doc = docs()[rowInfo.docIndex];
    const row = Array.from(doc.querySelectorAll('tr'))[rowInfo.rowIndex];
    if (!row) return { ok: false, error: 'SatÄ±r tekrar bulunamadÄ±.' };
    const clickables = Array.from(row.querySelectorAll('a, button, input[type="button"], img, span, i'));
    const infos = clickableInfo(row);
    let found = infos.find(item => kind === 'beyanname' ? item.isB : item.isT);
    if (!found && kind === 'beyanname') found = infos[infos.length - 2] || infos[0];
    if (!found && kind === 'tahakkuk') found = infos[infos.length - 1] || infos[1] || infos[0];
    const el = found ? clickables[found.index] : null;
    if (!el) return { ok: false, error: kind + ' simgesi bulunamadÄ±.' };
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { ok: true };
  }
  function gibStatusCell(row) {
    const cells = Array.from(row.querySelectorAll('td, th'));
    return cells.find(cell => /onay|tahakkuk/.test(norm(cell.innerText || cell.textContent || ''))) || cells[cells.length - 2] || row;
  }
  function gibStatusPdfOrder(row) {
    return Array.from(gibStatusCell(row).querySelectorAll('a, button, input[type="button"], img, span, i'))
      .filter(el => {
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0, left: 0 };
        const tag = String(el.tagName || '').toLowerCase();
        const text = norm([el.innerText, el.textContent, el.value, el.title, el.alt, el.getAttribute('aria-label'), el.getAttribute('src'), el.getAttribute('href')].join(' '));
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (/^onaylandi$|^onaylandÃ„Â±$|^onaylandÄ±$/.test(text)) return false;
        return /pdf|beyan|tahakkuk|dosya|indir/.test(text) || tag === 'img' || tag === 'a' || !!el.onclick || !!(el.getAttribute && el.getAttribute('href'));
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      .slice(-2);
  }
  clickableInfo = function(row) {
    const allEls = Array.from(row.querySelectorAll('a, button, input[type="button"], img, span, i'));
    const pdfOrder = gibStatusPdfOrder(row);
    return allEls
      .filter(el => {
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 1, height: 1 };
        const text = norm([el.innerText, el.textContent, el.value, el.title, el.alt, el.getAttribute('aria-label'), el.getAttribute('src'), el.getAttribute('href')].join(' '));
        return text || rect.width || rect.height;
      })
      .map((el, index) => {
        const raw = [el.innerText, el.textContent, el.value, el.title, el.alt, el.getAttribute('aria-label'), el.getAttribute('src'), el.getAttribute('href')].join(' ');
        const text = norm(raw);
        const compact = text.replace(/[^a-z0-9]/gi, '');
        let isB = text.includes('beyanname') || compact === 'b' || /(^|\\s)b($|\\s)/.test(text);
        let isT = text.includes('tahakkuk') || compact === 't' || /(^|\\s)t($|\\s)/.test(text);
        if (!isB && !isT && pdfOrder.length === 2) {
          if (el === pdfOrder[0]) isB = true;
          if (el === pdfOrder[1]) isT = true;
        }
        return { index, text, isB, isT };
      });
  };
  collectRows = function() {
    const all = [];
    docs().forEach((doc, docIndex) => {
      Array.from(doc.querySelectorAll('tr')).forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('td, th')).map(cell => cell.innerText || cell.textContent || '');
        const joined = norm(cells.join(' '));
        if (cells.length < 6 || !joined) return;
        const taxId = (joined.match(/\b\d{10,11}\b/) || [])[0];
        const hasPeriod = /\b\d{1,2}[./]\d{4}\b/.test(joined);
        const hasType = /\bkdv\d?\b|katma deger|muh|gecici|kurum|gelir|beyanname/.test(joined);
        if (!taxId || !hasPeriod || !hasType) return;
        const clickables = clickableInfo(row);
        all.push({ docIndex, rowIndex, cells, clickables });
      });
    });
    return all;
  };
  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  function modalText() {
    return norm(Array.from(document.querySelectorAll('[role="dialog"], .modal, .mat-dialog-container, .cdk-overlay-pane, .ant-modal, .MuiDialog-root, body'))
      .filter(visible)
      .map(el => el.innerText || el.textContent || '')
      .join(' '));
  }
  function clickVisibleByNeedles(needles) {
    const normalized = needles.map(norm);
    const items = allInteractive().filter(item => normalized.some(n => item.text.includes(n) || item.ctx.includes(n)));
    if (!items.length) return false;
    items.sort((a, b) => {
      const at = String(a.el.tagName || '').toLowerCase();
      const bt = String(b.el.tagName || '').toLowerCase();
      const aButton = /button|a/.test(at) ? 20 : 0;
      const bButton = /button|a/.test(bt) ? 20 : 0;
      const aExact = normalized.some(n => a.text === n) ? 10 : 0;
      const bExact = normalized.some(n => b.text === n) ? 10 : 0;
      return (bButton + bExact) - (aButton + aExact);
    });
    return clickElement(items[0]);
  }
  function isDijitalLoginPage() {
    const url = norm(location.href || '');
    const text = norm((document.body && document.body.innerText) || '');
    return url.includes('dijital.gib.gov.tr/portal/login') || (/dogrulama kodu/.test(text) && /giris yap/.test(text));
  }
  function inputCandidates() {
    return allInteractive()
      .filter(item => /input|textarea/i.test(item.el.tagName || ''))
      .filter(item => {
        const inputType = norm(item.el.type || 'text');
        return !/hidden|checkbox|radio|button|submit|image/.test(inputType);
      })
      .map(item => ({ ...item, type: norm(item.el.type || 'text') }));
  }
  function findLoginField(needles, type = '', fallback = '') {
    const normalized = needles.map(norm);
    const items = inputCandidates();
    const matched = items.find(item => {
      const inputType = norm(item.el.type || '');
      if (type && inputType !== type) return false;
      if (!type && /password|checkbox|radio|button|submit/.test(inputType)) return false;
      return normalized.some(n => item.ctx.includes(n) || item.text.includes(n));
    });
    if (matched) return matched;
    if (fallback === 'user') return items.find(item => !/password/.test(item.type));
    if (fallback === 'password') return items.find(item => /password/.test(item.type));
    if (fallback === 'captcha') {
      const nonPassword = items.filter(item => !/password/.test(item.type));
      return nonPassword.find(item => /dogrulama|captcha|kod/.test(item.ctx + ' ' + item.text))
        || nonPassword[1]
        || nonPassword[0];
    }
    return null;
  }
  function clickExactCard(label) {
    const wanted = norm(label);
    const items = allInteractive().filter(item => {
      const tag = String(item.el.tagName || '').toLowerCase();
      const text = norm(item.text || '');
      const ctx = norm(item.ctx || '');
      return (text === wanted || ctx.includes(wanted)) && /a|button|div|span|li|img/.test(tag);
    });
    if (!items.length) return false;
    items.sort((a, b) => {
      const ar = a.el.getBoundingClientRect ? a.el.getBoundingClientRect() : { width: 0, height: 0 };
      const br = b.el.getBoundingClientRect ? b.el.getBoundingClientRect() : { width: 0, height: 0 };
      const aExact = norm(a.text) === wanted ? 40 : 0;
      const bExact = norm(b.text) === wanted ? 40 : 0;
      return (bExact + br.width * br.height / 10000) - (aExact + ar.width * ar.height / 10000);
    });
    return clickElement(items[0]);
  }
  function fillDijitalLogin(params) {
    if (!isDijitalLoginPage()) return null;
    const user = String(params.gibUser || '').trim();
    const password = String(params.gibPassword || '').trim();
    const userField = findLoginField(['tc kimlik', 'vergi kimlik', 'kullanici kodu', 'kullanıcı kodu'], '', 'user');
    const passwordField = findLoginField(['sifre', 'şifre'], 'password', 'password');
    const captchaField = findLoginField(['dogrulama kodu', 'doğrulama kodu', 'captcha'], '', 'captcha');
    const userOk = user && userField ? setValue(userField.el, user) : false;
    const passOk = password && passwordField ? setValue(passwordField.el, password) : false;
    const captchaValue = String(captchaField && captchaField.el && captchaField.el.value || '').trim();
    if (!captchaValue) {
      if (captchaField && captchaField.el && captchaField.el.focus) captchaField.el.focus();
      return {
        ok: false,
        dijitalLogin: true,
        waitingCaptcha: true,
        userOk,
        passOk,
        message: userOk || passOk
          ? 'GİB kullanıcı kodu ve şifre yazıldı. Doğrulama kodunu elle girip Giriş Yap düğmesine basın; Apex otomatik devam edecek.'
          : 'GİB giriş alanları bulunamadı. Kullanıcı kodu/şifreyi elle girip doğrulama kodundan sonra Giriş Yap deyin; Apex otomatik devam edecek.'
      };
    }
    const loginClicked = clickVisibleByNeedles(['Giriş Yap', 'Giris Yap']);
    return {
      ok: Boolean(loginClicked || userOk || passOk),
      dijitalLogin: true,
      loginClicked,
      userOk,
      passOk,
      message: loginClicked ? 'GİB giriş düğmesine basıldı. Oturum açılınca işlem otomatik devam edecek.' : 'GİB giriş bilgileri yazıldı fakat Giriş Yap düğmesi bulunamadı.'
    };
  }
  async function continueDijitalToEbeyan(params) {
    const login = fillDijitalLogin(params || {});
    if (login) return login;
    const url = norm(location.href || '');
    const text = norm((document.body && document.body.innerText) || '');
    if (/yonlendirmeyi onayliyor musunuz|yönlendirmeyi onaylıyor musunuz/.test(text)) {
      const ok = clickVisibleByNeedles(['Onayla', 'Tamam', 'Evet']);
      return { ok, dijitalStep: 'confirm', message: ok ? 'e-Beyan geçiş onayı verildi.' : 'e-Beyan geçiş onayı görüldü fakat Onayla düğmesi tıklanamadı.' };
    }
    if (/dijital\.gib\.gov\.tr/.test(url)) {
      if (/gecis yapilabilecek uygulamalar|geçiş yapılabilecek uygulamalar|e-beyan/.test(text)) {
        let ok = clickTextNode(['e-Beyan', 'e Beyan']) || clickExactCard('e-Beyan') || clickVisibleByNeedles(['e-Beyan', 'e Beyan']);
        if (ok) {
          for (let i = 0; i < 12; i++) {
            await wait(350);
            const confirmText = norm((document.body && document.body.innerText) || '');
            if (/yonlendirmeyi onayliyor musunuz|yönlendirmeyi onaylıyor musunuz|devam etmek istiyor musunuz/.test(confirmText)) {
              clickVisibleByNeedles(['Onayla', 'Tamam', 'Evet']);
              break;
            }
          }
        }
        return { ok, dijitalStep: 'ebeyan-card', message: ok ? 'Dijital Vergi Dairesi üzerinden e-Beyan kartına tıklandı.' : 'Dijital Vergi Dairesi açık ama e-Beyan kartı bulunamadı.' };
      }
      return { ok: false, dijitalStep: 'dijital-wait', waitingPortal: true, message: 'Dijital Vergi Dairesi yükleniyor veya giriş bekleniyor.' };
    }
    if (/ebeyan\.gib\.gov\.tr/.test(url) && !/\/beyannameler/i.test(location.href || '')) {
      if (!/beyannameler/.test(text) || /hizli menu|hızlı menü|mukellef sec|mükellef seç/.test(text)) {
        let ok = false;
        for (let i = 0; i < 10 && !ok; i++) {
          clickVisibleByNeedles(['Hızlı Menü', 'Hizli Menu']);
          await wait(500);
          ok = clickVisibleByNeedles(['Beyannameler']);
          if (!ok) await wait(500);
        }
        if (ok) await wait(1600);
        return { ok, dijitalStep: 'quick-menu', message: ok ? 'e-Beyan Hızlı Menüden Beyannameler açıldı.' : 'e-Beyan açıldı fakat Hızlı Menü / Beyannameler seçilemedi.' };
      }
    }
    return null;
  }
  async function openNewEDeclarationPdfModal(row) {
    if (/pdf indir/.test(modalText())) return true;
    const cells = Array.from(row.querySelectorAll('td, th'));
    const actionCell = cells[cells.length - 1] || row;
    const actionCandidates = Array.from(actionCell.querySelectorAll('button, a, span, i, div'))
      .filter(el => {
        if (!visible(el)) return false;
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0, left: 0 };
        const text = norm([el.innerText, el.textContent, el.title, el.getAttribute && el.getAttribute('aria-label')].join(' '));
        return rect.width > 0 && rect.height > 0 && (/islem|işlem|menu|more|nokta|pdf|listele/.test(text) || rect.width <= 80);
      })
      .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
    const action = actionCandidates[0];
    if (!action) return false;
    clickElement({ el: action });
    await wait(350);
    if (!clickVisibleByNeedles(['PDF Listele', 'PDF Listesi', 'PDF'])) {
      clickElement({ el: action });
      await wait(350);
      clickVisibleByNeedles(['PDF Listele', 'PDF Listesi', 'PDF']);
    }
    for (let i = 0; i < 20; i++) {
      if (/pdf indir/.test(modalText())) return true;
      await wait(150);
    }
    return /beyanname indir|tahakkuk/.test(modalText());
  }
  async function clickNewEDeclarationPdf(kind) {
    const needles = kind === 'beyanname'
      ? ['Beyanname İndir', 'Beyanname Indir']
      : ['Tahakkuk Fişi İndir', 'Tahakkuk Fisi Indir', 'Tahakkuk İndir', 'Tahakkuk Indir'];
    for (let i = 0; i < 20; i++) {
      if (clickVisibleByNeedles(needles)) return true;
      await wait(150);
    }
    return false;
  }
  clickDocRow = async function(globalIndex, kind) {
    const rowInfo = collectRows()[globalIndex];
    if (!rowInfo) return { ok: false, error: 'SatÃ„Â±r bulunamadÃ„Â±.' };
    const doc = docs()[rowInfo.docIndex];
    const row = Array.from(doc.querySelectorAll('tr'))[rowInfo.rowIndex];
    if (!row) return { ok: false, error: 'SatÃ„Â±r tekrar bulunamadÃ„Â±.' };
    const clickables = Array.from(row.querySelectorAll('a, button, input[type="button"], img, span, i'));
    const infos = clickableInfo(row);
    let found = infos.find(item => kind === 'beyanname' ? item.isB : item.isT);
    if (!found) {
      const ordered = gibStatusPdfOrder(row);
      const target = kind === 'beyanname' ? ordered[0] : ordered[1];
      if (target) found = { index: clickables.indexOf(target), text: '', isB: kind === 'beyanname', isT: kind === 'tahakkuk' };
    }
    const el = found ? clickables[found.index] : null;
    if (!el) {
      const modalOk = await openNewEDeclarationPdfModal(row);
      if (!modalOk) return { ok: false, error: 'PDF Listele menüsü açılamadı.' };
      const clicked = await clickNewEDeclarationPdf(kind);
      return clicked ? { ok: true, mode: 'new-ebeyan' } : { ok: false, error: kind + ' indirme düğmesi bulunamadı.' };
    }
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { ok: true };
  };
  function visible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }
  function fire(el) {
    try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: String(el.value || '') })); } catch (e) {}
    ['input', 'change', 'keyup', 'blur'].forEach(type => el.dispatchEvent(new Event(type, { bubbles: true })));
  }
  function setValue(el, value) {
    if (!el) return false;
    try { el.scrollIntoView && el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    try { el.click && el.click(); } catch (e) {}
    el.focus && el.focus();
    const tag = String(el.tagName || '').toLowerCase();
    const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
    try { if (setter) setter.call(el, ''); else el.value = ''; fire(el); } catch (e) {}
    if (setter) setter.call(el, value);
    else el.value = value;
    try { el.setAttribute('value', value); } catch (e) {}
    fire(el);
    return String(el.value || '') === String(value || '');
  }
  function elementText(el) {
    return norm([
      el && el.innerText,
      el && el.textContent,
      el && el.value,
      el && el.title,
      el && el.alt,
      el && el.getAttribute && el.getAttribute('aria-label'),
      el && el.getAttribute && el.getAttribute('placeholder'),
      el && el.getAttribute && el.getAttribute('name'),
      el && el.getAttribute && el.getAttribute('id'),
      el && el.getAttribute && el.getAttribute('href')
    ].join(' '));
  }
  function contextText(el) {
    const parts = [elementText(el)];
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      node = node.parentElement;
      if (node) parts.push(elementText(node));
    }
    return norm(parts.join(' '));
  }
  function allInteractive() {
    const list = [];
    docs().forEach((doc, docIndex) => {
      Array.from(doc.querySelectorAll('a, button, input, select, textarea, img, span, div, li, td, th, label')).forEach((el, index) => {
        if (!visible(el)) return;
        list.push({ docIndex, index, el, text: elementText(el), ctx: contextText(el) });
      });
    });
    return list;
  }
  function clickElement(item) {
    let el = item && item.el;
    if (!el) return false;
    const original = el;
    for (let i = 0; i < 6 && el; i++) {
      const tag = String(el.tagName || '').toLowerCase();
      const role = norm(el.getAttribute && el.getAttribute('role'));
      const style = getComputedStyle(el);
      if (tag === 'a' || tag === 'button' || role === 'button' || el.onclick || style.cursor === 'pointer') break;
      el = el.parentElement;
    }
    if (!el) el = original;
    const targets = [];
    let node = original;
    for (let i = 0; i < 10 && node; i++) {
      targets.push(node);
      if (node === el) break;
      node = node.parentElement;
    }
    if (!targets.includes(el)) targets.push(el);
    targets.forEach(target => {
      try {
        target.scrollIntoView && target.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
        const point = { clientX: rect.left + Math.max(1, rect.width / 2), clientY: rect.top + Math.max(1, rect.height / 2) };
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, ...point }));
        target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, ...point }));
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ...point }));
        target.click && target.click();
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, ...point }));
        target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, ...point }));
      } catch (e) {}
    });
    return true;
  }
  function clickByNeedles(needles) {
    const normalized = needles.map(norm);
    const items = allInteractive().filter(item => normalized.some(n => item.text.includes(n) || item.ctx.includes(n)));
    const scored = items.map(item => {
      const tag = String(item.el.tagName || '').toLowerCase();
      const exact = normalized.some(n => item.text === n || item.text.includes(n));
      const clickable = tag === 'a' || tag === 'button' || item.el.onclick || (getComputedStyle(item.el).cursor === 'pointer');
      const card = /card|uygulama|application|swiper|item|menu/i.test(String(item.el.className || ''));
      return { item, score: (exact ? 20 : 0) + (clickable ? 10 : 0) + (card ? 6 : 0) + (tag === 'img' ? 2 : 0) };
    }).sort((a, b) => b.score - a.score);
    const preferred = scored[0] && scored[0].item;
    return preferred ? clickElement(preferred) : false;
  }
  function clickTextNode(needles) {
    const normalized = needles.map(norm);
    for (const doc of docs()) {
      const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = norm(node.nodeValue || '');
        if (!text || !normalized.some(n => text === n || text.includes(n))) continue;
        let el = node.parentElement;
        let best = el;
        for (let i = 0; i < 8 && el; i++) {
          const tag = String(el.tagName || '').toLowerCase();
          const role = norm(el.getAttribute && el.getAttribute('role'));
          const cls = String(el.className || '');
          const style = getComputedStyle(el);
          if (tag === 'a' || tag === 'button' || tag === 'li' || role === 'button' || el.onclick || style.cursor === 'pointer' || /menu|item|link|card|col|panel/i.test(cls)) {
            best = el;
          }
          el = el.parentElement;
        }
        return clickElement({ el: best });
      }
    }
    return false;
  }
  function clickExactEBeyanname() {
    const items = allInteractive().filter(item => {
      const text = item.text;
      const ctx = item.ctx;
      const tag = String(item.el.tagName || '').toLowerCase();
      if (text !== 'e-beyanname' && !/(^|\s)e[\s-]*beyanname($|\s)/.test(ctx)) return false;
      if (/yetki|test|ara|taslak|paket/.test(text) && text !== 'e-beyanname') return false;
      if (/a|button|li|td|div|span/.test(tag)) return true;
      return item.el.onclick || getComputedStyle(item.el).cursor === 'pointer';
    });
    const preferred = items.sort((a, b) => {
      const at = /a|button|li/.test(String(a.el.tagName || '').toLowerCase()) ? 10 : 0;
      const bt = /a|button|li/.test(String(b.el.tagName || '').toLowerCase()) ? 10 : 0;
      return bt - at;
    })[0];
    return preferred ? clickElement(preferred) : false;
  }
  function forceOpenEBeyannameByLink() {
    const candidates = allInteractive().filter(item => {
      const text = item.text;
      const ctx = item.ctx;
      const tag = String(item.el.tagName || '').toLowerCase();
      const raw = norm([
        item.el && item.el.getAttribute && item.el.getAttribute('href'),
        item.el && item.el.getAttribute && item.el.getAttribute('onclick'),
        item.el && item.el.getAttribute && item.el.getAttribute('data-url'),
        item.el && item.el.getAttribute && item.el.getAttribute('title'),
        text,
        ctx
      ].join(' '));
      if (/yetki|test/.test(raw)) return false;
      if (/(^|\s)e[\s-]*beyanname($|\s)/.test(text) || /(^|\s)e[\s-]*beyanname($|\s)/.test(ctx)) return true;
      if (/ebeyanname|e beyanname|e-beyanname/.test(raw) && /a|button|li|td|div|span|img/.test(tag)) return true;
      return raw.includes('beyanname islemleri') && raw.includes('e');
    });
    if (!candidates.length) return false;
    candidates.sort((a, b) => {
      const aText = a.text === 'e-beyanname' ? 40 : 0;
      const bText = b.text === 'e-beyanname' ? 40 : 0;
      const aTag = /a|button|li/.test(String(a.el.tagName || '').toLowerCase()) ? 10 : 0;
      const bTag = /a|button|li/.test(String(b.el.tagName || '').toLowerCase()) ? 10 : 0;
      return (bText + bTag) - (aText + aTag);
    });
    return clickElement(candidates[0]);
  }
  function clickStrictLabel(label) {
    const variants = [label, label.replace(/-/g, ' '), label.replace(/\s+/g, '-')];
    return clickTextNode(variants) || clickByNeedles(variants);
  }
  function clickTaughtStep(stage) {
    const steps = Array.isArray(window.__apexGibTaughtClicks) ? window.__apexGibTaughtClicks : [];
    if (!steps.length) return false;
    const items = allInteractive();
    const currentText = norm((document.body && document.body.innerText) || '');
    const wantsAra = stage === 'ara';
    const wantsApp = stage === 'app';
    const usable = steps.filter(step => {
      const label = norm([step.text, step.href, step.selector].join(' '));
      if (!label) return false;
      const isAra = label.includes('beyanname ara');
      const isApp = label.includes('e-beyanname') || label.includes('e beyanname') || label.includes('ebeyanname');
      if (wantsAra && !isAra) return false;
      if (wantsApp && isAra) return false;
      if (wantsApp && !isApp && steps.some(saved => norm([saved.text, saved.href, saved.selector].join(' ')).includes('e-beyanname'))) return false;
      return true;
    });
    for (const step of usable) {
      let el = null;
      try { if (step.selector) el = document.querySelector(step.selector); } catch (e) {}
      if (!el && step.text) {
        const wanted = norm(step.text);
        const found = items.find(item => item.text === wanted || item.ctx.includes(wanted));
        el = found && found.el;
      }
      if (el && visible(el)) {
        clickElement({ el });
        return true;
      }
    }
    return false;
  }
  function findTaxInput() {
    const inputs = allInteractive().filter(item => /input|textarea/i.test(item.el.tagName) && !/password|date|checkbox|radio|button|submit/i.test(item.el.type || ''));
    return inputs.find(item => /vergi kimlik|vergi no|vkn|tckn|tc kimlik|mukellef vkn/.test(item.ctx) && !/yardimci olabilir|arama yap/.test(item.ctx));
  }
  function checkByLabel(labelNeedles, checked = true) {
    const needles = labelNeedles.map(norm);
    const checkables = allInteractive().filter(item => /input/i.test(item.el.tagName) && /checkbox|radio/i.test(item.el.type || ''));
    const item = checkables.find(candidate => needles.some(n => candidate.ctx.includes(n) || candidate.text.includes(n)));
    if (!item) return false;
    if (item.el.checked !== checked) {
      item.el.click();
      fire(item.el);
    }
    return true;
  }
  function selectApprovedStatus() {
    const radios = allInteractive().filter(item => /input/i.test(item.el.tagName) && /radio/i.test(item.el.type || ''));
    const item = radios.find(candidate => /onaylandi/.test(candidate.ctx));
    if (!item) return false;
    if (!item.el.checked) {
      item.el.click();
      fire(item.el);
    }
    return true;
  }
  function formatDateTr(date) {
    return [
      String(date.getDate()).padStart(2, '0'),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getFullYear())
    ].join('/');
  }
  function setDateLike(el, date) {
    if (!el) return false;
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const value = (el.type || '').toLowerCase() === 'date' ? (yyyy + '-' + mm + '-' + dd) : (dd + '/' + mm + '/' + yyyy);
    return setValue(el, value);
  }
  function fillUploadDateRange(periodMonth, periodYear) {
    checkByLabel(['YÃ¼kleme Tarih AralÄ±ÄŸÄ±', 'Yukleme Tarih Araligi']);
    const uploadStart = new Date(Number(periodYear), Number(periodMonth), 1);
    const uploadEnd = new Date(Number(periodYear), Number(periodMonth) + 1, 0);
    const dateItems = allInteractive().filter(item => /input/i.test(item.el.tagName) && /date|text|tel/i.test(item.el.type || 'text'));
    let startItem = dateItems.find(item => /baslangic tarihi|baslangic/.test(item.ctx));
    let endItem = dateItems.find(item => /bitis tarihi|bitis/.test(item.ctx));
    if (!startItem || !endItem) {
      const uploadItems = dateItems.filter(item => /yukleme|tarih araligi|baslangic|bitis/.test(item.ctx));
      startItem = startItem || uploadItems[0];
      endItem = endItem || uploadItems.find(item => item !== startItem) || uploadItems[1];
    }
    const startOk = startItem ? setDateLike(startItem.el, uploadStart) : false;
    const endOk = endItem ? setDateLike(endItem.el, uploadEnd) : false;
    return {
      ok: Boolean(startOk || endOk),
      start: formatDateTr(uploadStart),
      end: formatDateTr(uploadEnd)
    };
  }
  function fillTaxId(taxId) {
    checkByLabel(['Vergi Kimlik NumarasÄ±', 'Vergi Kimlik Numarasi', 'VKN']);
    const targeted = findTaxInput();
    return targeted ? setValue(targeted.el, taxId) : false;
  }
  function fillDeclarationType(type) {
    checkByLabel(['Beyanname TÃ¼rÃ¼', 'Beyanname Turu']);
    const typeKey = norm(type).replace(/[^a-z0-9]/gi, '');
    const aliases = {
      kdv1: ['katma deger vergisi beyannamesi 1', 'kdv1'],
      kdv2: ['katma deger vergisi beyannamesi 2', 'kdv2'],
      muhsgk: ['muhtasar ve prim hizmet beyannamesi', 'muhsgk'],
      gecici: ['gecici vergi beyannamesi'],
      kurumlar: ['kurumlar vergisi beyannamesi'],
      gelir: ['gelir vergisi beyannamesi']
    };
    const wantedList = (aliases[typeKey] || [type]).map(item => norm(item).replace(/[^a-z0-9]/gi, ''));
    const selects = allInteractive().filter(item => /select/i.test(item.el.tagName));
    for (const item of selects) {
      const options = Array.from(item.el.options || []);
      const option = options.find(opt => {
        const text = norm(opt.text + ' ' + opt.value).replace(/[^a-z0-9]/gi, '');
        return wantedList.some(wanted => text.includes(wanted));
      });
      if (option) {
        item.el.value = option.value;
        fire(item.el);
        return true;
      }
    }
    const inputs = allInteractive().filter(item => /input|textarea/i.test(item.el.tagName) && !/password|date|checkbox|radio|button|submit/i.test(item.el.type || ''));
    const targeted = inputs.find(item => /beyanname tur|beyanname tipi|beyanname/.test(item.ctx));
    return targeted ? setValue(targeted.el, type) : false;
  }
  function fillPeriod(month, year) {
    checkByLabel(['Vergilendirme Donemi']);
    const mm = String(month).padStart(2, '0');
    const period = mm + '/' + year;
    let ok = false;
    const selects = allInteractive().filter(item => /select/i.test(item.el.tagName));
    for (const item of selects) {
      const ctx = item.ctx;
      const options = Array.from(item.el.options || []);
      if (/ay|donem/.test(ctx)) {
        const monthName = ['', 'ocak','subat','mart','nisan','mayis','haziran','temmuz','agustos','eylul','ekim','kasim','aralik'][Number(month)] || '';
        const opt = options.find(o => String(o.value) === String(month) || String(o.value) === mm);
        const byText = options.find(o => norm(o.text).includes(norm(monthName)));
        if (opt || byText) {
          item.el.value = (opt || byText).value;
          fire(item.el);
          ok = true;
        }
      }
      if (/yil|sene/.test(ctx)) {
        const opt = options.find(o => String(o.value) === String(year) || norm(o.text).includes(String(year)));
        if (opt) {
          item.el.value = opt.value;
          fire(item.el);
          ok = true;
        }
      }
    }
    const inputs = allInteractive().filter(item => /input|textarea/i.test(item.el.tagName) && !/password|checkbox|radio|button|submit/i.test(item.el.type || ''));
    const periodInput = inputs.find(item => /vergilendirme donemi|donem/.test(item.ctx));
    if (periodInput) ok = setValue(periodInput.el, period) || ok;
    const yearInput = inputs.find(item => /yil|sene/.test(item.ctx));
    if (yearInput && yearInput !== periodInput) ok = setValue(yearInput.el, String(year)) || ok;
    return ok;
  }
  function isNewEBeyanDeclarationsPage() {
    const text = norm((document.body && document.body.innerText) || '');
    const url = norm(location.href || '');
    return url.includes('ebeyan.gib.gov.tr/beyannameler')
      || (/beyannameler/.test(text) && /filtre/.test(text) && (/islemler/.test(text) || /durumu/.test(text)));
  }
  function isNewEBeyanReady() {
    const text = norm((document.body && document.body.innerText) || '');
    return /beyannameler/.test(text) && /filtre/.test(text) && (/onaylandi|onay bekliyor|taslak|durum|mukellef/.test(text));
  }
  function newPeriodDates(month, year) {
    const start = new Date(Number(year), Number(month) - 1, 1);
    const end = new Date(Number(year), Number(month), 0);
    return { start: formatDateTr(start), end: formatDateTr(end) };
  }
  function findInputByNeedles(needles) {
    const normalized = needles.map(norm);
    const inputs = allInteractive().filter(item => /input|textarea/i.test(item.el.tagName) && !/password|checkbox|radio|button|submit/i.test(item.el.type || ''));
    return inputs.find(item => normalized.some(n => item.ctx.includes(n) || item.text.includes(n)));
  }
  function fillNewDate(needles, value) {
    const item = findInputByNeedles(needles);
    return item ? setValue(item.el, value) : false;
  }
  function wantedTypeTexts(type) {
    const key = norm(type).replace(/[^a-z0-9]/g, '');
    const map = {
      kdv1: ['KDV1', '0015 - KDV1', 'Katma Deger Vergisi Beyannamesi 1'],
      kdv2: ['KDV2', '4017 - KDV2', 'Katma Deger Vergisi Beyannamesi 2'],
      muhsgk: ['MUHSGK', 'Sigorta', 'Muhtasar'],
      gecici: ['Gecici', 'Gecici Vergi'],
      kurumlar: ['Kurumlar'],
      gelir: ['Gelir']
    };
    return map[key] || [type];
  }
  async function chooseNewDropdown(labelNeedles, wantedTexts) {
    const labels = labelNeedles.map(norm);
    const wanted = wantedTexts.map(norm).filter(Boolean);
    const selects = allInteractive().filter(item => /select/i.test(item.el.tagName));
    for (const item of selects) {
      if (!labels.some(n => item.ctx.includes(n))) continue;
      const option = Array.from(item.el.options || []).find(opt => {
        const text = norm([opt.text, opt.value].join(' '));
        return wanted.some(w => text.includes(w) || w.includes(text));
      });
      if (option) {
        item.el.value = option.value;
        fire(item.el);
        return true;
      }
    }
    let control = allInteractive()
      .filter(item => labels.some(n => item.ctx.includes(n) || item.text.includes(n)))
      .sort((a, b) => {
        const at = /input|button|div|span/.test(String(a.el.tagName || '').toLowerCase()) ? 5 : 0;
        const bt = /input|button|div|span/.test(String(b.el.tagName || '').toLowerCase()) ? 5 : 0;
        return bt - at;
      })[0];
    if (!control) return false;
    clickElement(control);
    await wait(250);
    const searchInput = allInteractive().find(item => /input/i.test(item.el.tagName) && labels.some(n => item.ctx.includes(n)));
    if (searchInput && wanted[0]) {
      setValue(searchInput.el, wantedTexts[0]);
      await wait(350);
    }
    const scrollables = () => Array.from(document.querySelectorAll('div, ul, ol, section'))
      .filter(el => visible(el) && el.scrollHeight > el.clientHeight + 20);
    for (let i = 0; i < 40; i++) {
      const options = allInteractive().filter(item => {
        const tag = String(item.el.tagName || '').toLowerCase();
        const role = norm(item.el.getAttribute && item.el.getAttribute('role'));
        const text = item.text || item.ctx;
        if (!wanted.some(w => text.includes(w) || w.includes(text))) return false;
        return /option|listbox|menu|li|div|span|button/.test(role + ' ' + tag);
      });
      const option = options.sort((a, b) => (a.text.length || 999) - (b.text.length || 999))[0];
      if (option) {
        clickElement(option);
        await wait(250);
        return true;
      }
      if (!searchInput) {
        scrollables().forEach(el => { el.scrollTop = Math.min(el.scrollTop + 260, el.scrollHeight); });
      }
      await wait(150);
    }
    if (searchInput) {
      searchInput.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      searchInput.el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    return Boolean(searchInput);
  }
  async function automateNewEBeyanFilters(params) {
    if (!isNewEBeyanDeclarationsPage()) return null;
    if (!isNewEBeyanReady()) {
      return {
        ok: false,
        newEBeyan: true,
        waitingForNewEBeyan: true,
        searchClicked: false,
        rowCount: collectRows().length,
        message: 'Yeni e-Beyan beyannameler sayfası açıldı, içerik yükleniyor.'
      };
    }
    const text = norm((document.body && document.body.innerText) || '');
    if (!/donem baslangic|mukellef|beyanname|durum/.test(text)) {
      clickByNeedles(['filtre']);
      await wait(450);
    }
    const dates = newPeriodDates(params.periodMonth, params.periodYear);
    const startOk = fillNewDate(['Donem Baslangic Tarihi', 'Dönem Başlangıç Tarihi'], dates.start);
    const endOk = fillNewDate(['Donem Bitis Tarihi', 'Dönem Bitiş Tarihi'], dates.end);
    const clientNeedles = [params.taxId || '', params.clientName || ''].filter(Boolean);
    const clientOk = clientNeedles.length ? await chooseNewDropdown(['Mukellef', 'Mükellef'], clientNeedles) : false;
    const typeOk = await chooseNewDropdown(['Beyanname'], wantedTypeTexts(params.declarationType || 'KDV1'));
    const statusOk = await chooseNewDropdown(['Durum'], ['Onaylandi', 'Onaylandı']);
    await wait(250);
    const searchClicked = clickByNeedles(['ara']);
    await wait(1800);
    return {
      ok: Boolean(searchClicked || startOk || endOk || clientOk || typeOk || statusOk),
      newEBeyan: true,
      taxOk: clientOk,
      typeOk,
      periodOk: Boolean(startOk && endOk),
      statusChecked: statusOk,
      searchClicked,
      rowCount: collectRows().length,
      message: searchClicked ? 'Yeni e-Beyan filtreleri dolduruldu ve arama başlatıldı.' : 'Yeni e-Beyan filtreleri dolduruldu fakat Ara düğmesi tıklanamadı.'
    };
  }
  function openBeyannameAraIfNeeded() {
    if (findTaxInput()) return false;
    if (clickTaughtStep('ara')) return true;
    return clickStrictLabel('Beyanname Ara');
  }
  function openEBeyannameAppIfNeeded() {
    if (findTaxInput()) return false;
    if (clickTaughtStep('app')) return true;
    if (clickExactEBeyanname()) return true;
    if (forceOpenEBeyannameByLink()) return true;
    if (clickStrictLabel('E-Beyanname')) return true;
    if (clickByNeedles(['e-beyanname', 'e beyanname', 'ebeyanname'])) return true;
    return clickByNeedles(['Beyanname Islemleri']);
  }
  async function automateSearch(params) {
    window.__apexGibTaughtClicks = Array.isArray(params && params.taughtClicks) ? params.taughtClicks : [];
    if (params && params.dijitalLoginFlow) {
      const dijitalStep = await continueDijitalToEbeyan(params || {});
      if (dijitalStep) return dijitalStep;
    }
    const newFlow = await automateNewEBeyanFilters(params || {});
    if (newFlow) return newFlow;
    if (params && params.newEBeyanOnly) {
      const url = String(location.href || '');
      if (!/ebeyan\.gib\.gov\.tr\/beyannameler/i.test(url)) {
        try { location.href = 'https://ebeyan.gib.gov.tr/beyannameler'; } catch (e) {}
      }
      return {
        ok: false,
        newEBeyan: true,
        waitingForNewEBeyan: true,
        searchClicked: false,
        rowCount: collectRows().length,
        url,
        message: 'Yeni e-Beyan beyannameler sayfası bekleniyor. Oturum yoksa Apex GİB penceresinde giriş yapılmalı.'
      };
    }
    const araClicked = openBeyannameAraIfNeeded();
    if (araClicked) {
      return {
        ok: true,
        appClicked: false,
        menuClicked: true,
        taxOk: false,
        typeOk: false,
        periodOk: false,
        searchClicked: false,
        rowCount: collectRows().length,
        message: 'Beyanname Ara menÃ¼sÃ¼ne tÄ±klandÄ±. Form aÃ§Ä±ldÄ±ktan sonra GÄ°Bâ€™de ara dÃ¼ÄŸmesine tekrar basÄ±n.'
      };
    }
    const hasTaxField = Boolean(findTaxInput());
    if (!hasTaxField) {
      const appClicked = openEBeyannameAppIfNeeded();
      return {
        ok: true,
        appClicked,
        taxOk: false,
        typeOk: false,
        periodOk: false,
        searchClicked: false,
        rowCount: collectRows().length,
        message: appClicked ? 'e-Beyanname gecisi denendi. Uygulama acilinca islem otomatik surecek.' : 'e-Beyanname baglantisi henuz yakalanamadi; sayfa biraz daha yuklenince tekrar denenecek.'
      };
    }
    const taxOk = fillTaxId(params.taxId || '');
    const typeOk = fillDeclarationType(params.declarationType || 'KDV1');
    const periodOk = fillPeriod(params.periodMonth, params.periodYear);
    const uploadRange = fillUploadDateRange(params.periodMonth, params.periodYear);
    const statusChecked = checkByLabel(['Durum']) || selectApprovedStatus();
    selectApprovedStatus();
    let searchClicked = clickByNeedles(['sorgula', 'listele', 'getir', 'goster']);
    if (!searchClicked) searchClicked = clickByNeedles(['vergi kimlik numarasi ile sorgula']);
    const appClicked = (!taxOk && !periodOk && !searchClicked)
      ? clickByNeedles(['e-beyanname', 'e beyanname', 'beyanname uygulamasÄ±', 'beyanname islemleri', 'beyanname iÅŸlemleri'])
      : false;
    return {
      ok: Boolean(taxOk || periodOk || searchClicked),
      appClicked,
      taxOk,
      typeOk,
      periodOk,
      uploadRangeOk: uploadRange.ok,
      uploadRangeStart: uploadRange.start,
      uploadRangeEnd: uploadRange.end,
      statusChecked,
      searchClicked,
      rowCount: collectRows().length,
      message: searchClicked ? 'Sorgu gÃ¶nderildi.' : (appClicked ? 'e-Beyanname uygulamasÄ± aÃ§Ä±lmaya Ã§alÄ±ÅŸÄ±ldÄ±.' : 'Sorgu alanlarÄ± otomatik bulunamadÄ±.')
    };
  }
  window.__apexGib = { collectRows, clickDocRow, automateSearch };
  return collectRows().map((row, index) => ({ index, cells: row.cells, clickables: row.clickables }));
})()
`;

async function runGibPageScript() {
  if (!gibWindow || gibWindow.isDestroyed()) throw new Error('Önce GİB oturum penceresini açın.');
  const wrapped = `(async () => {
    try {
      return await ${GIB_PAGE_SCRIPT};
    } catch (err) {
      return {
        __apexScriptError: true,
        message: err && err.message ? err.message : String(err),
        stack: err && err.stack ? String(err.stack).slice(0, 1200) : ''
      };
    }
  })()`;
  const result = await gibWindow.webContents.executeJavaScript(wrapped, true);
  if (result && result.__apexScriptError) {
    return {
      ok: false,
      scriptInstallFailed: true,
      message: `GİB sayfasındaki otomasyon kodu çalışamadı: ${result.message}`,
      stack: result.stack
    };
  }
  return result;
}

async function prefillDijitalLoginFields(request = {}) {
  if (!gibWindow || gibWindow.isDestroyed()) return null;
  const currentUrl = gibWindow.webContents.getURL();
  if (!/dijital\.gib\.gov\.tr\/portal\/login/i.test(currentUrl || '')) return null;
  const payload = {
    user: String(request.gibUser || '').trim(),
    password: String(request.gibPassword || '').trim()
  };
  if (!payload.user && !payload.password) {
    return { ok: false, waitingCaptcha: true, message: 'GİB kullanıcı kodu/şifre Apex’te boş görünüyor. GİB bilgileri düğmesinden tekrar kaydedin.' };
  }
  return await gibWindow.webContents.executeJavaScript(`
(() => {
  const payload = ${JSON.stringify(payload)};
  const inputs = Array.from(document.querySelectorAll('input, textarea')).filter(el => {
    const type = String(el.type || 'text').toLowerCase();
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return type !== 'hidden' && type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit'
      && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  });
  function txt(el) {
    const labels = [];
    if (el.id) labels.push(...Array.from(document.querySelectorAll('label[for="' + CSS.escape(el.id) + '"]')).map(x => x.innerText || x.textContent || ''));
    let node = el;
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) labels.push(node.innerText || node.textContent || '');
    return labels.join(' ').toLocaleLowerCase('tr-TR');
  }
  function set(el, value) {
    if (!el || !value) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
    return String(el.value || '') === String(value || '');
  }
  const pass = inputs.find(el => String(el.type || '').toLowerCase() === 'password') || null;
  const user = inputs.find(el => el !== pass && /tc kimlik|vergi kimlik|kullanıcı kodu|kullanici kodu/.test(txt(el))) || inputs.find(el => el !== pass) || null;
  const captcha = inputs.find(el => el !== pass && el !== user && /doğrulama|dogrulama|captcha|kod/.test(txt(el))) || inputs.find(el => el !== pass && el !== user) || null;
  const userOk = set(user, payload.user);
  const passOk = set(pass, payload.password);
  if (captcha) captcha.focus();
  return {
    ok: Boolean(userOk || passOk),
    waitingCaptcha: true,
    userOk,
    passOk,
    inputCount: inputs.length,
    message: userOk || passOk
      ? 'GİB kullanıcı kodu ve şifre yazıldı. Doğrulama kodunu elle girip Giriş Yap düğmesine basın; Apex otomatik devam edecek.'
      : 'GİB giriş alanları bulunamadı. Kullanıcı kodu/şifreyi elle girip doğrulama kodundan sonra Giriş Yap deyin; Apex otomatik devam edecek.'
  };
})()
  `, true);
}

async function nativeClickGibText(needles = [], options = {}) {
  if (!gibWindow || gibWindow.isDestroyed()) return { ok: false, reason: 'GİB penceresi açık değil.' };
  const payload = {
    needles: Array.isArray(needles) ? needles.map(String) : [String(needles || '')],
    exclude: Array.isArray(options.exclude) ? options.exclude.map(String) : [],
    preferExact: options.preferExact !== false
  };
  const target = await gibWindow.webContents.executeJavaScript(`
(() => {
  const payload = ${JSON.stringify(payload)};
  function norm(value) {
    return String(value || '')
      .replace(/\\s+/g, ' ')
      .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
      .toLocaleLowerCase('tr-TR')
      .trim();
  }
  const needles = payload.needles.map(norm).filter(Boolean);
  const exclude = payload.exclude.map(norm).filter(Boolean);
  function visible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 2 && rect.height > 2;
  }
  function textOf(el) {
    return norm([
      el.innerText,
      el.textContent,
      el.value,
      el.title,
      el.alt,
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('placeholder')
    ].join(' '));
  }
  function ctxOf(el) {
    const parts = [textOf(el)];
    let node = el.parentElement;
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) parts.push(textOf(node));
    return norm(parts.join(' '));
  }
  function bestClickable(el) {
    let best = el;
    let node = el;
    for (let i = 0; i < 7 && node; i++, node = node.parentElement) {
      if (!visible(node)) continue;
      const tag = String(node.tagName || '').toLowerCase();
      const role = norm(node.getAttribute && node.getAttribute('role'));
      const cls = String(node.className || '');
      const style = getComputedStyle(node);
      if (tag === 'button' || tag === 'a' || role === 'button' || node.onclick || style.cursor === 'pointer' || /card|item|swiper|menu|application|uygulama/i.test(cls)) {
        best = node;
      }
    }
    return best;
  }
  const els = Array.from(document.querySelectorAll('button,a,input,span,div,li,img,label'));
  const candidates = [];
  for (const el of els) {
    if (!visible(el)) continue;
    const text = textOf(el);
    const ctx = ctxOf(el);
    if (!needles.some(n => text === n || ctx.includes(n))) continue;
    if (exclude.some(x => text.includes(x) || ctx.includes(x))) continue;
    const target = bestClickable(el);
    const rect = target.getBoundingClientRect();
    if (!visible(target)) continue;
    const tag = String(target.tagName || '').toLowerCase();
    const exact = needles.some(n => text === n) ? 60 : 0;
    const clickable = (tag === 'button' || tag === 'a' || target.onclick || getComputedStyle(target).cursor === 'pointer') ? 30 : 0;
    const card = /card|item|swiper|menu|application|uygulama/i.test(String(target.className || '')) ? 15 : 0;
    const area = Math.min(20, (rect.width * rect.height) / 9000);
    candidates.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text, ctx, score: exact + clickable + card + area });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
})()
  `, true).catch(() => null);
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    return { ok: false, reason: 'Tıklanacak öğe bulunamadı.' };
  }
  const x = Math.max(1, Math.round(target.x));
  const y = Math.max(1, Math.round(target.y));
  gibWindow.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  gibWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  gibWindow.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  return { ok: true, x, y, text: target.text, score: target.score };
}

function dataFilePath(key) {
  const root = ensureApexFolders();
  const fileName = DATA_FILES[key] || `${String(key).replace(/[^a-z0-9_-]/gi, '_')}.json`;
  return path.join(root, 'data', fileName);
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function cleanBackupReason(reason) {
  return String(reason || 'yedek')
    .replace(/[^a-z0-9_-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'yedek';
}

function pruneFileBackups(root) {
  const backupDir = path.join(root, 'backups');
  const files = fs.readdirSync(backupDir)
    .filter(name => /^apex-.*\.json$/i.test(name))
    .map(name => {
      const fullPath = path.join(backupDir, name);
      const stat = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of files.slice(MAX_FILE_BACKUPS)) {
    try { fs.unlinkSync(file.fullPath); } catch {}
  }
}

function createBackupFile(reason = 'yedek', payload = null) {
  const root = ensureApexFolders();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(root, 'backups', `apex-${cleanBackupReason(reason)}-${stamp}.json`);
  const snapshot = {
    meta: {
      app: APP_NAME,
      version: app.getVersion(),
      createdAt: new Date().toISOString(),
      reason: reason || 'yedek'
    },
    data: {}
  };

  for (const key of Object.keys(DATA_FILES)) {
    snapshot.data[key] = readJsonFile(dataFilePath(key), null);
  }

  if (payload && typeof payload === 'object') {
    snapshot.live = payload;
  }

  writeJsonFile(target, snapshot);
  pruneFileBackups(root);
  return target;
}

function readBundledUpdateManifest() {
  const candidates = [
    path.join(appRoot(), 'update-manifest.json'),
    path.join(__dirname, 'update-manifest.json')
  ];
  for (const filePath of candidates) {
    const manifest = readJsonFile(filePath, null);
    if (manifest) return manifest;
  }
  return {};
}

function compareVersions(a, b) {
  const left = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const right = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    if ((left[i] || 0) > (right[i] || 0)) return 1;
    if ((left[i] || 0) < (right[i] || 0)) return -1;
  }
  return 0;
}

async function loadRemoteUpdateManifest(manifestUrl) {
  if (!manifestUrl) return null;
  if (/^https?:\/\//i.test(manifestUrl)) {
    const res = await fetch(manifestUrl, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Apex-Desktop'
      }
    });
    if (!res.ok) throw new Error(`GÃ¼ncelleme bilgisi okunamadÄ±: ${res.status}`);
    return await res.json();
  }
  const filePath = manifestUrl.replace(/^file:\/\//i, '');
  return readJsonFile(filePath, null);
}

function normalizeUpdateManifest(remote) { return require('./updater').normalize(remote); }

function downloadFileWithProgress(url, target, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) {
      reject(new Error('Güncelleme indirmesi çok fazla yönlendirme aldı.'));
      return;
    }
    const client = /^https:/i.test(url) ? https : http;
    const request = client.get(url, {
      headers: {
        'User-Agent': 'Apex-Desktop',
        'Accept': 'application/octet-stream'
      },
      timeout: 10 * 60 * 1000
    }, response => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.resume();
        const nextUrl = new URL(location, url).toString();
        downloadFileWithProgress(nextUrl, target, onProgress, redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Güncelleme indirilemedi: ${status}`));
        return;
      }
      const total = Number(response.headers['content-length'] || 0);
      let downloaded = 0;
      let lastEmit = 0;
      const file = fs.createWriteStream(target);
      const emit = (done = false) => {
        const now = Date.now();
        if (!done && now - lastEmit < 250) return;
        lastEmit = now;
        onProgress({
          phase: 'download',
          downloaded,
          total,
          percent: total ? Math.max(0, Math.min(100, Math.round((downloaded / total) * 100))) : 0
        });
      };
      response.on('data', chunk => {
        downloaded += chunk.length;
        emit(false);
      });
      response.on('error', err => {
        file.destroy(err);
        reject(err);
      });
      file.on('error', reject);
      file.on('finish', () => {
        emit(true);
        resolve({ downloaded, total });
      });
      response.pipe(file);
    });
    request.on('timeout', () => {
      request.destroy(new Error('Güncelleme indirmesi zaman aşımına uğradı.'));
    });
    request.on('error', reject);
  });
}

async function checkForUpdates() {
  const currentVersion = app.getVersion();
  const settings = readJsonFile(dataFilePath('apex_settings'), {}) || {};
  const bundled = readBundledUpdateManifest();
  const manifestUrl = settings.updateManifestUrl || bundled.updateManifestUrl || DEFAULT_UPDATE_MANIFEST_URL;

  if (!manifestUrl) {
    return {
      ok: true,
      configured: false,
      currentVersion,
      latestVersion: bundled.latestVersion || bundled.version || currentVersion,
      updateAvailable: false,
      message: 'GÃ¼ncelleme adresi henÃ¼z tanÄ±mlanmadÄ±.'
    };
  }

  const remote = normalizeUpdateManifest(await loadRemoteUpdateManifest(manifestUrl));
  if (!remote) throw new Error('GÃ¼ncelleme bilgisi boÅŸ geldi.');
  const latestVersion = remote.latestVersion || remote.version || currentVersion;
  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
  return {
    ok: true,
    configured: true,
    currentVersion,
    latestVersion,
    updateAvailable,
    downloadUrl: remote.downloadUrl || '',
    notes: remote.notes || [],
    message: updateAvailable ? `Apex ${latestVersion} hazÄ±r.` : 'Apex gÃ¼ncel.'
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error('GÃ¶vde Ã§ok bÃ¼yÃ¼k'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function localAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

function profileTypeFromPath(urlPath) {
  const match = /^\/profile\/([^/]+)\/([^/]+)$/.exec(urlPath);
  if (!match) return null;
  return {
    profile: decodeURIComponent(match[1]),
    type: decodeURIComponent(match[2])
  };
}

function readMainStore() {
  return readJsonFile(dataFilePath('beyanname_takip_v6'), { profiles: {} }) || { profiles: {} };
}

function writeMainStore(store) {
  writeJsonFile(dataFilePath('beyanname_takip_v6'), store && typeof store === 'object' ? store : { profiles: {} });
}

function startSyncServer() {
  if (syncServer) return;
  syncServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        app: APP_NAME,
        port: SYNC_PORT,
        addresses: localAddresses(),
        version: app.getVersion(),
        at: new Date().toISOString()
      });
      return;
    }

    const target = profileTypeFromPath(url.pathname);
    if (!target) {
      sendJson(res, 404, { ok: false, error: 'BulunamadÄ±' });
      return;
    }

    try {
      const store = readMainStore();
      store.profiles = store.profiles || {};
      store.profiles[target.profile] = store.profiles[target.profile] || {};

      if (req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          profile: target.profile,
          type: target.type,
          data: store.profiles[target.profile][target.type] || null,
          updatedAt: store.updatedAt || ''
        });
        return;
      }

      if (req.method === 'PUT') {
        const body = await readRequestJson(req);
        if (!body || typeof body.data !== 'object') {
          sendJson(res, 400, { ok: false, error: 'GeÃ§ersiz veri' });
          return;
        }
        store.profiles[target.profile][target.type] = body.data;
        store.updatedAt = new Date().toISOString();
        writeMainStore(store);
        sendJson(res, 200, { ok: true, updatedAt: store.updatedAt });
        return;
      }

      sendJson(res, 405, { ok: false, error: 'Desteklenmeyen metot' });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || 'Senkron hatasÄ±' });
    }
  });

  syncServer.listen(SYNC_PORT, '0.0.0.0');
  syncServer.on('error', () => {
    syncServer = null;
  });
}

function healthCheck() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${READER_PORT}/health`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const payload = JSON.parse(body);
          resolve(Boolean(payload.ok));
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startInvoiceReader() {
  if (await healthCheck()) return;
  const exe = path.join(appUnpackedRoot(), 'fatura-okuyucu.exe');
  if (!fs.existsSync(exe)) return;
  readerProcess = spawn(exe, [], {
    cwd: appUnpackedRoot(),
    windowsHide: true,
    detached: false,
    stdio: 'ignore'
  });
  readerProcess.unref();
}

function createWindow() {
  const apexDataDir = ensureApexFolders();
  const win = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 800,
    minHeight: 580,
    title: APP_NAME,
    backgroundColor: '#11151d',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,
      sandbox: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('context-menu', (_event, params) => {
    const template = [];
    if (params.isEditable) {
      template.push(
        { label: 'Kes', enabled: params.editFlags.canCut, click: () => win.webContents.cut() },
        { label: 'Kopyala', enabled: params.editFlags.canCopy, click: () => win.webContents.copy() },
        { label: 'Yapıştır', enabled: params.editFlags.canPaste, click: () => win.webContents.paste() },
        { type: 'separator' },
        { label: 'Tümünü seç', enabled: params.editFlags.canSelectAll, click: () => win.webContents.selectAll() }
      );
    } else if (params.selectionText) {
      template.push(
        { label: 'Kopyala', enabled: params.editFlags.canCopy, click: () => win.webContents.copy() },
        { type: 'separator' },
        { label: 'Tümünü seç', enabled: params.editFlags.canSelectAll, click: () => win.webContents.selectAll() }
      );
    }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
  });
  win.loadFile(path.join(appRoot(), 'index.html'), {
    query: { apexDataDir }
  });
}

ipcMain.handle('apex:get-paths', () => ({
  dataRoot: ensureApexFolders(),
  appRoot: appRoot(),
  projectRoot: __dirname,
  version: app.getVersion()
}));

ipcMain.handle('apex:open-folder', async (_event, name = 'root') => {
  const root = ensureApexFolders();
  const folders = {
    root,
    data: path.join(root, 'data'),
    backups: path.join(root, 'backups'),
    invoices: path.join(root, 'invoices'),
    exports: path.join(root, 'exports'),
    logs: path.join(root, 'logs'),
    gib: path.join(root, 'GIB-Evrak'),
    app: __dirname
  };
  const target = folders[name] || root;
  await shell.openPath(target);
  return target;
});

ipcMain.handle('apex:open-tahakkuk-gonder', async () => {
  return { embedded: true };
});

const TAHAKKUK_LOCAL_ROOT_NAME = path.join('data', 'tahakkuk-gonder');

function tahakkukDataRoot() {
  const root = path.join(ensureApexFolders(), TAHAKKUK_LOCAL_ROOT_NAME);
  fs.mkdirSync(path.join(root, 'temp'), { recursive: true });
  tahakkukSeedIfNeeded(root);
  return root;
}

function tahakkukSeedIfNeeded(root) {
  const clientsPath = path.join(root, 'mukellefler.json');
  const recipientsPath = path.join(root, 'ozel-gonderim-kisileri.json');
  if (fs.existsSync(clientsPath) && fs.existsSync(recipientsPath)) return;
  const seedPath = path.join(appRoot(), 'tahakkuk-gonder-seed.json');
  if (!fs.existsSync(seedPath)) return;
  try {
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    if (!fs.existsSync(clientsPath)) {
      fs.writeFileSync(clientsPath, JSON.stringify(seed.clients || [], null, 2), 'utf8');
    }
    if (!fs.existsSync(recipientsPath)) {
      fs.writeFileSync(recipientsPath, JSON.stringify(seed.recipients || [], null, 2), 'utf8');
    }
  } catch (err) {}
}

function tahakkukReadJson(file, fallback = []) {
  try {
    const full = path.join(tahakkukDataRoot(), file);
    if (!fs.existsSync(full)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
}

function tahakkukReadObject(file, fallback = {}) {
  try {
    const full = path.join(tahakkukDataRoot(), file);
    if (!fs.existsSync(full)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
}

function tahakkukWriteJson(file, value) {
  const full = path.join(tahakkukDataRoot(), file);
  fs.writeFileSync(full, JSON.stringify(Array.isArray(value) ? value : [], null, 2), 'utf8');
  return full;
}

function tahakkukWriteObject(file, value) {
  const full = path.join(tahakkukDataRoot(), file);
  fs.writeFileSync(full, JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? value : {}, null, 2), 'utf8');
  return full;
}

function tahakkukNormalize(value) {
  return String(value || '')
    .toLocaleUpperCase('tr-TR')
    .replace(/[Ç]/g, 'C')
    .replace(/[Ğ]/g, 'G')
    .replace(/[İI]/g, 'I')
    .replace(/[Ö]/g, 'O')
    .replace(/[Ş]/g, 'S')
    .replace(/[Ü]/g, 'U')
    .replace(/[^A-Z0-9]/g, '');
}

function tahakkukFindChild(parent, wanted) {
  if (!parent || !fs.existsSync(parent)) return '';
  const target = tahakkukNormalize(wanted);
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    if (entry.isDirectory() && tahakkukNormalize(entry.name) === target) {
      return path.join(parent, entry.name);
    }
  }
  return '';
}

function tahakkukPatterns(code, year, month, source) {
  if (code === 'EBILDIRGE' || code === 'HIZMET_LISTESI') {
    return [
      new RegExp(`^${year}_${month}.*\\.pdf$`, 'i'),
      new RegExp(`^${code}_.*${month}.*${year}.*\\.pdf$`, 'i'),
      new RegExp(`.*${month}_${year}.*\\.pdf$`, 'i')
    ];
  }
  const patterns = [
    new RegExp(`^${code}_${month}_${year}.*\\.pdf$`, 'i'),
    new RegExp(`^${code}_${month}_${year}_${month}_${year}.*\\.pdf$`, 'i'),
    new RegExp(`^${code}_.*_${month}_${year}.*\\.pdf$`, 'i')
  ];
  if (source === 'Tahakkuk') patterns.push(new RegExp(`^${code}_TAHAKKUK_${month}_${year}.*\\.pdf$`, 'i'));
  if (source === 'Beyanname') {
    patterns.push(new RegExp(`^${code}_BEYANNAME_${month}_${year}.*\\.pdf$`, 'i'));
    patterns.push(new RegExp(`^${code}_.*BEYANNAME.*${month}.*${year}.*\\.pdf$`, 'i'));
  }
  return patterns;
}

function tahakkukDocumentFolder(client, source, code, rootPath) {
  const company = path.join(rootPath, client.Klasor || client.folder || client.Unvan || '');
  const docs = tahakkukFindChild(company, 'DOKUMANLAR');
  if (!docs) return '';
  if (code === 'VERGI_LEVHASI') return tahakkukFindChild(docs, 'VERGI LEVHALARI');
  if (source === 'Tahakkuk') {
    if (code === 'HIZMET_LISTESI') {
      const eb = tahakkukFindChild(docs, 'E BILDIRGE');
      return eb ? tahakkukFindChild(eb, 'HIZMET LISTESI') : '';
    }
    if (code === 'EBILDIRGE') {
      const eb = tahakkukFindChild(docs, 'E BILDIRGE');
      return eb ? tahakkukFindChild(eb, 'TAHAKKUK') : '';
    }
    return tahakkukFindChild(docs, 'TAHAKKUK');
  }
  if (source === 'Beyanname' && code !== 'EBILDIRGE' && code !== 'HIZMET_LISTESI') return tahakkukFindChild(docs, 'BEYANNAME');
  return '';
}

function tahakkukFilesFor(client, request) {
  const files = new Map();
  const missing = [];
  const months = Array.isArray(request.months) && request.months.length
    ? request.months
    : [request.month || ''];
  const cleanMonths = [...new Set(months.map(month => String(month || '').padStart(2, '0')).filter(month => /^(0[1-9]|1[0-2])$/.test(month)))];
  const years = Array.isArray(request.years) && request.years.length
    ? request.years
    : [request.year || new Date().getFullYear()];
  const cleanYears = [...new Set(years.map(year => String(year || '').trim()).filter(year => /^\d{4}$/.test(year)))];
  const requestedCodes = [...new Set(request.codes || [])];
  if (requestedCodes.includes('VERGI_LEVHASI')) {
    const source = 'Vergi Levhası';
    const code = 'VERGI_LEVHASI';
    const folder = tahakkukDocumentFolder(client, source, code, request.rootPath || '\\\\DESKTOP-MLBT1CR\\zirvenet\\zirvedata');
    const candidates = [];
    if (folder && fs.existsSync(folder)) {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (!entry.isFile() || path.extname(entry.name).toLocaleLowerCase('tr-TR') !== '.pdf') continue;
        const full = path.join(folder, entry.name);
        const stat = fs.statSync(full);
        if (stat.size > 0) {
          candidates.push({ path: full, name: entry.name, size: stat.size, source, code, month: '', mtimeMs: stat.mtimeMs });
        }
      }
    }
    for (const year of cleanYears) {
      const pool = candidates.filter(file => file.name.includes(year));
      if (!pool.length) {
        missing.push({ source, code, year, month: '', folder: folder || '' });
      } else {
        const selected = pool.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name, 'tr'))[0];
        files.set(selected.path, { ...selected, year });
      }
    }
  }
  for (const source of request.sources || []) {
    for (const code of requestedCodes.filter(item => item !== 'VERGI_LEVHASI')) {
      const folder = tahakkukDocumentFolder(client, source, code, request.rootPath || '\\\\DESKTOP-MLBT1CR\\zirvenet\\zirvedata');
      for (const year of cleanYears) {
        for (const month of cleanMonths) {
          const candidates = [];
          if (folder && fs.existsSync(folder)) {
            const patterns = tahakkukPatterns(code, year, month, source);
            for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
              if (!entry.isFile()) continue;
              if (patterns.some(pattern => pattern.test(entry.name))) {
                const full = path.join(folder, entry.name);
                const stat = fs.statSync(full);
                if (stat.size > 0) {
                  candidates.push({ path: full, name: entry.name, size: stat.size, source, code, year, month, mtimeMs: stat.mtimeMs });
                }
              }
            }
          }
          if (!candidates.length) {
            missing.push({ source, code, year, month, folder: folder || '' });
            continue;
          }
          const selected = (code === 'EBILDIRGE' || code === 'HIZMET_LISTESI')
            ? candidates
            : [candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name, 'tr'))[0]];
          selected.forEach(file => files.set(file.path, file));
        }
      }
    }
  }
  return {
    files: [...files.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    missing
  };
}

function tahakkukNormalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `90${digits.slice(1)}`;
  if (digits.length === 10) digits = `90${digits}`;
  if (!digits.startsWith('90') || digits.length !== 12) throw new Error(`Telefon hatalı: ${value}`);
  return digits;
}

ipcMain.handle('apex:tahakkuk-load', async () => ({
  dataRoot: tahakkukDataRoot(),
  clients: tahakkukReadJson('mukellefler.json', []),
  recipients: tahakkukReadJson('ozel-gonderim-kisileri.json', []),
  meta: tahakkukReadObject('meta.json', {})
}));

ipcMain.handle('apex:tahakkuk-save', async (_event, payload = {}) => {
  tahakkukWriteJson('mukellefler.json', payload.clients || []);
  tahakkukWriteJson('ozel-gonderim-kisileri.json', payload.recipients || []);
  tahakkukWriteObject('meta.json', payload.meta || {});
  return { ok: true, dataRoot: tahakkukDataRoot() };
});

ipcMain.handle('apex:tahakkuk-scan', async (_event, request = {}) => {
  const result = [];
  for (const client of request.clients || []) {
    const scan = tahakkukFilesFor(client, request);
    result.push({ client, files: scan.files, missing: scan.missing });
  }
  return { ok: true, result };
});

function uniqueCopyTarget(folder, fileName) {
  const parsed = path.parse(fileName);
  let target = path.join(folder, fileName);
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(folder, `${parsed.name} (${index})${parsed.ext}`);
    index++;
  }
  return target;
}

ipcMain.handle('apex:tahakkuk-choose-folder', async event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Klasörleme hedefi seç',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths?.[0]) return '';
  return result.filePaths[0];
});

ipcMain.handle('apex:tahakkuk-choose-files', async event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Gönderilecek dosyaları seç',
    defaultPath: app.getPath('downloads'),
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled || !result.filePaths?.length) return [];
  return result.filePaths;
});

ipcMain.handle('apex:tahakkuk-folder-export', async (_event, request = {}) => {
  const targetRoot = String(request.targetRoot || '').trim();
  if (!targetRoot) throw new Error('Hedef klasör seçilmedi.');
  fs.mkdirSync(targetRoot, { recursive: true });
  const rows = Array.isArray(request.rows) ? request.rows : [];
  let copied = 0;
  const folders = [];
  for (const row of rows) {
    const client = row.client || {};
    const files = Array.isArray(row.files) ? row.files : [];
    if (!files.length) continue;
    const folderName = safeFilePart(client.Klasor || client.folder || client.Unvan || 'Firma');
    const clientFolder = path.join(targetRoot, folderName);
    fs.mkdirSync(clientFolder, { recursive: true });
    folders.push(clientFolder);
    for (const file of files) {
      const source = String(file.path || file || '');
      if (!source || !fs.existsSync(source)) continue;
      const stat = fs.statSync(source);
      if (!stat.isFile() || stat.size <= 0) continue;
      const target = uniqueCopyTarget(clientFolder, path.basename(source));
      fs.copyFileSync(source, target);
      copied++;
    }
  }
  if (!copied) throw new Error('Klasörlenecek PDF bulunamadı.');
  return { ok: true, copied, folders: [...new Set(folders)] };
});

ipcMain.handle('apex:tahakkuk-copy-files', async (_event, request = {}) => {
  const files = [...new Set(request.files || [])].filter(Boolean);
  if (!files.length) throw new Error('Panoya kopyalanacak belge yok.');
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`Dosya bulunamadı: ${file}`);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size <= 0) throw new Error(`Dosya geçersiz: ${file}`);
  }
  const temp = path.join(os.tmpdir(), 'ApexTahakkukGonder');
  fs.mkdirSync(temp, { recursive: true });
  const listPath = path.join(temp, `copy-${Date.now()}.json`);
  const scriptPath = path.join(temp, `copy-${Date.now()}.ps1`);
  fs.writeFileSync(listPath, JSON.stringify(files, null, 2), 'utf8');
  fs.writeFileSync(scriptPath, `
param([Parameter(Mandatory=$true)][string]$ListPath)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
$files = Get-Content -LiteralPath $ListPath -Raw -Encoding UTF8 | ConvertFrom-Json
$drop = New-Object System.Collections.Specialized.StringCollection
foreach ($file in $files) {
  if (!(Test-Path -LiteralPath $file)) { throw "Dosya bulunamadi: $file" }
  [void]$drop.Add((Get-Item -LiteralPath $file).FullName)
}
[System.Windows.Forms.Clipboard]::Clear()
[System.Windows.Forms.Clipboard]::SetFileDropList($drop)
`, 'utf8');
  const child = spawn('powershell.exe', ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-ListPath', listPath], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => stderr += chunk.toString('utf8'));
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr || `PowerShell çıkış kodu ${code}`)));
  });
  return { ok: true, count: files.length };
});

async function printPdfSilently(filePath) {
  const source = String(filePath || '');
  if (!source || !fs.existsSync(source)) throw new Error(`Dosya bulunamadı: ${source}`);
  const stat = fs.statSync(source);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`Dosya geçersiz: ${source}`);
  if (path.extname(source).toLocaleLowerCase('tr-TR') !== '.pdf') throw new Error(`PDF değil: ${source}`);

  const candidates = [
    path.join(process.resourcesPath || '', 'app', 'tools', 'SumatraPDF', 'SumatraPDF-3.6.1-64.exe'),
    path.join(app.getAppPath(), 'app', 'tools', 'SumatraPDF', 'SumatraPDF-3.6.1-64.exe'),
    path.join(__dirname, 'app', 'tools', 'SumatraPDF', 'SumatraPDF-3.6.1-64.exe')
  ];
  const printerExe = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!printerExe) {
    throw new Error('Sessiz yazdırma motoru bulunamadı. Apex paketini yeniden kurun.');
  }

  await new Promise((resolve, reject) => {
    const args = ['-print-to-default', '-silent', '-print-settings', 'shrink', source];
    const child = spawn(printerExe, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Yazdırma zaman aşımı: ${path.basename(source)}`));
    }, 60000);
    child.stderr.on('data', chunk => stderr += chunk.toString('utf8'));
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const reasons = {
        2: 'PDF açılamadı veya desteklenmiyor.',
        3: 'PDF yazdırmaya izin vermiyor.',
        4: 'Varsayılan yazıcı bulunamadı.',
        5: 'Yazıcı sürücüsü veya cihaz hata verdi.',
        6: 'Yazdırma sistem politikası tarafından engellendi.'
      };
      reject(new Error(`${path.basename(source)} yazdırılamadı. ${reasons[code] || `Çıkış kodu ${code}.`} ${stderr}`.trim()));
    });
  });
}

ipcMain.handle('apex:tahakkuk-print-files', async (_event, request = {}) => {
  const files = [...new Set(request.files || [])].filter(Boolean);
  if (!files.length) throw new Error('Yazdırılacak belge yok.');
  const printed = [];
  const failed = [];
  for (const file of files) {
    try {
      await printPdfSilently(file);
      printed.push(file);
    } catch (err) {
      failed.push({ file, error: err.message || String(err) });
    }
  }
  if (!printed.length && failed.length) {
    throw new Error(`Hiçbir PDF yazdırılamadı.\n${failed.map(item => `${path.basename(item.file)}: ${item.error}`).join('\n')}`);
  }
  return { ok: true, count: printed.length, failed };
});

ipcMain.handle('apex:tahakkuk-send', async (_event, request = {}) => {
  const jobs = (request.jobs || []).map(job => ({
    phone: tahakkukNormalizePhone(job.phone || job.target?.Telefon),
    name: job.name || job.target?.Ad || '',
    clients: job.clients || [],
    files: [...new Set(job.files || [])],
    message: String(job.message || '')
  })).filter(job => job.files.length);
  if (!jobs.length) throw new Error('Gönderilecek belge yok.');

  const temp = path.join(os.tmpdir(), 'ApexTahakkukGonder');
  fs.mkdirSync(temp, { recursive: true });
  const jobsPath = path.join(temp, `jobs-${Date.now()}.json`);
  const scriptPath = path.join(temp, `send-${Date.now()}.ps1`);
  fs.writeFileSync(jobsPath, JSON.stringify(jobs, null, 2), 'utf8');
  fs.writeFileSync(scriptPath, `
param([Parameter(Mandatory=$true)][string]$JobsPath)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ApexWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$jobs = Get-Content -LiteralPath $JobsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$cacheDir = Join-Path $env:TEMP "ApexTahakkukGonderWhatsAppCache"
if (!(Test-Path -LiteralPath $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir | Out-Null }
function Get-WindowTitle([IntPtr]$handle) {
  $builder = New-Object System.Text.StringBuilder 512
  [void][ApexWin32]::GetWindowText($handle, $builder, $builder.Capacity)
  return $builder.ToString()
}
function Show-Window([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return $false }
  if ([ApexWin32]::IsIconic($handle)) {
    [void][ApexWin32]::ShowWindowAsync($handle, 9)
    Start-Sleep -Milliseconds 120
  }
  [void][ApexWin32]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 350
  return $true
}
function Find-CandidateWindows() {
  $wanted = @("WhatsApp", "WhatsApp.Root", "chrome", "msedge", "brave", "opera")
  $items = New-Object System.Collections.Generic.List[object]
  $callback = [ApexWin32+EnumWindowsProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (![ApexWin32]::IsWindowVisible($hWnd)) { return $true }
    [uint32]$windowProcessId = 0
    [void][ApexWin32]::GetWindowThreadProcessId($hWnd, [ref]$windowProcessId)
    if ($windowProcessId -le 0) { return $true }
    try { $proc = Get-Process -Id $windowProcessId -ErrorAction Stop } catch { return $true }
    if ($wanted -notcontains $proc.ProcessName) { return $true }
    $title = Get-WindowTitle $hWnd
    $score = 0
    if ($proc.ProcessName -like "WhatsApp*") { $score += 100 }
    if ($title -match "WhatsApp") { $score += 80 }
    if ($proc.ProcessName -in @("chrome", "msedge", "brave", "opera")) { $score += 20 }
    if ($title -match "Chrome|Edge|Brave|Opera") { $score += 10 }
    $items.Add([pscustomobject]@{ Handle = $hWnd; Process = $proc.ProcessName; Id = $windowProcessId; Title = $title; Score = $score }) | Out-Null
    return $true
  }
  [void][ApexWin32]::EnumWindows($callback, [IntPtr]::Zero)
  return $items | Sort-Object Score -Descending
}
function Activate-WhatsAppWindow() {
  foreach ($title in @("WhatsApp", "Google Chrome", "Chrome", "Microsoft Edge", "Edge", "Brave", "Opera")) {
    try {
      if ([Microsoft.VisualBasic.Interaction]::AppActivate($title)) {
        Start-Sleep -Milliseconds 350
        return $true
      }
    } catch {}
  }
  $windows = @(Find-CandidateWindows)
  foreach ($window in $windows) {
    if (Show-Window $window.Handle) { return $true }
  }
  return $false
}
function Set-FileClipboard($files) {
  $local = New-Object System.Collections.Generic.List[string]
  $i = 1
  foreach ($file in $files) {
    if (!(Test-Path -LiteralPath $file)) { throw "Dosya bulunamadi: $file" }
    $item = Get-Item -LiteralPath $file
    if ($item.Length -le 0) { throw "Dosya bos: $file" }
    $name = $item.Name -replace '[<>:"/\\\\|?*]', '_'
    $dest = Join-Path $cacheDir ("{0:00}_{1}" -f $i, $name)
    Copy-Item -LiteralPath $item.FullName -Destination $dest -Force
    [void]$local.Add((Get-Item -LiteralPath $dest).FullName)
    $i++
  }
  $drop = New-Object System.Collections.Specialized.StringCollection
  [void]$drop.AddRange([string[]]$local)
  [System.Windows.Forms.Clipboard]::Clear()
  [System.Windows.Forms.Clipboard]::SetFileDropList($drop)
}
function Focus-WhatsAppSearch() {
  [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
  Start-Sleep -Milliseconds 180
  [System.Windows.Forms.SendKeys]::SendWait("^%/")
  Start-Sleep -Milliseconds 350
  [System.Windows.Forms.SendKeys]::SendWait("^a")
  Start-Sleep -Milliseconds 120
}
function Type-WhatsAppPhone($phone) {
  [System.Windows.Forms.Clipboard]::SetText([string]$phone)
  Focus-WhatsAppSearch
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 250
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Seconds 4
}
foreach ($job in $jobs) {
  if (!(Activate-WhatsAppWindow)) { throw "Chrome/WhatsApp penceresi bulunamadi. WhatsApp Web veya WhatsApp masaustu penceresini acik ve gorunur birakin." }
  Start-Sleep -Milliseconds 450
  Type-WhatsAppPhone $job.phone
  if ($job.message) {
    [System.Windows.Forms.Clipboard]::SetText([string]$job.message)
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Start-Sleep -Milliseconds 500
  }
  Set-FileClipboard $job.files
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Seconds 3
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Seconds 2
  Start-Sleep -Seconds 3
}
`, 'utf8');
  const child = spawn('powershell.exe', ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-JobsPath', jobsPath], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => stderr += chunk.toString('utf8'));
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr || `PowerShell çıkış kodu ${code}`)));
  });
  return { ok: true, count: jobs.length };
});

ipcMain.handle('apex:market-rates', async () => {
  const now = Date.now();
  const cacheMs = hasAnyMarketRate(marketRatesCache.payload) ? 5 * 60 * 1000 : 20 * 1000;
  if (marketRatesCache.payload && now - marketRatesCache.at < cacheMs) {
    return marketRatesCache.payload;
  }
  try {
    const raw = await httpGetJson('https://finans.truncgil.com/today.json');
    const payload = normalizeMarketRates(raw);
    if (!hasAnyMarketRate(payload)) throw new Error('Kur verisi boş geldi');
    marketRatesCache = { at: now, payload };
    return payload;
  } catch (err) {
    if (marketRatesCache.payload) {
      return { ...marketRatesCache.payload, stale: true, error: err.message || String(err) };
    }
    return {
      updatedAt: new Date().toISOString(),
      source: 'bağlantı yok',
      error: err.message || String(err),
      rates: { usd: null, eur: null, gbp: null, gram: null, quarter: null }
    };
  }
});

ipcMain.handle('apex:zirve-invoice-start', async (event, request = {}) => {
  const names = Array.isArray(request.names)
    ? request.names.map(name => String(name || '').trim()).filter(Boolean)
    : [];
  const uniqueNames = [...new Set(names)];
  if (!uniqueNames.length) throw new Error('Fatura indirilecek mÃ¼kellef listesi boÅŸ.');

  const waitSeconds = Math.max(10, Math.min(120, Number(request.waitSeconds) || 50));
  const root = ensureApexFolders();
  const listPath = path.join(root, 'data', 'zirve-fatura-indir-listesi.txt');
  const logPath = path.join(root, 'data', 'zirve-fatura-indir-log.txt');
  const statusPath = path.join(root, 'data', 'zirve-fatura-indir-son-durum.txt');
  const stopPath = path.join(root, 'data', 'zirve-fatura-indir-durdur.txt');
  const completedPath = path.join(root, 'data', 'zirve-fatura-indir-tamamlandi.txt');
  fs.writeFileSync(listPath, uniqueNames.join(os.EOL), 'utf8');
  for (const filePath of [logPath, statusPath, stopPath, completedPath]) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  }

  const bundledScriptPath = zirveRobotScriptPath();
  if (!fs.existsSync(bundledScriptPath)) throw new Error(`Zirve robot dosyasi bulunamadi: ${bundledScriptPath}`);
  const scriptPath = path.join(root, 'data', 'zirve-express-robot-local.ps1');
  fs.copyFileSync(bundledScriptPath, scriptPath);

  const runnerPath = path.join(root, 'data', 'zirve-fatura-indir-calistir.bat');
  const stopperPath = path.join(root, 'data', 'zirve-fatura-indir-durdur.bat');
  const firmLoadWaitSeconds = String(Number(request.firmLoadWaitSeconds) || 8);
  const runner = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal EnableExtensions',
    'title Apex Zirve Fatura Indir Robotu',
    'cd /d "%~dp0"',
    '',
    'set "DATA=%~dp0"',
    'set "SCRIPT=%DATA%zirve-express-robot-local.ps1"',
    'set "LIST=%DATA%zirve-fatura-indir-listesi.txt"',
    'set "LISTUPDATER=%DATA%zirve-fatura-indir-liste-guncelle.ps1"',
    'set "STOP=%DATA%zirve-fatura-indir-durdur.txt"',
    `set "WAIT=${waitSeconds}"`,
    `set "FIRM_WAIT=${firmLoadWaitSeconds}"`,
    '',
    'if exist "%STOP%" del /f /q "%STOP%" >nul 2>&1',
    '',
    'echo Apex Zirve fatura indir robotu basliyor.',
    'echo Klasor: %DATA%',
    'echo.',
    '',
    'if not exist "%SCRIPT%" (',
    '  echo HATA: Robot scripti bulunamadi: %SCRIPT%',
    '  echo Apex guncellenmeli veya zirve-express-robot-local.ps1 dosyasi geri yuklenmeli.',
    '  pause',
    '  exit /b 1',
    ')',
    '',
    'if exist "%LISTUPDATER%" (',
    '  echo Liste Apex kaydindan guncelleniyor...',
    '  "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%LISTUPDATER%"',
    ')',
    '',
    'if not exist "%LIST%" (',
    '  echo HATA: Firma listesi bulunamadi: %LIST%',
    '  pause',
    '  exit /b 1',
    ')',
    '',
    'for /f %%A in (\'find /v /c "" ^< "%LIST%"\') do set "COUNT=%%A"',
    'if "%COUNT%"=="" set "COUNT=0"',
    'if "%COUNT%"=="0" (',
    '  echo HATA: Firma listesi bos.',
    '  pause',
    '  exit /b 1',
    ')',
    '',
    'echo Firma sayisi: %COUNT%',
    'echo Durdurmak icin robot calisirken ESC tusuna basin veya zirve-fatura-indir-durdur.bat dosyasini calistirin.',
    'echo.',
    '',
    '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoExit -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -FirmListPath "%LIST%" -MaxFirmCount %COUNT% -DownloadWaitSeconds %WAIT% -FirmLoadWaitSeconds %FIRM_WAIT%',
    'set "EXITCODE=%ERRORLEVEL%"',
    'echo.',
    'echo Robot penceresi kapandi. Cikis kodu: %EXITCODE%',
    'if not "%EXITCODE%"=="0" pause',
    'exit /b %EXITCODE%',
    ''
  ].join(os.EOL);
  fs.writeFileSync(runnerPath, runner, 'utf8');
  const stopper = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal EnableExtensions',
    'cd /d "%~dp0"',
    'echo DURDUR > "zirve-fatura-indir-durdur.txt"',
    'echo Apex Zirve robotuna durdurma istegi gonderildi.',
    'timeout /t 2 >nul',
    ''
  ].join(os.EOL);
  fs.writeFileSync(stopperPath, stopper, 'utf8');

  try {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (sourceWindow && !sourceWindow.isDestroyed()) sourceWindow.minimize();
    const child = spawn(runnerPath, [], {
      cwd: path.dirname(runnerPath),
      detached: true,
      windowsHide: false,
      stdio: 'ignore',
      shell: true
    });
    child.unref();
  } catch (err) {
    throw new Error(`Fatura indirme BAT dosyası başlatılamadı. Liste klasöründeki BAT dosyasını çift tıklayabilirsiniz. ${err.message || err}`);
  }
  zirveInvoiceRunStartedAt = Date.now();
  return {
    ok: true,
    count: uniqueNames.length,
    listPath,
    runnerPath,
    scriptPath,
    stopperPath,
    logPath,
    statusPath,
    waitSeconds
  };
});

ipcMain.handle('apex:zirve-invoice-status', async () => {
  const root = ensureApexFolders();
  const logPath = path.join(root, 'data', 'zirve-fatura-indir-log.txt');
  const statusPath = path.join(root, 'data', 'zirve-fatura-indir-son-durum.txt');
  const completedPath = path.join(root, 'data', 'zirve-fatura-indir-tamamlandi.txt');
  const readText = filePath => {
    try {
      if (!fs.existsSync(filePath)) return '';
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  };
  const logText = readText(logPath);
  const lines = logText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return {
    ok: true,
    logPath,
    statusPath,
    completedPath,
    lastStatus: readText(statusPath).trim(),
    completed: fs.existsSync(completedPath),
    lines: lines.slice(-120)
  };
});

ipcMain.handle('apex:zirve-invoice-stop', async () => {
  const root = ensureApexFolders();
  const stopPath = path.join(root, 'data', 'zirve-fatura-indir-durdur.txt');
  fs.writeFileSync(stopPath, `DURDUR ${new Date().toISOString()}`, 'utf8');
  return { ok: true, stopPath };
});

ipcMain.handle('apex:list-backups', () => {
  const root = ensureApexFolders();
  const backupDir = path.join(root, 'backups');
  return fs.readdirSync(backupDir)
    .filter(name => /^apex-.*\.json$/i.test(name))
    .map(name => {
      const fullPath = path.join(backupDir, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        path: fullPath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))
    .slice(0, 30);
});

ipcMain.handle('apex:read-json', (_event, key, fallback = null) => {
  return readJsonFile(dataFilePath(key), fallback);
});

ipcMain.handle('apex:write-json', (_event, key, value) => {
  if (key === 'apex_stock_v1') {
    const oldPath = dataFilePath(key);
    const backupDir = path.join(ensureApexFolders(), 'backups');
    fs.mkdirSync(backupDir, {recursive:true});
    if (fs.existsSync(oldPath)) fs.copyFileSync(oldPath, path.join(backupDir, 'stock-' + Date.now() + '.json'));
  }
  writeJsonFile(dataFilePath(key), value);
  return true;
});

ipcMain.handle('apex:protect-secret', (_event, value) => {
  return protectSecret(value);
});

ipcMain.handle('apex:unprotect-secret', (_event, value) => {
  return unprotectSecret(value);
});

ipcMain.handle('apex:word-to-pdf', async (event, filePath = '') => {
  let sourcePath = String(filePath || '').trim();
  if (!sourcePath) {
    const owner = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    const dialogOptions = {
      title: 'Imzalanacak Word belgesini sec',
      properties: ['openFile'],
      filters: [
        { name: 'Word Belgeleri', extensions: ['docx'] }
      ]
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true };
    sourcePath = result.filePaths[0];
  }
  return convertWordDocumentToPdf(sourcePath);
});

function cleanEbeyanApiBaseUrl(value) {
  const fallback = 'https://ebeyanapi.gib.gov.tr/kullanici';
  const url = String(value || fallback).trim().replace(/\/+$/, '');
  if (!/^https:\/\/(ebeyanapi|ebeyanpreprodapi)\.gib\.gov\.tr\/kullanici$/i.test(url)) {
    throw new Error('e-Beyan API adresi yalnızca resmi GİB kullanıcı API adresi olabilir.');
  }
  return url;
}

function apiErrorText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    const messages = parsed && parsed.messages;
    if (Array.isArray(messages)) return messages.map(item => item.message || item.text || JSON.stringify(item)).join(' | ');
    if (messages && typeof messages === 'object') return JSON.stringify(messages);
    return parsed.message || parsed.error || raw.slice(0, 500);
  } catch {
    return raw.slice(0, 500);
  }
}

ipcMain.handle('apex:ebeyan-api-search', async (_event, request = {}) => {
  const apiKey = String(request.apiKey || '').trim().replace(/^Bearer\s+/i, '');
  const taxId = String(request.taxId || '').replace(/\D/g, '');
  const integrator = String(request.integrator || '').trim();
  const type = String(request.declarationType || 'KDV1').trim();
  const start = String(request.periodStart || '').trim();
  const end = String(request.periodEnd || '').trim();
  if (!apiKey) throw new Error('e-Beyan API key girilmemiş.');
  if (!/^\d{10,11}$/.test(taxId)) throw new Error('Mükellef VKN/TCKN 10 veya 11 hane olmalı.');
  if (!integrator) throw new Error('ENTEGRATOR bilgisi girilmemiş. Örnek: VKN-Firma Unvanı');
  if (!type) throw new Error('Beyanname türü seçilmemiş.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error('Vergilendirme dönemi tarih aralığı oluşturulamadı.');
  }

  const baseUrl = cleanEbeyanApiBaseUrl(request.baseUrl);
  const body = {
    beyannameTuru: [type],
    beyannameDurum: ['ONAYLANDI'],
    beyannameDonemTarihi: { baslangic: start, bitis: end },
    page: 0,
    size: 100
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let response = null;
  try {
    response = await fetch(`${baseUrl}/beyanname/mukellef`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        CHANNEL: 'ENTEGRATOR',
        'MUKELLEF-VKN': taxId,
        ENTEGRATOR: integrator,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    const reason = err && err.name === 'AbortError'
      ? 'Bağlantı 30 saniye içinde cevap vermedi.'
      : (err && err.cause && (err.cause.code || err.cause.message)) || err.message || String(err);
    throw new Error(`e-Beyan API adresine ulaşılamadı. İnternet, DNS, güvenlik duvarı veya GİB API erişim yetkisi engelliyor olabilir. Teknik ayrıntı: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    throw new Error(`e-Beyan API ${response.status} döndü. ${apiErrorText(text)}`);
  }
  const page = json && json.data ? json.data : {};
  const content = Array.isArray(page.content) ? page.content : [];
  return {
    ok: true,
    status: response.status,
    traceId: json && json.traceId,
    messages: json && json.messages,
    totalItems: Number(page.totalItems || content.length || 0),
    totalPages: Number(page.totalPages || 0),
    currentPage: Number(page.currentPage || 0),
    content
  };
});

ipcMain.handle('apex:save-invoice-pdf', (_event, payload = {}) => {
  return saveInvoicePdf(payload);
});



ipcMain.handle('apex:render-invoice-pdf-page', (_event, payload = {}) => {
  return renderInvoicePdfPage(payload);
});
ipcMain.handle('apex:export-snapshot', () => {
  return createBackupFile('manuel');
});

ipcMain.handle('apex:create-backup', (_event, reason, payload = null) => {
  return createBackupFile(reason, payload);
});

ipcMain.handle('apex:sync-server-info', () => ({
  port: SYNC_PORT,
  addresses: localAddresses(),
  urls: localAddresses().map(address => `http://${address}:${SYNC_PORT}`),
  localUrl: `http://127.0.0.1:${SYNC_PORT}`,
  running: Boolean(syncServer)
}));

ipcMain.handle('apex:check-update', async () => {
  try {
    return await checkForUpdates();
  } catch (err) {
    return {
      ok: false,
      currentVersion: app.getVersion(),
      updateAvailable: false,
      message: err.message || 'GÃ¼ncelleme denetlenemedi.'
    };
  }
});

ipcMain.handle('apex:verify-profile-password', async (_event, password) => {
  const hash = crypto.createHash('sha256').update(String(password || ''), 'utf8').digest('hex');
  return hash === PROFILE_PASSWORD_HASH;
});

ipcMain.handle('apex:open-update-url', async (_event, url) => {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('apex:gib-open', async () => {
  const win = createGibWindow();
  if (!win.webContents.getURL()) {
    await win.loadURL('https://ebeyan.gib.gov.tr/beyannameler');
  }
  win.focus();
  return { ok: true, url: win.webContents.getURL() };
});

ipcMain.handle('apex:gib-open-url', async (_event, url) => {
  const targetUrl = String(url || '').trim();
  if (!/^https:\/\/(intvrg\.gib\.gov\.tr|dijital\.gib\.gov\.tr|ebeyanname\.gib\.gov\.tr|ebeyan\.gib\.gov\.tr)\//i.test(targetUrl)) {
    throw new Error('Sadece GÄ°B/e-Beyanname baÄŸlantÄ±sÄ± aÃ§Ä±labilir.');
  }
  const win = createGibWindow({ show: false });
  await win.loadURL(targetUrl);
  win.hide();
  return { ok: true, url: win.webContents.getURL() };
});

ipcMain.handle('apex:gib-open-url-visible', async (_event, url) => {
  const targetUrl = String(url || '').trim();
  if (!/^https:\/\/(intvrg\.gib\.gov\.tr|dijital\.gib\.gov\.tr|ebeyanname\.gib\.gov\.tr|ebeyan\.gib\.gov\.tr)\//i.test(targetUrl)) {
    throw new Error('Sadece GÄ°B/e-Beyanname baÄŸlantÄ±sÄ± aÃ§Ä±labilir.');
  }
  const win = createGibWindow({ show: true });
  await win.loadURL(targetUrl);
  win.show();
  win.focus();
  return { ok: true, url: win.webContents.getURL() };
});

ipcMain.handle('apex:gib-teach-start', async (_event, url) => {
  const targetUrl = String(url || '').trim();
  const win = createGibWindow({ show: true });
  gibTeachMode = { active: true, clicks: [] };
  if (targetUrl) {
    if (!/^https:\/\/(intvrg\.gib\.gov\.tr|dijital\.gib\.gov\.tr|ebeyanname\.gib\.gov\.tr|ebeyan\.gib\.gov\.tr)\//i.test(targetUrl)) {
      throw new Error('Sadece GÄ°B/e-Beyanname baÄŸlantÄ±sÄ± aÃ§Ä±labilir.');
    }
    await win.loadURL(targetUrl);
  }
  win.show();
  win.focus();
  await injectGibTeachRecorder();
  return { ok: true, url: win.webContents.getURL() };
});

ipcMain.handle('apex:gib-teach-stop', async () => {
  const payload = saveGibTeachModeClicks();
  return { ok: true, count: payload.clicks.length, clicks: payload.clicks };
});

ipcMain.handle('apex:gib-status', async () => {
  if (!gibWindow || gibWindow.isDestroyed()) return { ok: false, open: false };
  return {
    ok: true,
    open: true,
    url: gibWindow.webContents.getURL(),
    title: gibWindow.getTitle()
  };
});

ipcMain.handle('apex:gib-scan', async () => {
  if (!gibWindow || gibWindow.isDestroyed()) throw new Error('Ã–nce GÄ°B oturum penceresini aÃ§Ä±n.');
  const installed = await runGibPageScript();
  if (installed && installed.scriptInstallFailed) throw new Error(installed.message);
  return installed;
});

ipcMain.handle('apex:gib-search', async (_event, request = {}) => {
  if (!gibWindow || gibWindow.isDestroyed()) throw new Error('Ã–nce GÄ°B oturum penceresini aÃ§Ä±n.');
  const prefill = await prefillDijitalLoginFields(request);
  if (prefill && prefill.waitingCaptcha) {
    try {
      prefill.url = gibWindow.webContents.getURL();
      prefill.title = gibWindow.getTitle();
    } catch {}
    return prefill;
  }
  const currentGibUrl = gibWindow.webContents.getURL();
  if (/ebeyan\.gib\.gov\.tr/i.test(currentGibUrl || '') && !/\/beyannameler/i.test(currentGibUrl || '')) {
    await gibWindow.loadURL('https://ebeyan.gib.gov.tr/beyannameler');
    await new Promise(resolve => setTimeout(resolve, 1800));
    return {
      ok: true,
      newEBeyan: true,
      waitingForNewEBeyan: true,
      dijitalStep: 'ebeyan-direct-beyannameler',
      message: 'e-Beyan penceresi yakalandı; Beyannameler sayfasına doğrudan geçildi. Filtreler yüklenince otomatik devam edecek.',
      url: gibWindow.webContents.getURL(),
      title: gibWindow.getTitle()
    };
  }
  const installed = await runGibPageScript();
  if (installed && installed.scriptInstallFailed) {
    try {
      installed.url = gibWindow.webContents.getURL();
      installed.title = gibWindow.getTitle();
    } catch {}
    return installed;
  }
  const taught = readJsonFile(dataFilePath('gib_teach_steps'), { clicks: [] });
  const enrichedRequest = { ...request, taughtClicks: Array.isArray(taught.clicks) ? taught.clicks : [] };
  let result = await gibWindow.webContents.executeJavaScript(
    `window.__apexGib && window.__apexGib.automateSearch(${JSON.stringify(enrichedRequest)})`,
    true
  );
  if (result && (result.dijitalStep === 'ebeyan-card' || result.dijitalStep === 'dijital-wait' || result.waitingPortal)) {
    const native = await nativeClickGibText(['e-Beyan', 'e Beyan'], { exclude: ['e-Beyanname'] });
    if (native.ok) {
      await new Promise(resolve => setTimeout(resolve, 2200));
      result = { ...result, ok: true, nativeClicked: 'e-Beyan', native, message: 'Dijital Vergi Dairesi üzerinde e-Beyan kartına gerçek tıklama gönderildi.' };
    }
  }
  if (result && result.dijitalStep === 'confirm') {
    const native = await nativeClickGibText(['Onayla', 'Tamam', 'Evet']);
    if (native.ok) {
      await new Promise(resolve => setTimeout(resolve, 2200));
      result = { ...result, ok: true, nativeClicked: 'Onayla', native, message: 'e-Beyan geçiş onayı gerçek tıklamayla verildi.' };
    }
  }
  if (result && result.dijitalStep === 'quick-menu') {
    const menu = await nativeClickGibText(['Hızlı Menü', 'Hizli Menu']);
    if (menu.ok) {
      await new Promise(resolve => setTimeout(resolve, 700));
      const declarations = await nativeClickGibText(['Beyannameler']);
      if (declarations.ok) {
        await new Promise(resolve => setTimeout(resolve, 1600));
        result = { ...result, ok: true, nativeClicked: 'Beyannameler', native: declarations, message: 'e-Beyan Hızlı Menüden Beyannameler gerçek tıklamayla açıldı.' };
      }
    }
  }
  if (result && result.appClicked && !result.searchClicked) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    try {
      const secondInstall = await runGibPageScript();
      if (secondInstall && secondInstall.scriptInstallFailed) throw new Error(secondInstall.message);
      const second = await gibWindow.webContents.executeJavaScript(
        `window.__apexGib && window.__apexGib.automateSearch(${JSON.stringify(enrichedRequest)})`,
        true
      );
      result = { ...result, second };
    } catch (err) {
      result = { ...result, secondError: err.message || String(err) };
    }
  }
  const finalResult = result || { ok: false, message: 'GÄ°B sayfasÄ±nda arama otomasyonu baÅŸlatÄ±lamadÄ±.' };
  try {
    finalResult.url = gibWindow.webContents.getURL();
    finalResult.title = gibWindow.getTitle();
  } catch {}
  return finalResult;
});

ipcMain.handle('apex:gib-download-docs', async (_event, request = {}) => {
  if (!gibWindow || gibWindow.isDestroyed()) throw new Error('Ã–nce GÄ°B oturum penceresini aÃ§Ä±n.');
  const rowIndex = Number(request.rowIndex);
  if (!Number.isInteger(rowIndex) || rowIndex < 0) throw new Error('Ä°ndirilecek GÄ°B satÄ±rÄ± seÃ§ilemedi.');
  const results = [];
  for (const kind of ['beyanname', 'tahakkuk']) {
    const savePath = gibArchiveFilePath(request, kind);
    const waiting = waitForDownload(savePath);
    const clickResult = await gibWindow.webContents.executeJavaScript(
      `window.__apexGib && window.__apexGib.clickDocRow(${JSON.stringify(rowIndex)}, ${JSON.stringify(kind)})`,
      true
    );
    if (!clickResult || !clickResult.ok) {
      waiting.cancel();
      throw new Error((clickResult && clickResult.error) || `${kind} simgesi tÄ±klanamadÄ±.`);
    }
    const saved = await waiting.promise;
    results.push({ kind, path: saved.path });
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  return { ok: true, folder: gibArchiveFolder(request), files: results };
});

let installingUpdate=false;
ipcMain.handle('apex:download-and-install-update', async (_event, requested) => {
  if(installingUpdate)throw new Error('Güncelleme zaten hazırlanıyor.');
  installingUpdate=true;
  let partial;
  try {
    const update=await checkForUpdates();
    if(!update.updateAvailable)throw new Error('Apex zaten güncel. Aynı veya eski sürüm tekrar kurulmayacak.');
    if(String(requested?.latestVersion||requested?.version)!==update.latestVersion)throw new Error('Güncelleme bilgisi değişti. Lütfen yeniden kontrol edin.');
    if(!/^https:\/\//i.test(update.downloadUrl))throw new Error('Güvenli kurulum adresi bulunamadı.');
    const target=updateDownloadPath(update.latestVersion);
    partial=target+'.partial';fs.mkdirSync(path.dirname(target),{recursive:true});
    const progress=payload=>{try{_event.sender.send('apex:update-progress',payload)}catch{}};
    progress({phase:'download',percent:0,downloaded:0,total:0});
    await downloadFileWithProgress(update.downloadUrl,partial,progress);
    await require('./updater').verifyInstaller(partial,update);
    fs.renameSync(partial,target);partial=null;
    progress({phase:'install',percent:100,path:target});
    if(!app.isPackaged)throw new Error('Kurulum yalnızca kurulu Apex uygulamasından başlatılabilir.');
    await require('./updater').launch({root:ensureApexFolders(),installer:target,exe:process.execPath,version:update.latestVersion,appPid:process.pid,sha256:update.sha256});
    setTimeout(()=>app.quit(),500);
    return{ok:true,path:target};
  }catch(error){if(partial)try{fs.unlinkSync(partial)}catch{}installingUpdate=false;throw error;}
});

app.whenReady().then(async () => {
  app.setName(APP_NAME);
  app.setAppUserModelId('com.kasim.apex');
  if(!primaryInstance)return;
  if(process.argv.includes('--fis-asistani'))require('./receipt-desktop').standalone();else createWindow();
});

app.on('window-all-closed', () => {
  if (readerProcess && !readerProcess.killed) {
    try { readerProcess.kill(); } catch {}
  }
  if (syncServer) {
    try { syncServer.close(); } catch {}
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});




ipcMain.handle('apex:stock-pdf', async (event, payload) => {
  if (!payload || typeof payload.html !== 'string' || payload.html.length > 15000000) throw new Error('Rapor boyutu geçersiz.');
  const owner = BrowserWindow.fromWebContents(event.sender);
  const chosen = await dialog.showSaveDialog(owner, {title:'Stok Takip PDF kaydet', defaultPath:path.join(ensureApexFolders(),'exports',path.basename(String(payload.fileName||'Stok-Takip.pdf'))), filters:[{name:'PDF',extensions:['pdf']}]});
  if(chosen.canceled) return {canceled:true};
  const win = new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,javascript:false}});
  try {
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(payload.html));
    const data = await win.webContents.printToPDF({landscape:true,printBackground:true,pageSize:'A4',margins:{top:0.4,bottom:0.4,left:0.4,right:0.4}});
    fs.writeFileSync(chosen.filePath,data);return {ok:true};
  } finally {win.destroy();}
});

// Fiş Asistanı: yerel çocuk pencere, ortak kayıt klasörü, kurulumdan önce etkinleşmez.
const receiptHosts=new Map();
ipcMain.handle('apex:receipt-layout',async(event,payload={})=>{
  if(event.senderFrame!==event.sender.mainFrame)throw new Error('İşlem yalnız ana Apex ekranından yapılabilir.');
  const {fileURLToPath}=require('url');
  let senderPath='';try{senderPath=fileURLToPath(event.senderFrame.url.split('?')[0]);}catch{}
  if(path.resolve(senderPath)!==path.resolve(appRoot(),'index.html'))throw new Error('Geçersiz ekran.');
  const win=BrowserWindow.fromWebContents(event.sender);if(!win)throw new Error('Apex penceresi bulunamadı.');
  let host=receiptHosts.get(event.sender.id);
  if(!host){
    if(!payload.visible&&!payload.preload)return true;
    const config=JSON.parse(fs.readFileSync(path.join(__dirname,'receipt-integration.json'),'utf8'));
    host=new (require('./receipt-desktop').ReceiptHost)(win,config);receiptHosts.set(event.sender.id,host);
    let approvedClose=false,checking=false;
    win.on('close',event=>{
      if(approvedClose||!host.view)return;
      event.preventDefault();if(checking)return;checking=true;
      host.close().then(ok=>{
        if(ok){approvedClose=true;win.close();}
        else dialog.showMessageBox(win,{type:'info',message:'Fiş Asistanı açık işlemi korudu.',detail:'Yükleme sürüyorsa tamamlanmasını bekleyin. Düzenlediğiniz kaydı kaydedip yeniden kapatın.'});
      }).catch(error=>dialog.showMessageBox(win,{type:'error',message:error.message})).finally(()=>checking=false);
    });
    win.once('closed',()=>{receiptHosts.delete(event.sender.id);host.child?.stdin.end();});
  }
  const {screen}=require('electron');
  const scale=screen.getDisplayMatching(win.getBounds()).scaleFactor*event.sender.getZoomFactor();
  if(payload.preload){await host.start();return true;}
  return host.layout(payload.rect,payload.visible,scale);
});

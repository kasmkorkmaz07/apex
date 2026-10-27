const http = require('http');
const { request: httpsRequest } = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 4177);
const HOST = '127.0.0.1';
const PUBLIC_DIR = __dirname;
const STAMP_SIGNATURE_HTML = path.resolve(PUBLIC_DIR, '..', 'KASE-IMZA', 'imza-kase-masaustu.html');
const DATA_DIR = process.env.APEX_TAHAKKUK_DATA || 'C:\\Users\\kasim\\Documents\\Apex\\data\\tahakkuk-gonder';
const CLIENTS_PATH = path.join(DATA_DIR, 'mukellefler.json');
const SECRET_PATH = path.join(DATA_DIR, 'mobile-secret.json');
const CLOUDFLARE_CONFIG_PATH = process.env.APEX_CLOUD_CONFIG || path.join(DATA_DIR, 'cloudflare-r2.json');
const CLOUDFLARE_STATE_PATH = process.env.APEX_SYNC_STATE || path.join(DATA_DIR, 'cloudflare-state.json');
const ZIRVE_ROOT = process.env.ZIRVE_ROOT || '\\\\DESKTOP-MLBT1CR\\zirvenet\\zirvedata';
const JOB_DIR = path.join(DATA_DIR, 'temp-downloads');
const mobileSecret = loadMobileSecret();
const LOGIN_USER = process.env.APEX_MOBILE_USER || mobileSecret.username;
let LOGIN_PASS = process.env.APEX_MOBILE_PASS || mobileSecret.password;
const AUTH_DISABLED = true;
const sessions = new Set();
const downloadJobs = new Map();
const cloudDeleteJobs = new Map();
const childFolderCache = new Map();
const documentFolderCache = new Map();
const cloudState = {
  lastSyncAt: null,
  lastError: null,
  lastFullSyncAt: null,
  lastFullSyncStats: null,
  usage: null,
  usageDirty: false,
  usagePublishCounter: 0,
  usagePublishAt: 0,
  lastSyncRequestAt: null,
  lastCompletedRequestAt: null,
  enabled: false,
  configured: false,
  syncing: false,
  progress: null
};

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.pdf': 'application/pdf'
};

const typeCodes = {
  kdv1: 'KDV1',
  kdv2: 'KDV2',
  kdv4: 'KDV4',
  muhsgk: 'MUHSGK',
  ebildirge: 'EBILDIRGE',
  gelir: 'GELIR',
  ggecici: 'GGECICI',
  kgecici: 'KGECICI',
  kurumlar: 'KURUMLAR',
  hizmet: 'HIZMET',
  levha: 'LEVHA'
};

function loadMobileSecret() {
  if (fs.existsSync(SECRET_PATH)) {
    return JSON.parse(fs.readFileSync(SECRET_PATH, 'utf8'));
  }
  const secret = {
    username: 'kasim',
    password: crypto.randomBytes(6).toString('base64url'),
    createdAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, JSON.stringify(secret, null, 2), 'utf8');
  return secret;
}

function loadCloudflareConfig() {
  if(process.env.APEX_PHONE_CONFIG)return {...JSON.parse(process.env.APEX_PHONE_CONFIG),configured:true};
  if (!fs.existsSync(CLOUDFLARE_CONFIG_PATH)) {
    return { enabled: false, configured: false };
  }
  const config = JSON.parse(fs.readFileSync(CLOUDFLARE_CONFIG_PATH, 'utf8'));
  const required = ['accountId', 'bucket', 'accessKeyId', 'secretAccessKey', 'encryptionKeyBase64'];
  const configured = required.every(key => {
    const value = String(config[key] || '').trim();
    return value &&
      !value.includes('Cloudflare') &&
      !value.includes('R2 ') &&
      !value.includes('32-byte') &&
      !value.includes('Access Key') &&
      !value.includes('Secret Access');
  });
  return {
    enabled: Boolean(config.enabled && configured),
    configured,
    accountId: config.accountId,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    prefix: config.prefix || 'tahakkuk-gonder',
    encryptionKeyBase64: config.encryptionKeyBase64,
    fullArchive: {
      enabled: config.fullArchive?.enabled !== false,
      startYear: Number(config.fullArchive?.startYear || 2023),
      hourly: config.fullArchive?.hourly !== false
    }
  };
}

function cloudflareStatus() {
  const config = loadCloudflareConfig();
  cloudState.enabled = config.enabled;
  cloudState.configured = config.configured;
  return {
    service: 'apex-archive-sync-v2',
    lastSyncRequestAt: cloudState.lastSyncRequestAt,
    lastCompletedRequestAt: cloudState.lastCompletedRequestAt,
    enabled: cloudState.enabled,
    configured: cloudState.configured,
    lastSyncAt: cloudState.lastSyncAt,
    lastFullSyncAt: cloudState.lastFullSyncAt,
    lastFullSyncStats: cloudState.lastFullSyncStats,
    usage: cloudState.usage,
    lastError: cloudState.lastError,
    syncing: cloudState.syncing,
    progress: cloudState.progress
  };
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index > -1) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return out;
}

function isAuthed(req) {
  if (AUTH_DISABLED) return true;
  const sid = parseCookies(req).apex_mobile_sid;
  return Boolean(sid && sessions.has(sid));
}

function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  json(res, 401, { error: 'Oturum yok. Lutfen giris yap.' });
  return false;
}

function isLocalRequest(req) {
  const address = String(req.socket.remoteAddress || '');
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/İ/g, 'I')
    .replace(/[^A-Z0-9]/g, '');
}

function safeName(value) {
  return String(value || 'belge')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'belge';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error('Istek cok buyuk.'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Gecersiz JSON.'));
      }
    });
  });
}

function readClients() {
  const raw = fs.readFileSync(CLIENTS_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed
    .filter(client => client && client.Id && client.Unvan && client.Klasor)
    .map(client => ({
      id: client.Id,
      name: client.Unvan,
      folder: client.Klasor
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

function readRawClients() {
  if (!fs.existsSync(CLIENTS_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(CLIENTS_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRawClients(clients) {
  fs.mkdirSync(path.dirname(CLIENTS_PATH), { recursive: true });
  fs.writeFileSync(CLIENTS_PATH, JSON.stringify(Array.isArray(clients) ? clients : [], null, 2), 'utf8');
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function makeClientId(unvan, folder) {
  return `m-${normalize(`${folder || ''}-${unvan || ''}`) || crypto.randomBytes(5).toString('hex')}`;
}

function normalizePendingClient(input) {
  const unvan = String(input?.Unvan || input?.unvan || input?.name || '').trim();
  const folder = String(input?.Klasor || input?.folder || '').trim();
  if (!unvan || !folder) throw new Error('Unvan ve Zirve klasor adi zorunlu.');
  const phone = normalizePhone(input?.Telefon || input?.phone || '');
  return {
    Id: String(input?.Id || input?.id || makeClientId(unvan, folder)),
    Unvan: unvan,
    Telefon: phone,
    Klasor: folder,
    cloudPendingAt: input?.createdAt || new Date().toISOString()
  };
}

function findChildFolder(parent, wanted) {
  if (!parent || !fs.existsSync(parent)) return '';
  const cacheKey = `${parent.toLocaleLowerCase('tr-TR')}|${normalize(wanted)}`;
  if (childFolderCache.has(cacheKey)) return childFolderCache.get(cacheKey);
  const target = normalize(wanted);
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    if (entry.isDirectory() && normalize(entry.name) === target) {
      const found = path.join(parent, entry.name);
      childFolderCache.set(cacheKey, found);
      return found;
    }
  }
  childFolderCache.set(cacheKey, '');
  return '';
}

function documentFolder(client, source, code) {
  const cacheKey = `${client.folder}|${source}|${code}`;
  if (documentFolderCache.has(cacheKey)) return documentFolderCache.get(cacheKey);
  const clientRoot = path.join(ZIRVE_ROOT, client.folder);
  const docs = findChildFolder(clientRoot, 'DOKUMANLAR');
  if (!docs) {
    documentFolderCache.set(cacheKey, '');
    return '';
  }

  let folder = '';

  if (code === 'LEVHA') folder = findChildFolder(docs, 'VERGI LEVHALARI');
  else if (code === 'HIZMET') {
    const eb = findChildFolder(docs, 'E BILDIRGE');
    folder = eb ? findChildFolder(eb, 'HIZMET LISTESI') : '';
  } else if (source === 'tahakkuk') {
    if (code === 'EBILDIRGE') {
      const eb = findChildFolder(docs, 'E BILDIRGE');
      folder = eb ? findChildFolder(eb, 'TAHAKKUK') : '';
    } else {
      folder = findChildFolder(docs, 'TAHAKKUK');
    }
  } else if (source === 'beyanname' && code !== 'EBILDIRGE') {
    folder = findChildFolder(docs, 'BEYANNAME');
  }

  documentFolderCache.set(cacheKey, folder);
  return folder;
}

function patternsFor(code, year, month, source) {
  if (code === 'EBILDIRGE') return [new RegExp(`^${year}_${month}.*\\.pdf$`, 'i')];
  if (code === 'HIZMET') return [new RegExp(`^${year}_${month}.*\\.pdf$`, 'i')];
  if (code === 'LEVHA') return [/\.pdf$/i];

  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    `^${escaped}_${month}_${year}.*\\.pdf$`,
    `^${escaped}_${month}_${year}_${month}_${year}.*\\.pdf$`,
    `^${escaped}_.*_${month}_${year}.*\\.pdf$`
  ];
  if (source === 'tahakkuk') patterns.push(`^${escaped}_TAHAKKUK_${month}_${year}.*\\.pdf$`);
  if (source === 'beyanname') {
    patterns.push(`^${escaped}_BEYANNAME_${month}_${year}.*\\.pdf$`);
    patterns.push(`^${escaped}_.*BEYANNAME.*${month}.*${year}.*\\.pdf$`);
  }
  return patterns.map(pattern => new RegExp(pattern, 'i'));
}

function newestOnly(code) {
  return code !== 'EBILDIRGE' && code !== 'HIZMET';
}

function filesFor(client, source, type, year, month) {
  const code = typeCodes[type];
  if (!code) return [];
  const folder = documentFolder(client, source, code);
  if (!folder || !fs.existsSync(folder)) return [];

  const patterns = patternsFor(code, year, month, source);
  const matches = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!patterns.some(pattern => pattern.test(entry.name))) continue;
    const filePath = path.join(folder, entry.name);
    const stat = fs.statSync(filePath);
    matches.push({ path: filePath, name: entry.name, mtimeMs: stat.mtimeMs });
  }

  matches.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name, 'tr'));
  return newestOnly(code) ? matches.slice(0, 1) : matches;
}

function collectFiles(payload) {
  const clients = readClients();
  const byId = new Map(clients.map(client => [client.id, client]));
  const selectedClients = (payload.clientIds || []).map(id => byId.get(id)).filter(Boolean);
  const sources = (payload.sources || []).filter(value => value === 'tahakkuk' || value === 'beyanname');
  const types = (payload.types || []).filter(value => typeCodes[value]);
  const years = (payload.years || []).map(String).filter(Boolean);
  const months = (payload.months || []).map(value => String(value).padStart(2, '0')).filter(value => /^\d{2}$/.test(value));

  if (!selectedClients.length) throw new Error('En az bir firma secmelisin.');
  if (!sources.length) throw new Error('Kaynak secmelisin.');
  if (!types.length) throw new Error('Tur secmelisin.');
  if (!years.length) throw new Error('Yil secmelisin.');
  if (!months.length) throw new Error('Ay secmelisin.');

  const found = [];
  const seenFiles = new Set();
  const missing = [];

  for (const client of selectedClients) {
    for (const source of sources) {
      for (const type of types) {
        for (const year of years) {
          for (const month of months) {
            const files = filesFor(client, source, type, year, month);
            if (files.length) {
              files.forEach(file => {
                const key = file.path.toLocaleLowerCase('tr-TR');
                if (!seenFiles.has(key)) {
                  seenFiles.add(key);
                  found.push({ client, source, type, year, month, file });
                }
              });
            } else {
              missing.push(`${client.name} - ${source} - ${typeCodes[type]} - ${month}/${year}`);
            }
          }
        }
      }
    }
  }

  if (!found.length) {
    const detail = missing.slice(0, 18).join('\n');
    throw new Error(`Secime uygun PDF bulunamadi.${detail ? `\n\n${detail}` : ''}`);
  }

  return { found, missing };
}

function prepareDownload(payload) {
  const { found, missing } = collectFiles(payload);

  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const used = new Map();
  const downloads = found.map((item, index) => {
    const base = safeName(`${item.client.name} - ${item.source} - ${typeCodes[item.type]} - ${item.month}-${item.year} - ${path.basename(item.file.name, '.pdf')}`);
    const key = base.toLocaleLowerCase('tr-TR');
    const count = used.get(key) || 0;
    used.set(key, count + 1);
    const fileName = `${base}${count ? `-${count + 1}` : ''}.pdf`;
    return {
      index,
      fileName,
      originalName: item.file.name,
      clientName: item.client.name,
      source: item.source,
      type: item.type,
      year: item.year,
      month: item.month,
      path: item.file.path,
      url: `/api/file/${encodeURIComponent(jobId)}/${index}/${encodeURIComponent(fileName)}`
    };
  });

  downloadJobs.set(jobId, {
    createdAt: Date.now(),
    downloads
  });

  return {
    jobId,
    files: downloads.map(({ path: _path, ...download }) => download),
    count: downloads.length,
    missing
  };
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest(encoding);
}

function sha256(value, encoding = 'hex') {
  return crypto.createHash('sha256').update(value).digest(encoding);
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encryptForCloud(buffer, keyBase64) {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('Cloudflare sifreleme anahtari 32 byte base64 olmali.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { body: encrypted, iv: iv.toString('base64'), tag: tag.toString('base64') };
}

function readCloudFileState() {
  if (!fs.existsSync(CLOUDFLARE_STATE_PATH)) return { files: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(CLOUDFLARE_STATE_PATH, 'utf8'));
    return parsed && parsed.files ? parsed : { files: {} };
  } catch {
    return { files: {} };
  }
}

function writeCloudFileState(state) {
  fs.mkdirSync(path.dirname(CLOUDFLARE_STATE_PATH), { recursive: true });
  fs.writeFileSync(CLOUDFLARE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function fileFingerprint(filePath) {
  const stat = fs.statSync(filePath);
  return `${stat.size}:${Math.round(stat.mtimeMs)}`;
}

function r2SignedRequest(config, { method = 'GET', key = '', query = {}, body = Buffer.alloc(0), headers = {} }) {
  if(config.relayServer)return relayRequest(config,{method,key,query,body,headers}).then(x=>x.body.toString('utf8'));
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const keyPath = key ? `/${key.split('/').map(awsEncode).join('/')}` : '';
  const objectPath = `/${config.bucket}${keyPath}`;
  const canonicalQuery = Object.keys(query)
    .filter(name => query[name] !== undefined && query[name] !== null)
    .sort()
    .map(name => `${awsEncode(name)}=${awsEncode(String(query[name]))}`)
    .join('&');
  const requestPath = `${objectPath}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const baseHeaders = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...headers
  };
  const signedHeaderNames = Object.keys(baseHeaders).map(name => name.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames.map(name => `${name}:${String(baseHeaders[name]).trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, objectPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${date}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      method,
      hostname: host,
      path: requestPath,
      headers: {
        ...baseHeaders,
        authorization,
        'content-length': body.length
      }
    }, res => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(responseBody);
        else {
          const error = new Error(`R2 istek hatasi ${res.statusCode}: ${responseBody}`);
          error.statusCode = res.statusCode;
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function r2RequestWithRetry(config, request, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await r2SignedRequest(config, request);
    } catch (error) {
      lastError = error;
      const status = Number(error?.statusCode || 0);
      if (!(status === 429 || status >= 500) || attempt === attempts) break;
      await new Promise(resolve => setTimeout(resolve, 750 * attempt));
    }
  }
  throw lastError;
}

function r2PutObject(config, key, body, headers = {}) {
  return r2RequestWithRetry(config, { method: 'PUT', key, body, headers });
}

function r2DeleteObject(config, key) {
  return r2RequestWithRetry(config, { method: 'DELETE', key });
}

function r2GetObjectBuffer(config, key) {
  if(config.relayServer)return relayRequest(config,{key});
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const keyPath = key ? `/${key.split('/').map(awsEncode).join('/')}` : '';
  const objectPath = `/${config.bucket}${keyPath}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(Buffer.alloc(0));
  const baseHeaders = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  const signedHeaderNames = Object.keys(baseHeaders).map(name => name.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames.map(name => `${name}:${String(baseHeaders[name]).trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = ['GET', objectPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${date}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      method: 'GET',
      hostname: host,
      path: objectPath,
      headers: {
        ...baseHeaders,
        authorization,
        'content-length': 0
      }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ body, headers: res.headers });
        } else {
          const error = new Error(`R2 istek hatasi ${res.statusCode}: ${body.toString('utf8')}`);
          error.statusCode = res.statusCode;
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function decryptCloudBuffer(buffer, headers, keyBase64) {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('Cloudflare sifreleme anahtari 32 byte base64 olmali.');
  const iv = Buffer.from(String(headers['x-amz-meta-apex-iv'] || ''), 'base64');
  const tag = Buffer.from(String(headers['x-amz-meta-apex-tag'] || ''), 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Dosya sifre bilgisi eksik.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

function decodeBase64Text(value) {
  try {
    return Buffer.from(String(value || ''), 'base64').toString('utf8') || 'belge.pdf';
  } catch {
    return 'belge.pdf';
  }
}

function saveMobileSecret(next) {
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, JSON.stringify(next, null, 2), 'utf8');
}

function makeUsage(bytes, objects, extra = {}) {
  const freeBytes = 10 * 1024 * 1024 * 1024;
  return {
    bytes: Math.max(0, Number(bytes || 0)),
    objects: Math.max(0, Number(objects || 0)),
    freeBytes,
    percent: freeBytes ? Math.min(100, Number(((Math.max(0, Number(bytes || 0)) / freeBytes) * 100).toFixed(2))) : 0,
    checkedAt: new Date().toISOString(),
    ...extra
  };
}

function touchLiveUsage({ bytesDelta = 0, objectsDelta = 0, objects = null, phase = 'syncing' } = {}) {
  const current = cloudState.usage || makeUsage(0, 0, { source: 'live-sync' });
  cloudState.usage = makeUsage(
    Number(current.bytes || 0) + Number(bytesDelta || 0),
    objects === null ? Number(current.objects || 0) + Number(objectsDelta || 0) : Number(objects || 0),
    {
      source: 'live-sync',
      phase,
      syncing: cloudState.syncing,
      progress: cloudState.progress
    }
  );
  cloudState.usageDirty = true;
  return cloudState.usage;
}

async function publishLiveUsage(config, force = false) {
  if (!cloudState.usage || (!cloudState.usageDirty && !force)) return cloudState.usage;
  const now = Date.now();
  cloudState.usagePublishCounter += 1;
  if (!force && now - cloudState.usagePublishAt < 30000) {
    return cloudState.usage;
  }
  cloudState.usagePublishAt = now;
  cloudState.usageDirty = false;
  await r2PutObject(config, `${config.prefix}/usage.json`, Buffer.from(JSON.stringify(cloudState.usage, null, 2), 'utf8'), {
    'content-type': 'application/json; charset=utf-8'
  });
  return cloudState.usage;
}

async function r2GetText(config, key) {
  try {
    return await r2RequestWithRetry(config, { method: 'GET', key });
  } catch (error) {
    if (error.statusCode === 404 || String(error.message || error).includes('R2 istek hatasi 404')) return '';
    throw error;
  }
}

function xmlText(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function calculateCloudUsage() {
  const config = loadCloudflareConfig();
  if (!config.enabled) {
    throw new Error('Cloudflare R2 ayarlari aktif degil.');
  }

  const objectsList = await listCloudObjects(config);
  const bytes = objectsList.reduce((sum, item) => sum + item.size, 0);
  const objects = objectsList.length;
  const usage = makeUsage(bytes, objects, { source: 'r2-list', phase: cloudState.syncing ? 'syncing' : 'idle' });
  cloudState.usage = usage;
  cloudState.usageDirty = true;
  try { await publishLiveUsage(config, true); } catch {}
  return usage;
}

async function listCloudObjects(config) {
  let continuationToken = '';
  const objects = [];
  do {
    const query = {
      'list-type': '2',
      prefix: `${config.prefix}/`,
      'max-keys': '1000'
    };
    if (continuationToken) query['continuation-token'] = continuationToken;
    const xml = await r2RequestWithRetry(config, { method: 'GET', query });
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = match[1];
      const keyMatch = block.match(/<Key>([\s\S]*?)<\/Key>/);
      const sizeMatch = block.match(/<Size>(\d+)<\/Size>/);
      const modifiedMatch = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/);
      if (!keyMatch) continue;
      objects.push({
        key: xmlText(keyMatch[1]),
        size: sizeMatch ? Number(sizeMatch[1]) : 0,
        modifiedAt: modifiedMatch ? xmlText(modifiedMatch[1]) : null
      });
    }
    const tokenMatch = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
    continuationToken = tokenMatch ? xmlText(tokenMatch[1]) : '';
  } while (continuationToken);
  return objects;
}

async function rebuildCloudManifestFromObjects() {
  const config = loadCloudflareConfig();
  if (!config.enabled) {
    throw new Error('Cloudflare R2 ayarlari aktif degil.');
  }
  const clients = readClients();
  const byFolder = new Map(clients.map(client => [safeName(client.folder).toLocaleLowerCase('tr-TR'), client]));
  const typeByCode = Object.fromEntries(Object.entries(typeCodes).map(([type, code]) => [code, type]));
  const items = [];

  for (const object of await listCloudObjects(config)) {
    if (!object.key.endsWith('.pdf.enc')) continue;
    const parts = object.key.split('/');
    if (parts.length < 7) continue;
    const [prefix, clientFolder, year, month, source, typeCode] = parts;
    if (prefix !== config.prefix) continue;
    const client = byFolder.get(clientFolder.toLocaleLowerCase('tr-TR')) || {
      id: clientFolder,
      name: clientFolder.replace(/_/g, ' '),
      folder: clientFolder
    };
    const originalName = parts.slice(6).join('/').replace(/\.enc$/i, '');
    items.push({
      key: object.key,
      clientId: client.id,
      clientName: client.name,
      clientFolder: client.folder,
      source,
      type: typeByCode[typeCode] || typeCode.toLocaleLowerCase('tr-TR'),
      typeCode,
      year,
      month,
      originalName,
      size: object.size,
      modifiedAt: object.modifiedAt
    });
  }

  items.sort((a, b) =>
    String(a.clientName || '').localeCompare(String(b.clientName || ''), 'tr') ||
    String(b.year || '').localeCompare(String(a.year || '')) ||
    String(a.month || '').localeCompare(String(b.month || '')) ||
    String(a.type || '').localeCompare(String(b.type || ''))
  );

  const manifest = {
    updatedAt: new Date().toISOString(),
    reason: 'rebuild-from-r2',
    count: items.length,
    items
  };
  await r2PutObject(config, `${config.prefix}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), {
    'content-type': 'application/json; charset=utf-8'
  });
  cloudState.lastSyncAt = manifest.updatedAt;
  cloudState.lastError = null;
  await calculateCloudUsage().catch(() => null);
  return { count: items.length, updatedAt: manifest.updatedAt };
}

function cloudKey(config, item) {
  const parts = [
    config.prefix,
    safeName(item.client.folder || item.client.name),
    item.year,
    item.month,
    item.source,
    typeCodes[item.type],
    `${safeName(path.basename(item.file.name, '.pdf'))}.pdf.enc`
  ];
  return parts.filter(Boolean).join('/');
}

async function uploadCloudItem(config, item) {
  const original = fs.readFileSync(item.file.path);
  const encrypted = encryptForCloud(original, config.encryptionKeyBase64);
  const key = cloudKey(config, item);
  await r2PutObject(config, key, encrypted.body, {
    'content-type': 'application/octet-stream',
    'x-amz-meta-apex-encrypted': 'aes-256-gcm',
    'x-amz-meta-apex-iv': encrypted.iv,
    'x-amz-meta-apex-tag': encrypted.tag,
    'x-amz-meta-apex-original-name': Buffer.from(item.file.name, 'utf8').toString('base64')
  });
  item.cloudSize = encrypted.body.length;
  return key;
}

async function syncSelectionToCloud(payload) {
  const config = loadCloudflareConfig();
  if (!config.enabled) {
    throw new Error('Cloudflare R2 ayarlari aktif degil. cloudflare-r2.json dosyasini doldurup enabled=true yapmalisin.');
  }
  const { found, missing } = collectFiles(payload);
  const uploaded = [];
  const deletedRules = await readDeletedRules(config);

  for (const item of found) {
    const candidateKey = cloudKey(config, item);
    if (isDeletedBlocked(deletedRules, item, candidateKey)) continue;
    const key = await uploadCloudItem(config, item);
    uploaded.push({
      key,
      clientId: item.client.id,
      clientName: item.client.name,
      clientFolder: item.client.folder,
      source: item.source,
      type: item.type,
      typeCode: typeCodes[item.type],
      year: item.year,
      month: item.month,
      originalName: item.file.name,
      size: fs.statSync(item.file.path).size,
      modifiedAt: new Date(item.file.mtimeMs).toISOString()
    });
  }

  let existingItems = [];
  const existingManifestText = await r2GetText(config, `${config.prefix}/manifest.json`);
  if (existingManifestText) {
    try {
      existingItems = JSON.parse(existingManifestText).items || [];
    } catch {
      existingItems = [];
    }
  }
  const merged = new Map();
  for (const item of existingItems) merged.set(item.key, item);
  for (const item of uploaded) merged.set(item.key, item);
  let manifestItems = [...merged.values()].sort((a, b) =>
    String(a.clientName || '').localeCompare(String(b.clientName || ''), 'tr') ||
    String(b.year || '').localeCompare(String(a.year || '')) ||
    String(a.month || '').localeCompare(String(b.month || '')) ||
    String(a.type || '').localeCompare(String(b.type || ''))
  );
  const updatedAt = new Date().toISOString();
  const latestDeleted = await readDeletedRules(config);
  manifestItems = manifestItems.filter(item => !isDeletedBlocked(latestDeleted,item,item.key));
  const manifest = Buffer.from(JSON.stringify({
    updatedAt,
    reason: 'selection',
    count: manifestItems.length,
    items: manifestItems
  }, null, 2), 'utf8');
  await r2PutObject(config, `${config.prefix}/manifest.json`, manifest, {
    'content-type': 'application/json; charset=utf-8'
  });
  await r2PutObject(config, `${config.prefix}/manifest-last-selection.json`, manifest, {
    'content-type': 'application/json; charset=utf-8'
  });

  cloudState.lastSyncAt = updatedAt;
  cloudState.lastError = null;
  calculateCloudUsage().catch(() => {});
  return { uploaded: uploaded.length, total: manifestItems.length, missing };
}

function arr(value) {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
}

function matchesDeleteFilters(item, filters = {}) {
  const clientIds = new Set(arr(filters.clientIds));
  const clientNames = new Set(arr(filters.clientNames).map(normalize));
  const clientFolders = new Set(arr(filters.clientFolders).map(normalize));
  const years = new Set(arr(filters.years));
  const months = new Set(arr(filters.months));
  const sources = new Set(arr(filters.sources));
  const types = new Set(arr(filters.types));
  if (clientIds.size && !clientIds.has(String(item.clientId || ''))) return false;
  if (clientNames.size && !clientNames.has(normalize(item.clientName || ''))) return false;
  if (clientFolders.size && !clientFolders.has(normalize(item.clientFolder || ''))) return false;
  if (years.size && !years.has(String(item.year || ''))) return false;
  if (months.size && !months.has(String(item.month || ''))) return false;
  if (sources.size && !sources.has(String(item.source || ''))) return false;
  if (types.size && !types.has(String(item.type || ''))) return false;
  return clientIds.size || clientNames.size || clientFolders.size || years.size || months.size || sources.size || types.size;
}

async function readArchiveManifest(config) {
  const text = await r2GetText(config, `${config.prefix}/manifest.json`);
  if (!text) return { updatedAt: null, count: 0, clients: [], items: [] };
  try {
    const parsed = JSON.parse(text);
    return {
      updatedAt: parsed.updatedAt || null,
      count: Number(parsed.count || (parsed.items || []).length),
      clients: Array.isArray(parsed.clients) ? parsed.clients : [],
      items: Array.isArray(parsed.items) ? parsed.items : []
    };
  } catch {
    return { updatedAt: null, count: 0, clients: [], items: [] };
  }
}

function deletedRuleId(item) {
  return `${item.key || ''}|${item.clientId || ''}|${item.year || ''}|${item.month || ''}|${item.source || ''}|${item.type || ''}|${item.originalName || ''}`;
}

async function readDeletedRules(config) {
  const text = await r2GetText(config, `${config.prefix}/deleted-rules.json`);
  if (!text) return { updatedAt: null, count: 0, items: [] };
  try {
    const parsed = JSON.parse(text);
    return {
      updatedAt: parsed.updatedAt || null,
      count: Number(parsed.count || (parsed.items || []).length),
      items: Array.isArray(parsed.items) ? parsed.items : []
    };
  } catch {
    return { updatedAt: null, count: 0, items: [] };
  }
}

async function writeDeletedRules(config, items) {
  const data = { updatedAt: new Date().toISOString(), count: items.length, items };
  await r2PutObject(config, `${config.prefix}/deleted-rules.json`, Buffer.from(JSON.stringify(data, null, 2), 'utf8'), {
    'content-type': 'application/json; charset=utf-8'
  });
  return data;
}

function archiveItemMetadata(item, key = '') {
  return {
    key,
    clientId: item.client?.id || item.clientId,
    clientName: item.client?.name || item.clientName,
    clientFolder: item.client?.folder || item.clientFolder,
    source: item.source,
    type: item.type,
    year: item.year,
    month: item.month,
    originalName: item.file?.name || item.originalName
  };
}

function sameDeletedDocument(rule, item) {
  if (!rule || !item) return false;
  if (rule.key && item.key && String(rule.key) === String(item.key)) return true;
  return String(rule.clientId || '') === String(item.clientId || '')
    && normalize(rule.clientFolder || '') === normalize(item.clientFolder || '')
    && String(rule.year || '') === String(item.year || '')
    && String(rule.month || '') === String(item.month || '')
    && String(rule.source || '') === String(item.source || '')
    && String(rule.type || '') === String(item.type || '')
    && String(rule.originalName || '') === String(item.originalName || '');
}

const deletedIndexes = new WeakMap();
function deletionIdentity(x) { return [x.clientId||'',normalize(x.clientFolder||''),x.year||'',x.month||'',x.source||'',x.type||'',x.originalName||''].join('\u001f'); }
function isDeletedBlocked(deletedRules,item,key='') {
  let index=deletedIndexes.get(deletedRules);
  if(!index){index={keys:new Set((deletedRules.items||[]).filter(x=>x.key).map(x=>x.key)),ids:new Set((deletedRules.items||[]).map(deletionIdentity))};deletedIndexes.set(deletedRules,index)}
  const meta=archiveItemMetadata(item,key);
  return index.keys.has(meta.key)||index.ids.has(deletionIdentity(meta));
}

async function rememberDeletedTargets(config, targets, filters = {}, deletedBy = 'desktop') {
  const deleted = await readDeletedRules(config);
  const map = new Map((deleted.items || []).map(item => [item.id || deletedRuleId(item), item]));
  for (const target of targets) {
    const item = {
      ...target,
      id: target.id || deletedRuleId(target),
      deletedAt: new Date().toISOString(),
      deletedBy,
      deleteFilters: filters
    };
    map.set(item.id, item);
  }
  await writeDeletedRules(config, [...map.values()]);
}

async function writeManifestItems(config, reason, clients, items) {
  const updatedAt = new Date().toISOString();
  const manifest = {
    updatedAt,
    reason,
    clients: Array.isArray(clients) ? clients : [],
    count: items.length,
    items
  };
  await r2PutObject(config, `${config.prefix}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), {
    'content-type': 'application/json; charset=utf-8'
  });
  cloudState.lastSyncAt = updatedAt;
  return manifest;
}

async function updateArchiveClientNames(config, reason = 'client-name-refresh') {
  if (!config.enabled) return { updated: false, changedItems: 0 };
  const manifest = await readArchiveManifest(config);
  const clients = readClients();
  const byId = new Map(clients.map(client => [String(client.id || ''), client]));
  const byFolder = new Map(clients.map(client => [normalize(client.folder || ''), client]));
  const manifestClients = clients.map(client => ({
    id: client.id,
    name: client.name,
    folder: client.folder
  }));
  let changedItems = 0;
  const items = manifest.items.map(item => {
    const client = byId.get(String(item.clientId || '')) || byFolder.get(normalize(item.clientFolder || ''));
    if (!client) return item;
    if (item.clientId === client.id && item.clientName === client.name && item.clientFolder === client.folder) return item;
    changedItems += 1;
    return {
      ...item,
      clientId: client.id,
      clientName: client.name,
      clientFolder: client.folder
    };
  });
  const sameClients = JSON.stringify(manifest.clients || []) === JSON.stringify(manifestClients);
  if (!changedItems && sameClients) return { updated: false, changedItems: 0 };
  await writeManifestItems(config, reason, manifestClients, items);
  return { updated: true, changedItems };
}

async function deleteCloudByFilters(filters = {}) {
  const config = loadCloudflareConfig();
  if (!config.enabled) throw new Error('Cloudflare R2 ayarlari aktif degil.');
  const manifest = await readArchiveManifest(config);
  const targets = manifest.items.filter(item => matchesDeleteFilters(item, filters));
  if (!targets.length) {
    return { deleted: 0, remaining: manifest.items.length, message: 'Seçime uyan bulut dosyası yok.' };
  }
  const errors = [];
  for (const item of targets) {
    try {
      await r2DeleteObject(config, item.key);
    } catch (error) {
      errors.push({ key: item.key, error: error.message || String(error) });
    }
  }
  const failedKeys = new Set(errors.map(item => item.key));
  const targetKeys = new Set(targets.map(item => item.key));
  const remainingItems = manifest.items.filter(item => !targetKeys.has(item.key) || failedKeys.has(item.key));
  await rememberDeletedTargets(config, targets.filter(item => !failedKeys.has(item.key)), filters, 'desktop');
  await writeManifestItems(config, 'delete-filters', manifest.clients, remainingItems);
  await calculateCloudUsage().catch(() => null);
  return {
    deleted: targets.length - errors.length,
    failed: errors.length,
    errors,
    remaining: remainingItems.length
  };
}

async function appendPendingClientToCloud(client) {
  const config = loadCloudflareConfig();
  if (!config.enabled) throw new Error('Cloudflare R2 ayarlari aktif degil.');
  const key = `${config.prefix}/pending-clients.json`;
  const text = await r2GetText(config, key);
  let pending = [];
  if (text) {
    try { pending = JSON.parse(text).clients || []; } catch { pending = []; }
  }
  const next = normalizePendingClient(client);
  const normalizedFolder = normalize(next.Klasor);
  const normalizedName = normalize(next.Unvan);
  pending = pending.filter(item => normalize(item.Klasor) !== normalizedFolder && normalize(item.Unvan) !== normalizedName);
  pending.push(next);
  await r2PutObject(config, key, Buffer.from(JSON.stringify({ updatedAt: new Date().toISOString(), clients: pending }, null, 2), 'utf8'), {
    'content-type': 'application/json; charset=utf-8'
  });
  return { queued: true, client: { id: next.Id, name: next.Unvan, folder: next.Klasor } };
}

async function pullPendingClientsFromCloud(config = loadCloudflareConfig()) {
  if (!config.enabled) return { added: 0, skipped: 0 };
  const key = `${config.prefix}/pending-clients.json`;
  const text = await r2GetText(config, key);
  if (!text) return { added: 0, skipped: 0 };
  let pending = [];
  try { pending = JSON.parse(text).clients || []; } catch { pending = []; }
  if (!pending.length) return { added: 0, skipped: 0 };
  const raw = readRawClients();
  const seenIds = new Set(raw.map(item => String(item.Id || '')));
  const seenFolders = new Set(raw.map(item => normalize(item.Klasor)));
  let added = 0;
  let skipped = 0;
  const addedClients = [];
  for (const item of pending) {
    const client = normalizePendingClient(item);
    if (seenIds.has(client.Id) || seenFolders.has(normalize(client.Klasor))) {
      skipped += 1;
      continue;
    }
    raw.push(client);
    seenIds.add(client.Id);
    seenFolders.add(normalize(client.Klasor));
    addedClients.push(client);
    added += 1;
  }
  if (added) writeRawClients(raw);
  await r2PutObject(config, key, Buffer.from(JSON.stringify({ updatedAt: new Date().toISOString(), clients: [] }, null, 2), 'utf8'), {
    'content-type': 'application/json; charset=utf-8'
  });
  return { added, skipped, clients: addedClients.map(client => ({ id: client.Id, name: client.Unvan, folder: client.Klasor })) };
}

function archiveYears(config) {
  const start = Number(config.fullArchive?.startYear || 2023);
  const current = new Date().getFullYear();
  const years = [];
  for (let year = current; year >= start; year -= 1) years.push(String(year));
  return years;
}

function archiveMonths() {
  return Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
}

function latestTaxPlateFor(client) {
  const folder = documentFolder(client, 'tahakkuk', 'LEVHA');
  if (!folder || !fs.existsSync(folder)) return null;
  const files = fs.readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.pdf$/i.test(entry.name))
    .map(entry => {
      const filePath = path.join(folder, entry.name);
      const stat = fs.statSync(filePath);
      return { path: filePath, name: entry.name, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name, 'tr'));
  return files[0] || null;
}

function archiveFilesFor(client, source, type, years, months) {
  const code = typeCodes[type];
  const folder = documentFolder(client, source, code);
  if (!code || !folder || !fs.existsSync(folder)) return [];

  const periodPatterns = [];
  for (const year of years) {
    for (const month of months) {
      periodPatterns.push({
        year,
        month,
        patterns: patternsFor(code, year, month, source)
      });
    }
  }

  const newestByPeriod = new Map();
  const allMatches = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.pdf$/i.test(entry.name)) continue;
    const matchedPeriod = periodPatterns.find(period => period.patterns.some(pattern => pattern.test(entry.name)));
    if (!matchedPeriod) continue;
    const filePath = path.join(folder, entry.name);
    const stat = fs.statSync(filePath);
    const file = { path: filePath, name: entry.name, mtimeMs: stat.mtimeMs };
    if (!newestOnly(code)) {
      allMatches.push({ year: matchedPeriod.year, month: matchedPeriod.month, file });
      continue;
    }
    const key = `${matchedPeriod.year}-${matchedPeriod.month}`;
    const current = newestByPeriod.get(key);
    if (!current || file.mtimeMs > current.file.mtimeMs || (file.mtimeMs === current.file.mtimeMs && file.name.localeCompare(current.file.name, 'tr') < 0)) {
      newestByPeriod.set(key, { year: matchedPeriod.year, month: matchedPeriod.month, file });
    }
  }

  return [...newestByPeriod.values(), ...allMatches]
    .sort((a, b) => b.year.localeCompare(a.year) || a.month.localeCompare(b.month) || a.file.name.localeCompare(b.file.name, 'tr'));
}

function nextTick() {
  return new Promise(resolve => setImmediate(resolve));
}

async function collectFullArchive(config) {
  const clients = readClients();
  const years = archiveYears(config);
  const months = archiveMonths();
  const sources = ['tahakkuk', 'beyanname'];
  const types = Object.keys(typeCodes).filter(type => type !== 'levha');
  const found = [];
  const seenFiles = new Set();

  for (const [clientIndex, client] of clients.entries()) {
    collectClientArchive(config, client, { years, months, sources, types, seenFiles }).forEach(item => found.push(item));
    if (clientIndex % 3 === 0) await nextTick();
  }

  return found;
}

function collectClientArchive(config, client, context = {}) {
  const years = context.years || archiveYears(config);
  const months = context.months || archiveMonths();
  const sources = context.sources || ['tahakkuk', 'beyanname'];
  const types = context.types || Object.keys(typeCodes).filter(type => type !== 'levha');
  const seenFiles = context.seenFiles || new Set();
  const found = [];

  for (const source of sources) {
    for (const type of types) {
      if (source === 'beyanname' && (type === 'ebildirge' || type === 'hizmet')) continue;
      for (const match of archiveFilesFor(client, source, type, years, months)) {
        const seenKey = match.file.path.toLocaleLowerCase('tr-TR');
        if (seenFiles.has(seenKey)) continue;
        seenFiles.add(seenKey);
        found.push({ client, source, type, year: match.year, month: match.month, file: match.file });
      }
    }
  }

  const plate = latestTaxPlateFor(client);
  if (plate) {
    const seenKey = plate.path.toLocaleLowerCase('tr-TR');
    if (!seenFiles.has(seenKey)) {
      seenFiles.add(seenKey);
      found.push({
        client,
        source: 'guncel',
        type: 'levha',
        year: 'vergi-levhasi',
        month: 'guncel',
        file: plate
      });
    }
  }

  return found;
}

function manifestEntryFromArchiveItem(item, key) {
  return {
    key,
    clientId: item.client.id,
    clientName: item.client.name,
    clientFolder: item.client.folder,
    source: item.source,
    type: item.type,
    typeCode: typeCodes[item.type],
    year: item.year,
    month: item.month,
    originalName: item.file.name,
    size: fs.statSync(item.file.path).size,
    cloudSize: item.cloudSize || fs.statSync(item.file.path).size,
    modifiedAt: new Date(item.file.mtimeMs).toISOString()
  };
}

async function writeArchiveManifest(config, { startedAt, reason, clients, items }) {
  const latestDeleted = await readDeletedRules(config);
  items = items.filter(item => !isDeletedBlocked(latestDeleted,item,item.key));
  const manifest = Buffer.from(JSON.stringify({
    updatedAt: new Date().toISOString(),
    startedAt,
    reason,
    clients,
    count: items.length,
    items
  }, null, 2), 'utf8');
  await r2PutObject(config, `${config.prefix}/manifest.json`, manifest, {
    'content-type': 'application/json; charset=utf-8'
  });
  cloudState.lastSyncAt = new Date().toISOString();
}

async function syncFullArchiveToCloud(reason = 'manual') {
  const config = loadCloudflareConfig();
  if (!config.enabled) {
    throw new Error('Cloudflare R2 ayarlari aktif degil. cloudflare-r2.json dosyasini doldurup enabled=true yapmalisin.');
  }
  if (cloudState.syncing) {
    return { skipped: true, reason: 'Senkron zaten calisiyor.' };
  }

  cloudState.syncing = true;
  cloudState.lastError = null;
  const requestId = reason === 'mobile-request' ? cloudState.lastSyncRequestAt : null;
  const state = readCloudFileState();
  const startedAt = new Date().toISOString();
  const manifestItems = [];
  const stats = { reason, scanned: 0, uploaded: 0, unchanged: 0, errors: 0 };

  try {
    if (!fs.existsSync(ZIRVE_ROOT)) throw new Error('Zirve arsiv klasorune ulasilamiyor: ' + ZIRVE_ROOT);
    childFolderCache.clear();
    documentFolderCache.clear();
    await publishSyncStatus();
    await calculateCloudUsage().catch(() => {
      cloudState.usage = makeUsage(0, 0, { source: 'live-sync', phase: 'starting' });
    });
    const pendingClients = await pullPendingClientsFromCloud(config).catch(error => {
      cloudState.lastError = `Bekleyen firma kuyruğu okunamadı: ${error.message || error}`;
      return { added: 0, skipped: 0 };
    });
    const priorityClientIds = new Set((pendingClients.clients || []).map(client => String(client.id || '')));
    const clients = readClients().sort((a, b) => {
      const ap = priorityClientIds.has(String(a.id || '')) ? 0 : 1;
      const bp = priorityClientIds.has(String(b.id || '')) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name, 'tr');
    });
    const manifestClients = clients.map(client => ({
      id: client.id,
      name: client.name,
      folder: client.folder
    }));
    if (pendingClients.added) {
      stats.pendingClientsAdded = pendingClients.added;
      stats.pendingClientsSkipped = pendingClients.skipped;
    }
    const years = archiveYears(config);
    const months = archiveMonths();
    const sources = ['tahakkuk', 'beyanname'];
    const types = Object.keys(typeCodes).filter(type => type !== 'levha');
    const seenFiles = new Set();
    let deletedRules = await readDeletedRules(config);
    let deletionRulesAt = Date.now();

    for (const [clientIndex, client] of clients.entries()) {
      cloudState.progress = {
        clientIndex: clientIndex + 1,
        clientTotal: clients.length,
        clientName: client.name,
        scanned: stats.scanned,
        uploaded: stats.uploaded,
        unchanged: stats.unchanged,
        manifestItems: manifestItems.length
      };
      const items = collectClientArchive(config, client, { years, months, sources, types, seenFiles });
      stats.scanned += items.length;

      for (const item of items) {
        if(Date.now()-deletionRulesAt>30000){deletedRules=await readDeletedRules(config);deletionRulesAt=Date.now()}
        const fingerprint = fileFingerprint(item.file.path);
        const stateKey = item.file.path.toLocaleLowerCase('tr-TR');
        const previous = state.files[stateKey] || {};
        let key = previous.key;
        const candidateKey = key || cloudKey(config, item);
        if (isDeletedBlocked(deletedRules, item, candidateKey)) {
          if (key) delete state.files[stateKey];
          continue;
        }
        if (previous.fingerprint === fingerprint && key) {
          item.cloudSize = previous.cloudSize || item.file.size || fs.statSync(item.file.path).size;
          stats.unchanged += 1;
        } else {
          key = await uploadCloudItem(config, item);
          if (!previous.key) {
            touchLiveUsage({ bytesDelta: item.cloudSize || 0, objectsDelta: 1, phase: 'uploading' });
          } else if (previous.cloudSize) {
            touchLiveUsage({ bytesDelta: (item.cloudSize || 0) - Number(previous.cloudSize || 0), phase: 'uploading' });
          } else {
            touchLiveUsage({ bytesDelta: item.cloudSize || 0, phase: 'uploading' });
          }
          state.files[stateKey] = {
            key,
            fingerprint,
            cloudSize: item.cloudSize || 0,
            syncedAt: new Date().toISOString()
          };
          stats.uploaded += 1;
          await publishLiveUsage(config).catch(() => {});
        }
        manifestItems.push(manifestEntryFromArchiveItem(item, key));
      }

      touchLiveUsage({ objects: Object.keys(state.files || {}).length + 2, phase: 'syncing' });
      await publishLiveUsage(config).catch(() => {});
      if (clientIndex % 3 === 0) writeCloudFileState(state);
      await nextTick();
    }

    // Keep cloud-only documents when a local folder is temporarily unavailable.
    const oldManifest = JSON.parse(await r2GetText(config, `${config.prefix}/manifest.json`) || '{"items":[]}');
    const merged = new Map((oldManifest.items || []).map(item => [item.key, item]));
    for (const item of manifestItems) merged.set(item.key, item);
    await writeArchiveManifest(config, {
      startedAt,
      reason,
      clients: manifestClients,
      items: [...merged.values()]
    });

    state.lastFullSyncAt = new Date().toISOString();
    state.lastStats = stats;
    writeCloudFileState(state);
    cloudState.lastFullSyncAt = state.lastFullSyncAt;
    cloudState.lastFullSyncStats = stats;
    if (requestId) cloudState.lastCompletedRequestAt = requestId;
    cloudState.lastSyncAt = state.lastFullSyncAt;
    cloudState.lastError = null;
    cloudState.progress = null;
    touchLiveUsage({ phase: 'completed' });
    await calculateCloudUsage().catch(() => publishLiveUsage(config, true).catch(() => {}));
    return stats;
  } catch (error) {
    stats.errors += 1;
    cloudState.lastError = error.message || String(error);
    throw error;
  } finally {
    cloudState.syncing = false;
    await publishSyncStatus().catch(() => {});
  }
}

async function publishSyncStatus() {
  const config = loadCloudflareConfig();
  if (!config.enabled) return;
  const status = cloudflareStatus();
  delete status.usage;
  if (status.progress) delete status.progress.clientName;
  await r2PutObject(config, `${config.prefix}/sync-status.json`, Buffer.from(JSON.stringify({ ...status, sourceAccessible: fs.existsSync(ZIRVE_ROOT), heartbeatAt: new Date().toISOString() })), { 'content-type': 'application/json' });
}

function startFullArchiveSync(reason = 'manual') {
  if (cloudState.syncing) {
    return { started: false, reason: 'Senkron zaten calisiyor.' };
  }
  if (!fs.existsSync(ZIRVE_ROOT)) { cloudState.lastError='Ofis belge klasörüne erişilemiyor.'; return {started:false,reason:cloudState.lastError}; }
  syncFullArchiveToCloud(reason).catch(error => {
      cloudState.lastError = error.message || String(error);
      console.error(`Cloudflare senkron hatasi: ${cloudState.lastError}`);
  });
  return { started: true, reason };
}

function startCloudHourlySync() {
  let lastAttemptAt = -Infinity;
  const checkDue = () => {
    const config = loadCloudflareConfig();
    if (!config.enabled || !config.fullArchive.hourly || cloudState.syncing) return;
    const now = Date.now();
    const hour = new Date(now);
    hour.setMinutes(0, 0, 0);
    const lastSuccess = Date.parse(cloudState.lastFullSyncAt || '') || 0;
    if (lastSuccess >= hour.getTime()) return;
    // Retry a failed run after five minutes; never overlap a running sync.
    if (now >= lastAttemptAt && now - lastAttemptAt < 5 * 60 * 1000) return;
    lastAttemptAt = now;
    startFullArchiveSync('hourly');
  };
  checkDue();
  setInterval(checkDue, 60 * 1000);
  console.log('Cloudflare saatlik arşiv senkronu ve kaçırılan saat kontrolü aktif.');
}

async function checkCloudSyncRequest() {
  const config = loadCloudflareConfig();
  if (!config.enabled) return;
  const text = await r2GetText(config, `${config.prefix}/sync-request.json`);
  if (!text) return;
  let payload = null;
  try { payload = JSON.parse(text); } catch { return; }
  const requestedAt = String(payload.requestedAt || '');
  if (!requestedAt || requestedAt === cloudState.lastSyncRequestAt) return;
  // A completed archive already covers requests from before that completion.
  if (Date.parse(requestedAt) <= Date.parse(cloudState.lastFullSyncAt || '')) {
    cloudState.lastSyncRequestAt = requestedAt;
    cloudState.lastCompletedRequestAt = requestedAt;
    return;
  }
  if (cloudState.syncing) return;
  cloudState.lastSyncRequestAt = requestedAt;
  startFullArchiveSync('mobile-request');
}

function repeatWithoutOverlap(task,delay){
 let failures=0;
 const tick=async()=>{try{await task();failures=0}catch(e){failures++;cloudState.lastError=String(e.message||e)}finally{setTimeout(tick,Math.min(15*60000,delay*2**Math.min(failures,4)))}};
 void tick();
}
function startCloudRequestWatcher(){repeatWithoutOverlap(checkCloudSyncRequest,120000)}
function startAutomaticWatcher(){
 let watcher,dirty=false,lastAttempt=0;
 const schedule=(event,filename)=>{if(!filename||/\.pdf$/i.test(String(filename)))dirty=true};
 const check=()=>{
  if(!fs.existsSync(ZIRVE_ROOT))return;
  if(!watcher)try{watcher=fs.watch(ZIRVE_ROOT,{recursive:true},schedule);watcher.on('error',()=>{watcher?.close();watcher=null})}catch{}
  const now=Date.now(),lastSuccess=Date.parse(cloudState.lastFullSyncAt||'')||0;
  if(!cloudState.syncing&&now-lastAttempt>=15*60000&&((dirty&&now-lastSuccess>=15*60000)||now-lastSuccess>=60*60000)){
   lastAttempt=now;dirty=false;startFullArchiveSync('automatic-check');
  }
 };
 check();setInterval(check,60000);fs.watchFile(CLIENTS_PATH,{interval:10000},()=>{dirty=true});
}


function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': mime[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function serveStampSignature(req, res) {
  if (!fs.existsSync(STAMP_SIGNATURE_HTML)) {
    res.writeHead(404);
    res.end('Kase imza dosyasi bulunamadi.');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  fs.createReadStream(STAMP_SIGNATURE_HTML).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  try {
    if ((req.method === 'GET' || req.method === 'HEAD') && parsed.pathname === '/kase-imza') {
      if (!requireAuth(req, res)) return;
      if (req.method === 'HEAD') {
        res.writeHead(fs.existsSync(STAMP_SIGNATURE_HTML) ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
        return res.end();
      }
      return serveStampSignature(req, res);
    }

    if (req.method === 'POST' && parsed.pathname === '/api/login') {
      const payload = await readBody(req);
      if (payload.username !== LOGIN_USER || payload.password !== LOGIN_PASS) {
        return json(res, 401, { error: 'Kullanici adi veya sifre hatali.' });
      }
      const sid = `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
      sessions.add(sid);
      const body = JSON.stringify({ ok: true });
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'set-cookie': `apex_mobile_sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`
      });
      return res.end(body);
    }

    if (parsed.pathname.startsWith('/api/local/cloudflare/')) {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'Bu islem sadece bu bilgisayardan calisir.' });
      if (req.method === 'GET' && parsed.pathname === '/api/local/cloudflare/status') {
        return json(res, 200, cloudflareStatus());
      }
      if (req.method === 'POST' && parsed.pathname === '/api/local/cloudflare/sync-full') {
        return json(res, 200, startFullArchiveSync('manual-apex'));
      }
      if (req.method === 'POST' && parsed.pathname === '/api/local/cloudflare/delete') {
        const payload = await readBody(req);
        return json(res, 200, await deleteCloudByFilters(payload));
      }
      if (req.method === 'POST' && parsed.pathname === '/api/local/cloudflare/add-client') {
        const payload = await readBody(req);
        return json(res, 200, await appendPendingClientToCloud(payload));
      }
      if (req.method === 'POST' && parsed.pathname === '/api/local/cloudflare/pull-pending') {
        return json(res, 200, await pullPendingClientsFromCloud());
      }
      if (req.method === 'POST' && parsed.pathname === '/api/local/cloudflare/rebuild-manifest') {
        return json(res, 200, await rebuildCloudManifestFromObjects());
      }
    }

    if (req.method === 'GET' && parsed.pathname === '/api/status') {
      if (!requireAuth(req, res)) return;
      return json(res, 200, {
        ok: true,
        root: ZIRVE_ROOT,
        clients: readClients().length,
        cloudflare: cloudflareStatus(),
        updatedAt: new Date().toISOString()
      });
    }

    if (req.method === 'GET' && parsed.pathname === '/api/manifest') {
      if (!requireAuth(req, res)) return;
      const config = loadCloudflareConfig();
      return json(res, 200, await readArchiveManifest(config));
    }

    if (req.method === 'GET' && parsed.pathname === '/api/deleted') {
      if (!requireAuth(req, res)) return;
      const config = loadCloudflareConfig();
      return json(res, 200, await readDeletedRules(config));
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && parsed.pathname === '/api/file') {
      if (!requireAuth(req, res)) return;
      const key = parsed.searchParams.get('key') || '';
      const config = loadCloudflareConfig();
      const prefix = `${config.prefix || 'tahakkuk-gonder'}/`;
      if (!config.enabled) return json(res, 400, { error: 'Cloudflare R2 ayarlari aktif degil.' });
      if (!key.startsWith(prefix) || key.includes('..')) return json(res, 400, { error: 'Gecersiz dosya anahtari.' });
      const object = await r2GetObjectBuffer(config, key);
      const pdf = decryptCloudBuffer(object.body, object.headers, config.encryptionKeyBase64);
      const originalName = decodeBase64Text(object.headers['x-amz-meta-apex-original-name']);
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(originalName || 'belge.pdf')}`,
        'cache-control': 'private, no-store',
        'content-length': pdf.length
      });
      if (req.method === 'HEAD') return res.end();
      return res.end(pdf);
    }

    if (req.method === 'POST' && parsed.pathname === '/api/sync-request') {
      if (!requireAuth(req, res)) return;
      return json(res, 200, startFullArchiveSync('mobile-manual'));
    }

    if (req.method === 'POST' && parsed.pathname === '/api/password') {
      if (!requireAuth(req, res)) return;
      const payload = await readBody(req);
      if (payload.currentPassword !== LOGIN_PASS) return json(res, 400, { error: 'Mevcut sifre hatali.' });
      const nextPassword = String(payload.newPassword || '').trim();
      if (nextPassword.length < 4) return json(res, 400, { error: 'Yeni sifre cok kisa.' });
      mobileSecret.password = nextPassword;
      LOGIN_PASS = nextPassword;
      saveMobileSecret(mobileSecret);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/clients') {
      if (!requireAuth(req, res)) return;
      const payload = await readBody(req);
      return json(res, 200, await appendPendingClientToCloud(payload));
    }

    if (req.method === 'POST' && parsed.pathname === '/api/delete-start') {
      if (!requireAuth(req, res)) return;
      const payload = await readBody(req);
      const config = loadCloudflareConfig();
      const manifest = await readArchiveManifest(config);
      const targets = manifest.items.filter(item => matchesDeleteFilters(item, payload));
      if (!targets.length) return json(res, 200, { status: 'done', deleted: 0, total: 0, message: 'Seçime uyan belge yok.' });
      const id = crypto.randomUUID();
      cloudDeleteJobs.set(id, { filters: payload, targets, cursor: 0, deleted: 0, errors: [], deletedKeys: [] });
      return json(res, 200, { id, status: 'running', done: 0, deleted: 0, total: targets.length, deletedKeys: [] });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/delete-step') {
      if (!requireAuth(req, res)) return;
      const payload = await readBody(req);
      const job = cloudDeleteJobs.get(payload.id);
      if (!job) return json(res, 404, { error: 'Silme isi bulunamadi.' });
      const config = loadCloudflareConfig();
      const limit = Math.max(1, Math.min(50, Number(payload.limit || 20)));
      const batch = job.targets.slice(job.cursor, job.cursor + limit);
      job.deletedKeys = [];
      for (const item of batch) {
        try {
          await r2DeleteObject(config, item.key);
          job.deleted += 1;
          job.deletedKeys.push(item.key);
        } catch (error) {
          job.errors.push({ key: item.key, error: error.message || String(error) });
        }
      }
      job.cursor += batch.length;
      if (job.cursor >= job.targets.length) {
        const failedKeys = new Set(job.errors.map(item => item.key));
        const targetKeys = new Set(job.targets.map(item => item.key));
        const manifest = await readArchiveManifest(config);
        const remaining = manifest.items.filter(item => !targetKeys.has(item.key) || failedKeys.has(item.key));
        await rememberDeletedTargets(config, job.targets.filter(item => !failedKeys.has(item.key)), job.filters, 'mobile-local');
        await writeManifestItems(config, 'delete-filters', manifest.clients, remaining);
        cloudDeleteJobs.delete(payload.id);
        await calculateCloudUsage().catch(() => null);
        return json(res, 200, {
          id: payload.id,
          status: 'done',
          done: job.targets.length,
          total: job.targets.length,
          deleted: job.deleted,
          failed: job.errors.length,
          errors: job.errors,
          deletedKeys: job.deletedKeys
        });
      }
      return json(res, 200, {
        id: payload.id,
        status: 'running',
        done: job.cursor,
        total: job.targets.length,
        deleted: job.deleted,
        failed: job.errors.length,
        deletedKeys: job.deletedKeys
      });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/restore') {
      if (!requireAuth(req, res)) return;
      const payload = await readBody(req);
      const config = loadCloudflareConfig();
      const deleted = await readDeletedRules(config);
      const ids = new Set(arr(payload.ids));
      const remaining = (deleted.items || []).filter(item => !ids.has(String(item.id || deletedRuleId(item))));
      await writeDeletedRules(config, remaining);
      return json(res, 200, { restored: (deleted.items || []).length - remaining.length, remaining: remaining.length });
    }

    if (req.method === 'GET' && parsed.pathname === '/api/cloudflare/status') {
      if (!requireAuth(req, res)) return;
      return json(res, 200, cloudflareStatus());
    }

    if (req.method === 'GET' && parsed.pathname === '/api/cloudflare/usage') {
      if (!requireAuth(req, res)) return;
      return json(res, 200, await calculateCloudUsage());
    }

    if (req.method === 'POST' && parsed.pathname === '/api/cloudflare/sync-selection') {
      if (!requireAuth(req, res)) return;
      const payload = await readBody(req);
      return json(res, 200, await syncSelectionToCloud(payload));
    }

    if (req.method === 'POST' && parsed.pathname === '/api/cloudflare/sync-full') {
      if (!requireAuth(req, res)) return;
      return json(res, 200, startFullArchiveSync('manual'));
    }

    if (req.method === 'POST' && parsed.pathname === '/api/cloudflare/delete') {
      if (!requireAuth(req, res)) return;
      const payload = await readBody(req);
      return json(res, 200, await deleteCloudByFilters(payload));
    }

    if (req.method === 'POST' && parsed.pathname === '/api/cloudflare/add-client') {
      if (!requireAuth(req, res)) return;
      const payload = await readBody(req);
      return json(res, 200, await appendPendingClientToCloud(payload));
    }

    if (req.method === 'POST' && parsed.pathname === '/api/cloudflare/pull-pending') {
      if (!requireAuth(req, res)) return;
      return json(res, 200, await pullPendingClientsFromCloud());
    }

    if (req.method === 'POST' && parsed.pathname === '/api/cloudflare/rebuild-manifest') {
      if (!requireAuth(req, res)) return;
      return json(res, 200, await rebuildCloudManifestFromObjects());
    }

    if (req.method === 'GET' && parsed.pathname === '/api/clients') {
      if (!requireAuth(req, res)) return;
      return json(res, 200, { clients: readClients() });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/prepare') {
      if (!requireAuth(req, res)) return;
      const payload = await readBody(req);
      return json(res, 200, prepareDownload(payload));
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && parsed.pathname.startsWith('/api/file/')) {
      if (!requireAuth(req, res)) return;
      const parts = parsed.pathname.split('/').map(part => decodeURIComponent(part));
      const jobId = parts[3];
      const index = Number(parts[4]);
      const job = downloadJobs.get(jobId);
      const item = job && job.downloads[index];
      if (!item || !fs.existsSync(item.path)) return json(res, 404, { error: 'PDF bulunamadi.' });
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.fileName)}`,
        'content-length': fs.statSync(item.path).size
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(item.path).pipe(res);
    }

    serveStatic(req, res, parsed.pathname);
  } catch (error) {
    json(res, 500, { error: error.message || String(error) });
  }
});

function startPhoneCollector() {
  const savedState=readCloudFileState();
  cloudState.lastFullSyncAt=savedState.lastFullSyncAt||null;
  cloudState.lastSyncAt=savedState.lastFullSyncAt||null;
  cloudState.lastFullSyncStats=savedState.lastStats||null;
  startAutomaticWatcher();startCloudRequestWatcher();
  const publish=()=>publishSyncStatus();
  repeatWithoutOverlap(publish,45000);
  process.parentPort?.on('message',({data})=>{if(data?.sync)syncFullArchiveToCloud('phone-settings').catch(e=>process.parentPort?.postMessage({error:e.message}))});
  process.parentPort?.postMessage({ready:true});
}
if(require.main===module)startPhoneCollector();
function relayRequest(config,{method='GET',key='',query={},body=Buffer.alloc(0),headers={}}) {
  const route=key?'/api/phone/object?key='+encodeURIComponent(key):'/api/phone/list?prefix='+encodeURIComponent(query.prefix||config.prefix+'/')+(query['continuation-token']?'&cursor='+encodeURIComponent(query['continuation-token']):'');
  return new Promise((resolve,reject)=>{
    const req=httpsRequest(config.relayServer+route,{method,headers:{...headers,'User-Agent':'ApexCepNative/2.0','X-Apex-App-Key':config.desktopToken,'Content-Length':body.length}},res=>{
      const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{const buffer=Buffer.concat(chunks);if(res.statusCode>=200&&res.statusCode<300)resolve({body:buffer,headers:res.headers});else{let message='Bulut bağlantısı ('+res.statusCode+')';try{message=JSON.parse(buffer.toString()).error||message}catch{}const e=Error(message);e.statusCode=res.statusCode;reject(e)}});
    });req.setTimeout(90000,()=>req.destroy(Error('Bulut bağlantısı zaman aşımına uğradı')));req.on('error',reject);req.end(body);
  });
}
module.exports = { loadCloudflareConfig, r2PutObject, r2GetText, r2GetObjectBuffer, syncFullArchiveToCloud, cloudflareStatus };

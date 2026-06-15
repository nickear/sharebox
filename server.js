import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3940);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'items.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_JSON_BYTES = Number(process.env.MAX_JSON_BYTES || 1024 * 1024);
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10000;
const MAX_UPLOAD_FIELD_BYTES = 16 * 1024;
const MAX_UPLOAD_FIELDS_BYTES = 1024 * 1024;
const SHAREBOX_PASSWORD = process.env.SHAREBOX_PASSWORD || '';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const LOGIN_WINDOW_MS = 1000 * 60 * 10;
const LOGIN_BLOCK_MS = 1000 * 60 * 10;
const LOGIN_MAX_ATTEMPTS = 10;
const TRUST_PROXY = /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || ''));
const COOKIE_SECURE = /^(1|true|yes|on)$/i.test(String(process.env.COOKIE_SECURE || ''));
const MAINTENANCE_INTERVAL_MS = 1000 * 60 * 10;

const sessions = new Map();
const eventClients = new Set();
const failedLogins = new Map();
const cancelledUploads = new Map();
const serverMessages = {
  en: {
    'error.forbidden': 'forbidden',
    'error.login_required': 'login required',
    'error.not_found': 'not found',
    'error.too_many_login_attempts': 'too many login attempts, try again later',
    'error.invalid_password': 'invalid password',
    'error.text_required': 'text is required',
    'error.multipart_required': 'multipart/form-data required',
    'error.no_files_uploaded': 'no files uploaded',
    'error.invalid_json': 'invalid json',
    'error.missing_multipart_boundary': 'missing multipart boundary',
    'error.upload_too_large': 'upload is too large',
    'error.too_many_files': `too many files, upload at most ${MAX_UPLOAD_FILES} files at a time`,
    'error.invalid_multipart_payload': 'invalid multipart payload',
    'error.upload_metadata_too_large': 'upload metadata is too large',
    'error.internal_server_error': 'internal server error'
  },
  zh: {
    'error.forbidden': '禁止访问',
    'error.login_required': '需要登录',
    'error.not_found': '未找到',
    'error.too_many_login_attempts': '登录失败次数过多，请稍后再试',
    'error.invalid_password': '密码错误',
    'error.text_required': '文本不能为空',
    'error.multipart_required': '需要使用 multipart/form-data 上传',
    'error.no_files_uploaded': '未上传任何文件',
    'error.invalid_json': 'JSON 格式无效',
    'error.missing_multipart_boundary': '缺少 multipart boundary',
    'error.upload_too_large': '上传内容过大',
    'error.too_many_files': `文件数量过多，每次最多上传 ${MAX_UPLOAD_FILES} 个文件`,
    'error.invalid_multipart_payload': 'multipart 请求无效',
    'error.upload_metadata_too_large': '上传元数据过大',
    'error.internal_server_error': '服务器内部错误'
  }
};

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.zip', 'application/zip']
]);

await initStorage();
startMaintenance();

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendJson(res, error.statusCode || 500, {
      error: error.publicMessageKey
        ? serverT(req, error.publicMessageKey)
        : error.publicMessage || serverT(req, 'error.internal_server_error')
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ShareBox listening on http://0.0.0.0:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  if (!SHAREBOX_PASSWORD) {
    console.log('Authentication is disabled because SHAREBOX_PASSWORD is empty.');
  }
});

async function initStorage() {
  await mkdir(UPLOAD_DIR, { recursive: true });
  try {
    await readFile(DB_PATH, 'utf8');
  } catch {
    await writeFile(DB_PATH, JSON.stringify({ items: [] }, null, 2));
  }
}

function startMaintenance() {
  const timer = setInterval(() => {
    cleanupSessions();
    cleanupFailedLogins();
    cleanupCancelledUploads();
  }, MAINTENANCE_INTERVAL_MS);
  timer.unref();
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'GET' && pathname === '/') {
    return serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
  }

  if (req.method === 'GET' && !pathname.startsWith('/api/')) {
    const staticPath = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (!staticPath.startsWith(PUBLIC_DIR)) {
      return sendText(res, 403, serverT(req, 'error.forbidden'));
    }
    return serveStatic(res, staticPath);
  }

  if (pathname === '/api/session' && req.method === 'GET') {
    return sendJson(res, 200, {
      authRequired: Boolean(SHAREBOX_PASSWORD),
      authenticated: isAuthenticated(req)
    });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    return handleLogin(req, res);
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    return handleLogout(req, res);
  }

  if (!isAuthenticated(req)) {
    return sendJson(res, 401, { error: serverT(req, 'error.login_required') });
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    return handleEvents(req, res);
  }

  if (pathname === '/api/items' && req.method === 'GET') {
    const db = await loadDb();
    return sendJson(res, 200, { items: db.items.map(publicItem).reverse() });
  }

  if (pathname === '/api/items' && req.method === 'DELETE') {
    return handleDeleteAllItems(req, res);
  }

  if (pathname === '/api/text' && req.method === 'POST') {
    return handleCreateText(req, res);
  }

  if (pathname === '/api/upload' && req.method === 'POST') {
    return handleUpload(req, res);
  }

  if (pathname === '/api/uploads/cancel' && req.method === 'POST') {
    return handleCancelUpload(req, res);
  }

  const itemDownload = pathname.match(/^\/api\/items\/([^/]+)\/download$/);
  if (itemDownload && req.method === 'GET') {
    return handleItemDownload(req, res, itemDownload[1]);
  }

  const fileDownload = pathname.match(/^\/api\/items\/([^/]+)\/files\/(\d+)\/download$/);
  if (fileDownload && req.method === 'GET') {
    return handleFileDownload(req, res, fileDownload[1], Number(fileDownload[2]));
  }

  const itemDelete = pathname.match(/^\/api\/items\/([^/]+)$/);
  if (itemDelete && req.method === 'DELETE') {
    return handleDeleteItem(req, res, itemDelete[1]);
  }

  return sendJson(res, 404, { error: serverT(req, 'error.not_found') });
}

async function handleLogin(req, res) {
  if (!SHAREBOX_PASSWORD) {
    return sendJson(res, 200, { ok: true });
  }

  const clientAddress = getClientAddress(req);
  const retryAfterSeconds = getLoginRetryAfterSeconds(clientAddress);
  if (retryAfterSeconds > 0) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return sendJson(res, 429, { error: serverT(req, 'error.too_many_login_attempts') });
  }

  const body = await readJson(req);
  const password = String(body.password || '');

  if (!safeEqual(password, SHAREBOX_PASSWORD)) {
    recordFailedLogin(clientAddress);
    return sendJson(res, 401, { error: serverT(req, 'error.invalid_password') });
  }

  clearFailedLogin(clientAddress);
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { createdAt: Date.now() });
  const maxAge = 60 * 60 * 24 * 30;
  res.setHeader('Set-Cookie', buildSessionCookie(req, token, maxAge));
  return sendJson(res, 200, { ok: true });
}

async function handleLogout(req, res) {
  const token = getCookie(req, 'sharebox_session');
  if (token) {
    sessions.delete(token);
  }
  res.setHeader('Set-Cookie', buildSessionCookie(req, '', 0));
  return sendJson(res, 200, { ok: true });
}

async function handleCreateText(req, res) {
  const body = await readJson(req);
  const text = String(body.text || '').trimEnd();

  if (!text) {
    return sendJson(res, 400, { error: serverT(req, 'error.text_required') });
  }

  const now = new Date().toISOString();
  const item = {
    id: crypto.randomUUID(),
    type: 'text',
    text,
    size: Buffer.byteLength(text),
    createdAt: now,
    updatedAt: now
  };

  const db = await loadDb();
  db.items.push(item);
  await saveDb(db);
  broadcastEvent('items-updated');
  return sendJson(res, 201, { item: publicItem(item) });
}

async function handleUpload(req, res) {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return sendJson(res, 415, { error: serverT(req, 'error.multipart_required') });
  }

  const id = crypto.randomUUID();
  const groupDir = path.join(UPLOAD_DIR, id);
  const tempDir = path.join(DATA_DIR, '.tmp-upload', id);
  await mkdir(tempDir, { recursive: true });

  let parsed;
  try {
    parsed = await parseMultipartUpload(req, contentType, tempDir);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  if (!parsed.files.length) {
    await rm(tempDir, { recursive: true, force: true });
    return sendJson(res, 400, { error: serverT(req, 'error.no_files_uploaded') });
  }

  if (isUploadCancelled(parsed.uploadTaskId)) {
    await rm(tempDir, { recursive: true, force: true });
    return sendJson(res, 200, { ok: true, cancelled: true });
  }

  await mkdir(groupDir, { recursive: true });

  const savedFiles = [];
  try {
    for (let index = 0; index < parsed.files.length; index += 1) {
      const file = parsed.files[index];
      const originalPath = parsed.paths[index] || file.originalName || `file-${index + 1}`;
      const displayPath = normalizeDisplayPath(originalPath);
      const storedPath = await uniqueStoredPath(groupDir, displayPath);
      const absolutePath = path.join(groupDir, storedPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await rename(file.tempPath, absolutePath);

      savedFiles.push({
        name: path.posix.basename(displayPath),
        path: displayPath,
        storedPath,
        size: file.size,
        mime: file.mime || 'application/octet-stream'
      });
    }
  } catch (error) {
    await rm(groupDir, { recursive: true, force: true });
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  await rm(tempDir, { recursive: true, force: true });

  if (isUploadCancelled(parsed.uploadTaskId)) {
    await rm(groupDir, { recursive: true, force: true });
    return sendJson(res, 200, { ok: true, cancelled: true });
  }

  const now = new Date().toISOString();
  const item = {
    id,
    type: 'files',
    kind: inferFileKind(savedFiles),
    displayName: displayNameForFiles(savedFiles),
    uploadTaskId: parsed.uploadTaskId || '',
    createdAt: now,
    updatedAt: now,
    files: savedFiles
  };

  const db = await loadDb();
  db.items.push(item);
  if (isUploadCancelled(parsed.uploadTaskId)) {
    await rm(groupDir, { recursive: true, force: true });
    return sendJson(res, 200, { ok: true, cancelled: true });
  }
  await saveDb(db);
  broadcastEvent('items-updated');
  return sendJson(res, 201, { item: publicItem(item) });
}

async function handleCancelUpload(req, res) {
  const body = await readJson(req);
  const uploadTaskId = String(body.uploadTaskId || '').trim();
  if (!uploadTaskId) {
    return sendJson(res, 400, { error: serverT(req, 'error.not_found') });
  }

  markUploadCancelled(uploadTaskId);
  const removed = await removeUploadTaskItems(uploadTaskId);
  if (removed) {
    broadcastEvent('items-updated');
  }
  return sendJson(res, 200, { ok: true });
}

async function handleItemDownload(req, res, id) {
  const item = await findItem(id);
  if (!item) {
    return sendJson(res, 404, { error: serverT(req, 'error.not_found') });
  }

  if (item.type === 'text') {
    const filename = `text-${item.createdAt ? item.createdAt.slice(0, 19).replace(/[:T]/g, '-') : item.id}.txt`;
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': contentDisposition(filename),
      'Cache-Control': 'no-store'
    });
    res.end(item.text || '');
    return;
  }

  if (!item.files?.length) {
    return sendJson(res, 404, { error: serverT(req, 'error.not_found') });
  }

  if (item.files.length > MAX_UPLOAD_FILES) {
    return sendJson(res, 413, { error: serverT(req, 'error.too_many_files') });
  }

  if (item.files.length === 1) {
    return streamStoredFile(res, item, item.files[0]);
  }

  const filename = `${safeName(item.displayName || displayNameForFiles(item.files || []) || 'sharebox-files')}.zip`;
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': contentDisposition(filename),
    'Cache-Control': 'no-store'
  });
  await streamZip(res, item);
}

async function handleFileDownload(req, res, id, index) {
  const item = await findItem(id);
  if (!item || item.type !== 'files' || !item.files?.[index]) {
    return sendJson(res, 404, { error: serverT(req, 'error.not_found') });
  }
  return streamStoredFile(res, item, item.files[index]);
}

async function handleDeleteItem(req, res, id) {
  const db = await loadDb();
  const index = db.items.findIndex((item) => item.id === id);
  if (index < 0) {
    return sendJson(res, 404, { error: serverT(req, 'error.not_found') });
  }

  const [item] = db.items.splice(index, 1);
  await saveDb(db);

  if (item.type === 'files') {
    await rm(path.join(UPLOAD_DIR, item.id), { recursive: true, force: true });
  }

  broadcastEvent('items-updated');
  return sendJson(res, 200, { ok: true });
}

async function handleDeleteAllItems(req, res) {
  const db = await loadDb();
  db.items = [];
  await saveDb(db);
  await rm(UPLOAD_DIR, { recursive: true, force: true });
  await mkdir(UPLOAD_DIR, { recursive: true });
  broadcastEvent('items-updated');
  return sendJson(res, 200, { ok: true });
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  });
  res.write('retry: 2000\n');
  res.write('event: ready\n');
  res.write('data: {}\n\n');

  eventClients.add(res);

  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    eventClients.delete(res);
  });
}

function broadcastEvent(name, payload = {}) {
  const data = `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of eventClients) {
    client.write(data);
  }
}

async function streamStoredFile(res, item, file) {
  const absolutePath = safeJoin(path.join(UPLOAD_DIR, item.id), file.storedPath);
  const info = await stat(absolutePath);
  res.writeHead(200, {
    'Content-Type': file.mime || 'application/octet-stream',
    'Content-Length': info.size,
    'Content-Disposition': contentDisposition(file.name || 'download'),
    'Cache-Control': 'no-store'
  });
  await pipeFile(absolutePath, res);
  res.end();
}

async function serveStatic(res, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return sendText(res, 404, 'not found');
    }
    const type = mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': info.size,
      'Cache-Control': 'no-store'
    });
    await pipeFile(filePath, res);
    res.end();
  } catch {
    sendText(res, 404, 'not found');
  }
}

async function pipeFile(filePath, res) {
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    res.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res, { end: false });
  });
}

async function loadDb() {
  const text = await readFile(DB_PATH, 'utf8');
  const db = JSON.parse(text || '{"items":[]}');
  if (!Array.isArray(db.items)) {
    db.items = [];
  }
  return db;
}

async function saveDb(db) {
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, DB_PATH);
}

async function findItem(id) {
  const db = await loadDb();
  return db.items.find((item) => item.id === id);
}

function publicItem(item) {
  if (item.type === 'text') {
    return {
      id: item.id,
      type: item.type,
      text: item.text,
      size: item.size,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  }

  return {
    id: item.id,
    type: item.type,
    kind: item.kind || inferFileKind(item.files || []),
    displayName: item.displayName || displayNameForFiles(item.files || []),
    uploadTaskId: item.uploadTaskId || '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    fileCount: item.files?.length || 0,
    totalSize: totalFileSize(item.files || []),
    files: (item.files || []).map((file, index) => ({
      index,
      name: file.name,
      path: file.path,
      size: file.size,
      mime: file.mime,
      downloadUrl: `/api/items/${item.id}/files/${index}/download`
    })),
    downloadUrl: `/api/items/${item.id}/download`
  };
}

function totalFileSize(files) {
  return files.reduce((total, file) => total + Number(file.size || 0), 0);
}

function isAuthenticated(req) {
  if (!SHAREBOX_PASSWORD) {
    return true;
  }
  const token = getCookie(req, 'sharebox_session');
  if (!token) {
    return false;
  }
  const session = sessions.get(token);
  if (!session) {
    return false;
  }
  if (Date.now() - Number(session.createdAt || 0) > SESSION_MAX_AGE_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function getCookie(req, name) {
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return '';
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function getClientAddress(req) {
  if (TRUST_PROXY) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwardedFor) {
      return forwardedFor;
    }
    const realIp = String(req.headers['x-real-ip'] || '').trim();
    if (realIp) {
      return realIp;
    }
  }
  return String(req.socket.remoteAddress || 'unknown');
}

function getRequestLang(req) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const queryLang = String(url.searchParams.get('lang') || '').toLowerCase();
  if (queryLang.startsWith('zh')) {
    return 'zh';
  }
  if (queryLang.startsWith('en')) {
    return 'en';
  }

  const headerLang = String(req.headers['x-lang'] || '').toLowerCase();
  if (headerLang.startsWith('zh')) {
    return 'zh';
  }
  if (headerLang.startsWith('en')) {
    return 'en';
  }

  const acceptLanguage = String(req.headers['accept-language'] || '').toLowerCase();
  return acceptLanguage.startsWith('zh') ? 'zh' : 'en';
}

function serverT(req, key) {
  const lang = getRequestLang(req);
  return serverMessages[lang]?.[key] || serverMessages.en[key] || key;
}

function buildSessionCookie(req, token, maxAge) {
  const parts = [
    `sharebox_session=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`
  ];
  if (COOKIE_SECURE || isSecureRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function isSecureRequest(req) {
  if (req.socket.encrypted) {
    return true;
  }
  if (TRUST_PROXY) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    return forwardedProto === 'https';
  }
  return false;
}

function getLoginRetryAfterSeconds(clientAddress) {
  const entry = failedLogins.get(clientAddress);
  if (!entry) {
    return 0;
  }
  if (entry.blockedUntil && entry.blockedUntil > Date.now()) {
    return Math.ceil((entry.blockedUntil - Date.now()) / 1000);
  }
  if (entry.blockedUntil && entry.blockedUntil <= Date.now()) {
    failedLogins.delete(clientAddress);
  }
  return 0;
}

function recordFailedLogin(clientAddress) {
  const now = Date.now();
  const entry = failedLogins.get(clientAddress);
  if (!entry || now - entry.windowStartedAt > LOGIN_WINDOW_MS) {
    failedLogins.set(clientAddress, {
      count: 1,
      windowStartedAt: now,
      blockedUntil: 0
    });
    return;
  }

  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.blockedUntil = now + LOGIN_BLOCK_MS;
    entry.count = 0;
    entry.windowStartedAt = now;
  }
}

function clearFailedLogin(clientAddress) {
  failedLogins.delete(clientAddress);
}

function cleanupSessions(now = Date.now()) {
  for (const [token, session] of sessions) {
    if (now - Number(session.createdAt || 0) > SESSION_MAX_AGE_MS) {
      sessions.delete(token);
    }
  }
}

function cleanupFailedLogins(now = Date.now()) {
  for (const [clientAddress, entry] of failedLogins) {
    const windowExpired = now - Number(entry.windowStartedAt || 0) > LOGIN_WINDOW_MS;
    const blockExpired = !entry.blockedUntil || entry.blockedUntil <= now;
    if (windowExpired && blockExpired) {
      failedLogins.delete(clientAddress);
    }
  }
}

function markUploadCancelled(uploadTaskId) {
  if (!uploadTaskId) {
    return;
  }
  cancelledUploads.set(uploadTaskId, Date.now());
}

function isUploadCancelled(uploadTaskId) {
  if (!uploadTaskId) {
    return false;
  }
  return cancelledUploads.has(uploadTaskId);
}

async function removeUploadTaskItems(uploadTaskId) {
  if (!uploadTaskId) {
    return false;
  }
  const db = await loadDb();
  const keptItems = [];
  const removedItems = [];
  for (const item of db.items) {
    if (item.type === 'files' && item.uploadTaskId === uploadTaskId) {
      removedItems.push(item);
      continue;
    }
    keptItems.push(item);
  }
  if (!removedItems.length) {
    return false;
  }
  db.items = keptItems;
  await saveDb(db);
  for (const item of removedItems) {
    await rm(path.join(UPLOAD_DIR, item.id), { recursive: true, force: true });
  }
  return true;
}

function cleanupCancelledUploads(now = Date.now()) {
  const ttl = 1000 * 60 * 60;
  for (const [uploadTaskId, createdAt] of cancelledUploads) {
    if (now - createdAt > ttl) {
      cancelledUploads.delete(uploadTaskId);
    }
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      throw Object.assign(new Error('json body too large'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error('invalid json'), {
      statusCode: 400,
      publicMessageKey: 'error.invalid_json'
    });
  }
}

async function parseMultipartUpload(req, contentType, tempDir) {
  const boundary = getMultipartBoundary(contentType);
  if (!boundary) {
    throw Object.assign(new Error('missing multipart boundary'), {
      statusCode: 400,
      publicMessageKey: 'error.missing_multipart_boundary'
    });
  }

  const startBoundary = Buffer.from(`--${boundary}`);
  const nextBoundary = Buffer.from(`\r\n--${boundary}`);
  let state = 'start';
  let buffer = Buffer.alloc(0);
  let size = 0;
  let currentPart = null;
  const result = {
    files: [],
    paths: [],
    fieldBytes: 0,
    uploadTaskId: ''
  };

  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        throw Object.assign(new Error('upload is too large'), {
          statusCode: 413,
          publicMessageKey: 'error.upload_too_large'
        });
      }
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      await processBuffer();
    }

    await processBuffer(true);

    if (state !== 'end') {
      throw Object.assign(new Error('invalid multipart payload'), {
        statusCode: 400,
        publicMessageKey: 'error.invalid_multipart_payload'
      });
    }
  } catch (error) {
    await abortMultipartPart(currentPart);
    throw error;
  }

  return result;

  async function processBuffer(isFinal = false) {
    while (true) {
      if (state === 'start') {
        const minLength = startBoundary.length + 2;
        if (buffer.length < minLength) {
          return;
        }
        if (!buffer.subarray(0, startBoundary.length).equals(startBoundary)) {
          throw Object.assign(new Error('invalid multipart boundary'), {
            statusCode: 400,
            publicMessageKey: 'error.invalid_multipart_payload'
          });
        }
        const trailer = buffer.subarray(startBoundary.length, startBoundary.length + 2).toString('utf8');
        if (trailer !== '\r\n') {
          throw Object.assign(new Error('invalid multipart preamble'), {
            statusCode: 400,
            publicMessageKey: 'error.invalid_multipart_payload'
          });
        }
        buffer = buffer.subarray(minLength);
        state = 'headers';
        continue;
      }

      if (state === 'headers') {
        const marker = buffer.indexOf('\r\n\r\n');
        if (marker < 0) {
          return;
        }
        const headerText = buffer.subarray(0, marker).toString('utf8');
        buffer = buffer.subarray(marker + 4);
        currentPart = await openMultipartPart(parseMultipartHeaders(headerText), tempDir);
        state = 'body';
        continue;
      }

      if (state === 'body') {
        const marker = buffer.indexOf(nextBoundary);
        if (marker < 0) {
          const keepBytes = nextBoundary.length + 4;
          if (!isFinal && buffer.length <= keepBytes) {
            return;
          }
          const flushUntil = isFinal ? buffer.length : buffer.length - keepBytes;
          if (flushUntil > 0) {
            await appendMultipartPart(currentPart, buffer.subarray(0, flushUntil));
            buffer = buffer.subarray(flushUntil);
          }
          if (!isFinal) {
            return;
          }
          throw Object.assign(new Error('multipart boundary missing'), {
            statusCode: 400,
            publicMessageKey: 'error.invalid_multipart_payload'
          });
        }
        await appendMultipartPart(currentPart, buffer.subarray(0, marker));
        await finalizeMultipartPart(currentPart, result);
        currentPart = null;
        buffer = buffer.subarray(marker + 2);
        state = 'boundary-end';
        continue;
      }

      if (state === 'boundary-end') {
        const minLength = startBoundary.length + 2;
        if (buffer.length < minLength) {
          return;
        }
        if (!buffer.subarray(0, startBoundary.length).equals(startBoundary)) {
          throw Object.assign(new Error('invalid multipart boundary footer'), {
            statusCode: 400,
            publicMessageKey: 'error.invalid_multipart_payload'
          });
        }
        const trailer = buffer.subarray(startBoundary.length, startBoundary.length + 2).toString('utf8');
        if (trailer === '--') {
          buffer = buffer.subarray(minLength);
          state = 'end';
          return;
        }
        if (trailer === '\r\n') {
          buffer = buffer.subarray(minLength);
          state = 'headers';
          continue;
        }
        throw Object.assign(new Error('invalid multipart boundary trailer'), {
          statusCode: 400,
          publicMessageKey: 'error.invalid_multipart_payload'
        });
      }

      return;
    }
  }
}

async function abortMultipartPart(part) {
  if (!part || part.mode !== 'file' || !part.stream) {
    return;
  }
  await new Promise((resolve) => {
    part.stream.once('close', resolve);
    part.stream.destroy();
  });
}

function getMultipartBoundary(contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return match?.[1] || match?.[2] || '';
}

function parseMultipartHeaders(headerText) {
  const headers = new Map();
  for (const line of headerText.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) {
      continue;
    }
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers.set(name, value);
  }

  const disposition = headers.get('content-disposition') || '';
  const name = /name="([^"]+)"/i.exec(disposition)?.[1] || '';
  const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] || '';

  return {
    name,
    filename,
    contentType: headers.get('content-type') || ''
  };
}

async function openMultipartPart(headers, tempDir) {
  if (headers.filename) {
    const tempPath = path.join(tempDir, crypto.randomUUID());
    const stream = createWriteStream(tempPath, { flags: 'wx' });
    await new Promise((resolve, reject) => {
      stream.once('open', resolve);
      stream.once('error', reject);
    });
    return {
      ...headers,
      mode: 'file',
      tempPath,
      stream,
      size: 0
    };
  }

  return {
    ...headers,
    mode: 'field',
    chunks: [],
    size: 0
  };
}

async function appendMultipartPart(part, chunk) {
  if (!chunk.length) {
    return;
  }
  if (part.mode === 'file') {
    part.size += chunk.length;
    await new Promise((resolve, reject) => {
      part.stream.write(chunk, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    return;
  }

  part.size += chunk.length;
  if (part.size > MAX_UPLOAD_FIELD_BYTES) {
    throw Object.assign(new Error('multipart field too large'), {
      statusCode: 413,
      publicMessageKey: 'error.upload_metadata_too_large'
    });
  }
  part.chunks.push(Buffer.from(chunk));
}

async function finalizeMultipartPart(part, result) {
  if (part.mode === 'file') {
    await new Promise((resolve, reject) => {
      part.stream.end((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    if (part.name === 'files') {
      if (result.files.length >= MAX_UPLOAD_FILES) {
        await rm(part.tempPath, { force: true });
        throw Object.assign(new Error('too many files'), {
          statusCode: 413,
          publicMessageKey: 'error.too_many_files'
        });
      }
      result.files.push({
        tempPath: part.tempPath,
        originalName: part.filename,
        size: part.size,
        mime: part.contentType || 'application/octet-stream'
      });
      return;
    }
    await rm(part.tempPath, { force: true });
    return;
  }

  result.fieldBytes += part.size;
  if (result.fieldBytes > MAX_UPLOAD_FIELDS_BYTES) {
    throw Object.assign(new Error('multipart fields too large'), {
      statusCode: 413,
      publicMessageKey: 'error.upload_metadata_too_large'
    });
  }
  const value = Buffer.concat(part.chunks).toString('utf8');
  if (part.name === 'paths') {
    result.paths.push(value);
    return;
  }
  if (part.name === 'uploadTaskId' && !result.uploadTaskId) {
    result.uploadTaskId = value;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function displayNameForFiles(files) {
  const folder = inferFolderName(files);
  if (folder) {
    return folder;
  }

  if (files.length === 1) {
    return files[0].name || files[0].path;
  }
  return `${files.length} files`;
}

function inferFileKind(files) {
  return inferFolderName(files) ? 'folder' : 'file';
}

function inferFolderName(files) {
  if (!files.length) {
    return '';
  }

  const roots = new Set();
  for (const file of files) {
    const parts = String(file.path || '').split('/').filter(Boolean);
    if (parts.length < 2) {
      return '';
    }
    roots.add(parts[0]);
  }

  return roots.size === 1 ? [...roots][0] : '';
}

function normalizeDisplayPath(input) {
  const raw = String(input || 'file').replace(/\\/g, '/');
  const parts = raw
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map(safePathSegment);
  return parts.length ? parts.join('/') : `file-${Date.now()}`;
}

function safePathSegment(segment) {
  const cleaned = segment
    .replace(/[\x00-\x1f<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'file';
}

function safeName(name) {
  return safePathSegment(String(name || 'download')).slice(0, 120) || 'download';
}

async function uniqueStoredPath(root, displayPath) {
  let candidate = displayPath;
  let counter = 2;
  while (true) {
    const absolutePath = safeJoin(root, candidate);
    try {
      await stat(absolutePath);
      const parsed = path.posix.parse(displayPath);
      candidate = path.posix.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`);
      counter += 1;
    } catch {
      return candidate;
    }
  }
}

function safeJoin(root, relativePath) {
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error('path traversal blocked');
  }
  return absolutePath;
}

function contentDisposition(filename) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(filename)}`;
}

function encodeRFC5987(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function streamZip(res, item) {
  const central = [];
  let offset = 0;
  const now = new Date();
  const { dosTime, dosDate } = toDosTime(now);
  const root = path.join(UPLOAD_DIR, item.id);

  for (const file of item.files) {
    const absolutePath = safeJoin(root, file.storedPath);
    const info = await stat(absolutePath);
    const crc = await crc32File(absolutePath);
    const name = Buffer.from(normalizeZipName(file.path), 'utf8');
    const localOffset = offset;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(info.size, 18);
    local.writeUInt32LE(info.size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    res.write(local);
    res.write(name);
    offset += local.length + name.length;
    await pipeFile(absolutePath, res);

    central.push({ name, crc, size: info.size, offset: localOffset, dosTime, dosDate });
    offset += info.size;
  }

  const centralStart = offset;
  for (const entry of central) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(entry.dosTime, 12);
    header.writeUInt16LE(entry.dosDate, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.size, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    res.write(header);
    res.write(entry.name);
    offset += header.length + entry.name.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  res.write(end);
  res.end();
}

function normalizeZipName(input) {
  return normalizeDisplayPath(input).replace(/^\/+/, '');
}

function toDosTime(date) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const year = Math.max(date.getFullYear(), 1980);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

async function crc32File(filePath) {
  let crc = 0xffffffff;
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      for (const byte of chunk) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      }
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

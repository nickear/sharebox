const state = {
  lang: getInitialLang(),
  authRequired: false,
  authenticated: false,
  itemTexts: new Map(),
  items: [],
  busy: false,
  eventSource: null,
  reloadScheduled: false,
  pendingReload: false
};

const messages = {
  en: {
    'aria.share_mode': 'Share mode',
    'label.password': 'Password',
    'button.login': 'Login',
    'button.logout': 'Logout',
    'button.language': 'Language',
    'button.publish_text': 'Publish Text',
    'button.clear': 'Clear',
    'button.choose_files': 'Choose Files',
    'button.choose_folder': 'Choose Folder',
    'button.refresh': 'Refresh',
    'tab.text': 'Text',
    'tab.files': 'Files',
    'placeholder.text_body': 'Paste or type text here',
    'drop.title': 'Drop files or folders here',
    'drop.subtitle': 'Use the buttons below if drag and drop is not available.',
    'empty.nothing': 'Nothing shared yet.',
    'toast.copied': 'Copied',
    'toast.deleted': 'Deleted',
    'toast.logged_in': 'Logged in',
    'toast.logged_out': 'Logged out',
    'toast.cleared': 'Cleared',
    'toast.refreshing': 'Refreshing...',
    'toast.refresh_complete': 'Refreshed',
    'toast.text_empty': 'Text is empty',
    'toast.text_published': 'Text published',
    'toast.upload_complete': 'Upload complete',
    'confirm.delete_item': 'Delete this item?',
    'confirm.clear_all': 'Clear all items?',
    'item.text': 'Text',
    'item.file': 'File',
    'item.folder': 'Folder',
    'item.download': 'Download',
    'item.download_zip': 'Download ZIP',
    'item.delete': 'Delete',
    'item.copy': 'Copy'
  },
  zh: {
    'aria.share_mode': '分享模式',
    'label.password': '密码',
    'button.login': '登录',
    'button.logout': '退出登录',
    'button.language': '语言',
    'button.publish_text': '发送文本',
    'button.clear': '清空',
    'button.choose_files': '选择文件',
    'button.choose_folder': '选择文件夹',
    'button.refresh': '刷新',
    'tab.text': '文本',
    'tab.files': '文件',
    'placeholder.text_body': '粘贴或输入文本',
    'drop.title': '将文件或文件夹拖到这里',
    'drop.subtitle': '如果不支持拖拽，请使用下面的按钮。',
    'empty.nothing': '还没有任何内容。',
    'toast.copied': '已复制',
    'toast.deleted': '已删除',
    'toast.logged_in': '已登录',
    'toast.logged_out': '已退出',
    'toast.cleared': '已清空',
    'toast.refreshing': '正在刷新...',
    'toast.refresh_complete': '已刷新',
    'toast.text_empty': '文本为空',
    'toast.text_published': '文本已发送',
    'toast.upload_complete': '上传完成',
    'confirm.delete_item': '确定删除这项内容吗？',
    'confirm.clear_all': '确定清空全部内容吗？',
    'item.text': '文本',
    'item.file': '文件',
    'item.folder': '文件夹',
    'item.download': '下载',
    'item.download_zip': '下载 ZIP',
    'item.delete': '删除',
    'item.copy': '复制'
  }
};

const els = {
  topbar: document.querySelector('.topbar'),
  loginShell: document.querySelector('#loginShell'),
  loginPanel: document.querySelector('#loginPanel'),
  appPanel: document.querySelector('#appPanel'),
  loginForm: document.querySelector('#loginForm'),
  loginPassword: document.querySelector('#loginPassword'),
  logoutBtn: document.querySelector('#logoutBtn'),
  refreshBtn: document.querySelector('#refreshBtn'),
  clearAllBtn: document.querySelector('#clearAllBtn'),
  textTab: document.querySelector('#textTab'),
  fileTab: document.querySelector('#fileTab'),
  textForm: document.querySelector('#textForm'),
  uploadForm: document.querySelector('#uploadForm'),
  textBody: document.querySelector('#textBody'),
  clearTextBtn: document.querySelector('#clearTextBtn'),
  dropZone: document.querySelector('#dropZone'),
  fileInput: document.querySelector('#fileInput'),
  folderInput: document.querySelector('#folderInput'),
  items: document.querySelector('#items'),
  itemCount: document.querySelector('#itemCount'),
  emptyState: document.querySelector('#emptyState'),
  toast: document.querySelector('#toast'),
  langMenus: [...document.querySelectorAll('.lang-menu')],
  langToggles: [...document.querySelectorAll('.lang-toggle')],
  langOptions: [...document.querySelectorAll('.lang-option')]
};

init();

async function init() {
  bindEvents();
  applyTranslations();
  await refreshSession();
}

function bindEvents() {
  els.loginForm.addEventListener('submit', handleLogin);
  els.logoutBtn.addEventListener('click', handleLogout);
  els.refreshBtn.addEventListener('click', handleRefreshClick);
  els.clearAllBtn.addEventListener('click', handleClearAll);
  for (const button of els.langToggles) {
    button.addEventListener('click', toggleLangMenu);
  }
  for (const button of els.langOptions) {
    button.addEventListener('click', handleLangSelect);
  }
  document.addEventListener('click', handleDocumentClick);

  els.textTab.addEventListener('click', () => setMode('text'));
  els.fileTab.addEventListener('click', () => setMode('files'));

  els.textForm.addEventListener('submit', handleTextSubmit);
  els.clearTextBtn.addEventListener('click', () => {
    els.textBody.value = '';
    els.textBody.focus();
  });

  els.fileInput.addEventListener('change', () => addFileList([...els.fileInput.files]));
  els.folderInput.addEventListener('change', () => addFileList([...els.folderInput.files]));

  for (const eventName of ['dragenter', 'dragover']) {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add('dragover');
    });
  }

  for (const eventName of ['dragleave', 'drop']) {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove('dragover');
    });
  }

  els.dropZone.addEventListener('drop', handleDrop);

  els.items.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) {
      return;
    }

    const itemId = action.dataset.id;
    const type = action.dataset.action;

    if (type === 'copy') {
      const text = state.itemTexts.get(itemId) || '';
      await copyText(text);
      showToast(t('toast.copied'));
    }

    if (type === 'delete') {
      const ok = confirm(t('confirm.delete_item'));
      if (!ok) {
        return;
      }
      await apiFetch(`/api/items/${itemId}`, { method: 'DELETE' });
      showToast(t('toast.deleted'));
      await loadItems();
    }
  });
}

async function refreshSession() {
  const session = await apiFetch('/api/session');
  state.authRequired = session.authRequired;
  state.authenticated = session.authenticated;

  if (state.authRequired && !state.authenticated) {
    closeEvents();
    els.topbar.classList.add('hidden');
    els.loginShell.classList.remove('hidden');
    els.appPanel.classList.add('hidden');
    els.logoutBtn.classList.add('hidden');
    els.loginPassword.focus();
    return;
  }

  els.topbar.classList.remove('hidden');
  els.loginShell.classList.add('hidden');
  els.appPanel.classList.remove('hidden');
  els.logoutBtn.classList.toggle('hidden', !state.authRequired);
  ensureEvents();
  await loadItems();
}

async function handleLogin(event) {
  event.preventDefault();
  setBusy(true);
  try {
    await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: els.loginPassword.value
      })
    });
    els.loginPassword.value = '';
    showToast(t('toast.logged_in'));
    await refreshSession();
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function handleLogout() {
  closeEvents();
  await apiFetch('/api/logout', { method: 'POST' });
  showToast(t('toast.logged_out'));
  await refreshSession();
}

async function handleRefreshClick() {
  showToast(t('toast.refreshing'));
  await loadItems({ showRefreshedToast: true });
}

function ensureEvents() {
  if (!state.authenticated || state.eventSource) {
    return;
  }

  const eventSource = new EventSource(`/api/events?lang=${encodeURIComponent(state.lang)}`);
  eventSource.addEventListener('items-updated', () => {
    scheduleReload();
  });
  eventSource.onerror = async () => {
    if (!state.authRequired) {
      return;
    }
    try {
      await apiFetch('/api/session');
    } catch (error) {
      if (error.status === 401) {
        closeEvents();
        state.authenticated = false;
        await refreshSession();
      }
    }
  };
  state.eventSource = eventSource;
}

function closeEvents() {
  state.eventSource?.close();
  state.eventSource = null;
}

function scheduleReload() {
  state.pendingReload = true;
  if (state.reloadScheduled) {
    return;
  }
  state.reloadScheduled = true;
  setTimeout(async () => {
    state.reloadScheduled = false;
    await flushPendingReload();
  }, 100);
}

async function flushPendingReload() {
  if (!state.pendingReload || !state.authenticated || state.busy) {
    return;
  }
  state.pendingReload = false;
  try {
    await loadItems();
  } catch {
    // loadItems already handles UI state and errors.
  }
  if (state.pendingReload && !state.reloadScheduled) {
    scheduleReload();
  }
}

async function handleClearAll() {
  const ok = confirm(t('confirm.clear_all'));
  if (!ok) {
    return;
  }

  setBusy(true);
  try {
    await apiFetch('/api/items', { method: 'DELETE' });
    showToast(t('toast.cleared'));
    await loadItems();
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

function setMode(mode) {
  const isText = mode === 'text';
  els.textTab.classList.toggle('active', isText);
  els.fileTab.classList.toggle('active', !isText);
  els.textForm.classList.toggle('hidden', !isText);
  els.uploadForm.classList.toggle('hidden', isText);
}

async function handleTextSubmit(event) {
  event.preventDefault();
  const text = els.textBody.value.trimEnd();
  if (!text.trim()) {
    showToast(t('toast.text_empty'));
    els.textBody.focus();
    return;
  }

  setBusy(true);
  try {
    await apiFetch('/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text
      })
    });
    els.textBody.value = '';
    showToast(t('toast.text_published'));
    await loadItems();
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function handleDrop(event) {
  const items = [...event.dataTransfer.items || []];
  if (items.length && items.some((item) => item.webkitGetAsEntry)) {
    const entries = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        entries.push(...await readDroppedEntry(entry, ''));
      }
    }
    await uploadEntries(entries);
    return;
  }

  await addFileList([...event.dataTransfer.files || []]);
}

async function addFileList(files) {
  const entries = files.map((file) => ({
    file,
    path: file.webkitRelativePath || file.name
  }));
  els.fileInput.value = '';
  els.folderInput.value = '';
  await uploadEntries(entries);
}

async function uploadEntries(entries) {
  const uniqueEntries = [];
  const existing = new Set();
  for (const entry of entries) {
    const key = `${entry.path}:${entry.file.size}:${entry.file.lastModified}`;
    if (!existing.has(key)) {
      uniqueEntries.push(entry);
      existing.add(key);
    }
  }

  if (!uniqueEntries.length) {
    return;
  }

  const groups = groupUploadEntries(uniqueEntries);

  setBusy(true);
  try {
    for (const group of groups) {
      const form = new FormData();
      for (const entry of group) {
        form.append('files', entry.file, entry.file.name);
        form.append('paths', entry.path || entry.file.name);
      }
      await apiFetch('/api/upload', {
        method: 'POST',
        body: form
      });
    }
    showToast(t('toast.upload_complete'));
    await loadItems();
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function readDroppedEntry(entry, basePath) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [{ file, path: joinWebPath(basePath, file.name) }];
  }

  if (entry.isDirectory) {
    const nextBase = joinWebPath(basePath, entry.name);
    const reader = entry.createReader();
    const children = [];

    while (true) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) {
        break;
      }
      children.push(...batch);
    }

    const files = [];
    for (const child of children) {
      files.push(...await readDroppedEntry(child, nextBase));
    }
    return files;
  }

  return [];
}

function joinWebPath(basePath, name) {
  return [basePath, name].filter(Boolean).join('/');
}

function groupUploadEntries(entries) {
  const fileGroups = [];
  const folderGroups = new Map();

  for (const entry of entries) {
    const normalizedPath = String(entry.path || entry.file.name || '').replace(/\\/g, '/');
    const parts = normalizedPath.split('/').filter(Boolean);
    if (parts.length <= 1) {
      fileGroups.push([entry]);
      continue;
    }

    const root = parts[0];
    if (!folderGroups.has(root)) {
      folderGroups.set(root, []);
    }
    folderGroups.get(root).push(entry);
  }

  return [...fileGroups, ...folderGroups.values()];
}

async function loadItems(options = {}) {
  if (state.authRequired && !state.authenticated) {
    return;
  }

  try {
    const data = await apiFetch('/api/items');
    renderItems(data.items || []);
    if (options.showRefreshedToast) {
      showToast(t('toast.refresh_complete'));
    }
  } catch (error) {
    if (error.status === 401) {
      state.authenticated = false;
      await refreshSession();
      return;
    }
    showToast(error.message);
  }
}

function renderItems(items) {
  state.items = items;
  state.itemTexts = new Map(items.filter((item) => item.type === 'text').map((item) => [item.id, item.text || '']));
  els.itemCount.textContent = formatItemCount(items.length);
  els.emptyState.classList.toggle('hidden', items.length > 0);
  els.items.innerHTML = items.map(renderItem).join('');
}

function renderItem(item) {
  if (item.type === 'text') {
    return `
      <article class="item">
        ${renderItemMeta(item, t('item.text'), item.size || 0)}
        <div class="item-content text-content">${escapeHtml(item.text || '')}</div>
        <div class="item-actions">
          <button class="ghost" type="button" data-action="copy" data-id="${item.id}">${t('item.copy')}</button>
          <a class="button-link" href="/api/items/${item.id}/download">${t('item.download')}</a>
          <button class="danger" type="button" data-action="delete" data-id="${item.id}">${t('item.delete')}</button>
        </div>
      </article>
    `;
  }

  const isFolder = item.kind === 'folder';
  const label = isFolder ? t('item.folder') : t('item.file');
  const downloadText = isFolder || item.fileCount > 1 ? t('item.download_zip') : t('item.download');
  const contentName = item.displayName || label;

  return `
    <article class="item">
      ${renderItemMeta(item, label, item.totalSize || 0)}
      <div class="item-content file-content">${escapeHtml(contentName)}</div>
      <div class="item-actions">
        <a class="button-link" href="${item.downloadUrl}">${downloadText}</a>
        <button class="danger" type="button" data-action="delete" data-id="${item.id}">${t('item.delete')}</button>
      </div>
    </article>
  `;
}

function renderItemMeta(item, label, size) {
  return `
    <div class="item-meta-row">
      <span class="badge ${label === 'Text' ? '' : 'files'}">${label}</span>
      <span>${formatBytes(size)}</span>
      <span class="meta-date">${formatDate(item.createdAt)}</span>
    </div>
  `;
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('X-Lang', state.lang);
  const response = await fetch(url, {
    ...options,
    headers
  });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof body === 'object' && body?.error ? body.error : `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return body;
}

function setBusy(busy) {
  state.busy = busy;
  for (const element of document.querySelectorAll('button')) {
    element.disabled = busy;
  }
  for (const element of document.querySelectorAll('.button-like')) {
    element.classList.toggle('disabled', busy);
    element.toggleAttribute('aria-disabled', busy);
  }
  if (!busy) {
    queueMicrotask(() => {
      flushPendingReload().catch(() => {
        // loadItems already handles UI state and errors.
      });
    });
  }
}

let toastTimer = null;
function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2400);
}

function handleLangSelect(event) {
  const nextLang = event.currentTarget.dataset.langOption;
  if (nextLang !== 'zh' && nextLang !== 'en') {
    return;
  }
  state.lang = nextLang;
  localStorage.setItem('sharebox_lang', state.lang);
  closeLangMenus();
  applyTranslations();
  renderItems(state.items);
}

function applyTranslations() {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  document.title = 'ShareBox';
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }
  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  }
  for (const element of document.querySelectorAll('[data-i18n-title]')) {
    element.title = t(element.dataset.i18nTitle);
  }
  for (const menu of els.langMenus) {
    const toggle = menu.querySelector('.lang-toggle');
    const pop = menu.querySelector('.lang-pop');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!pop?.classList.contains('hidden')));
    }
  }
  for (const button of els.langOptions) {
    const active = button.dataset.langOption === state.lang;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  }
  if (state.authenticated) {
    renderItems(state.items);
  } else {
    els.itemCount.textContent = formatItemCount(0);
  }
}

function t(key, vars = {}) {
  const table = messages[state.lang] || messages.en;
  let text = table[key] || messages.en[key] || key;
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

function getInitialLang() {
  const stored = localStorage.getItem('sharebox_lang');
  if (stored === 'zh' || stored === 'en') {
    return stored;
  }
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function formatItemCount(count) {
  if (state.lang === 'zh') {
    return `${count} 项`;
  }
  return `${count} item${count === 1 ? '' : 's'}`;
}

function toggleLangMenu(event) {
  event.stopPropagation();
  const menu = event.currentTarget.closest('.lang-menu');
  if (!menu) {
    return;
  }
  const pop = menu.querySelector('.lang-pop');
  const willOpen = pop?.classList.contains('hidden');
  closeLangMenus();
  if (willOpen && pop) {
    pop.classList.remove('hidden');
    event.currentTarget.setAttribute('aria-expanded', 'true');
  }
}

function closeLangMenus() {
  for (const menu of els.langMenus) {
    menu.querySelector('.lang-pop')?.classList.add('hidden');
    menu.querySelector('.lang-toggle')?.setAttribute('aria-expanded', 'false');
  }
}

function handleDocumentClick(event) {
  if (event.target.closest('.lang-menu')) {
    return;
  }
  closeLangMenus();
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = units.shift();
  while (size >= 1024 && units.length) {
    size /= 1024;
    unit = units.shift();
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through for plain HTTP deployments where Clipboard API may be blocked.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

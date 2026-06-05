const state = {
  lang: getInitialLang(),
  authRequired: false,
  authenticated: false,
  itemTexts: new Map(),
  items: [],
  pendingUploads: [],
  busy: false,
  currentUploadTaskId: null,
  eventSource: null,
  reloadScheduled: false,
  pendingReload: false,
  mutationRefreshTimer: null
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
    'button.pause': 'Pause',
    'button.resume': 'Resume',
    'button.cancel': 'Cancel',
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
    'toast.cancel_failed': 'Cancel failed. Please try again.',
    'toast.text_empty': 'Text is empty',
    'toast.text_published': 'Text published',
    'toast.upload_complete': 'Upload complete',
    'upload.uploading': 'Uploading {percent}% · {loaded} / {size}',
    'upload.queued': 'Queued',
    'upload.paused': 'Paused',
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
    'button.pause': '暂停',
    'button.resume': '继续',
    'button.cancel': '取消',
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
    'toast.cancel_failed': '取消失败，请重试',
    'toast.text_empty': '文本为空',
    'toast.text_published': '文本已发送',
    'toast.upload_complete': '上传完成',
    'upload.uploading': '正在上传 {percent}% · {loaded} / {size}',
    'upload.queued': '排队中',
    'upload.paused': '已暂停',
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
    const uploadAction = event.target.closest('[data-upload-action]');
    if (uploadAction) {
      const taskId = uploadAction.dataset.uploadId;
      const type = uploadAction.dataset.uploadAction;
      if (type === 'pause') {
        pauseUploadTask(taskId);
      }
      if (type === 'resume') {
        resumeUploadTask(taskId);
      }
      if (type === 'cancel') {
        void cancelUploadTask(taskId);
      }
      return;
    }

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
      scheduleMutationRefreshFallback();
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
    scheduleMutationRefreshFallback();
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
    scheduleMutationRefreshFallback();
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
  const tasks = createUploadTasks(groups);
  state.pendingUploads.push(...tasks);
  renderList();
  syncBusyState();
  void processUploadQueue();
}

function uploadGroup(task, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('uploadTaskId', task.id);
    for (const entry of task.entries) {
      form.append('files', entry.file, entry.file.name);
      form.append('paths', entry.path || entry.file.name);
    }

    const xhr = new XMLHttpRequest();
    task.xhr = xhr;
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('X-Lang', state.lang);
    xhr.responseType = 'text';

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded);
      }
    };

    xhr.onerror = () => {
      task.xhr = null;
      reject(new Error('Network error'));
    };

    xhr.onabort = () => {
      task.xhr = null;
      const error = new Error(task.abortReason || 'Upload aborted');
      error.code = task.abortReason || 'abort';
      reject(error);
    };

    xhr.onload = () => {
      const type = xhr.getResponseHeader('content-type') || '';
      let body = xhr.responseText;
      if (type.includes('application/json') && xhr.responseText) {
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = xhr.responseText;
        }
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = typeof body === 'object' && body?.error ? body.error : `HTTP ${xhr.status}`;
        const error = new Error(message);
        error.status = xhr.status;
        task.xhr = null;
        reject(error);
        return;
      }
      task.xhr = null;
      onProgress(task.totalBytes);
      resolve(body);
    };

    xhr.send(form);
  });
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

function createUploadTasks(groups) {
  return groups.map((group) => {
    const first = group[0];
    const normalizedPath = String(first.path || first.file.name || '').replace(/\\/g, '/');
    const parts = normalizedPath.split('/').filter(Boolean);
    const isFolder = parts.length > 1;
    return {
      id: crypto.randomUUID(),
      kind: isFolder ? 'folder' : 'file',
      displayName: isFolder ? parts[0] : (first.file.name || normalizedPath || t('item.file')),
      createdAt: new Date().toISOString(),
      totalBytes: group.reduce((sum, entry) => sum + Number(entry.file.size || 0), 0),
      entries: group,
      uploadedBytes: 0,
      status: 'queued',
      xhr: null,
      abortReason: ''
    };
  });
}

function updatePendingUpload(id, patch, options = {}) {
  const task = state.pendingUploads.find((item) => item.id === id);
  if (!task) {
    return;
  }
  Object.assign(task, patch);
  if (options.replace) {
    replacePendingUploadDom(task);
    return;
  }
  patchPendingUploadDom(task);
}

function removePendingUpload(id) {
  const next = state.pendingUploads.filter((item) => item.id !== id);
  if (next.length === state.pendingUploads.length) {
    return;
  }
  state.pendingUploads = next;
  renderList();
}

async function processUploadQueue() {
  if (state.currentUploadTaskId) {
    return;
  }

  const task = state.pendingUploads.find((item) => item.status === 'queued');
  if (!task) {
    syncBusyState();
    return;
  }

  state.currentUploadTaskId = task.id;
  updatePendingUpload(task.id, {
    status: 'uploading',
    uploadedBytes: 0,
    abortReason: ''
  }, { replace: true });
  syncBusyState();

  try {
    const result = await uploadGroup(task, (loaded) => {
      updatePendingUpload(task.id, {
        status: 'uploading',
        uploadedBytes: loaded
      });
    });
    if (result?.cancelled) {
      removePendingUpload(task.id);
      return;
    }
    removePendingUpload(task.id);
    scheduleMutationRefreshFallback();
    showToast(t('toast.upload_complete'));
  } catch (error) {
    const current = state.pendingUploads.find((item) => item.id === task.id);
    if (current?.abortReason === 'pause') {
      updatePendingUpload(task.id, {
        status: 'paused',
        uploadedBytes: 0,
        xhr: null,
        abortReason: ''
      }, { replace: true });
    } else if (current?.abortReason === 'cancel') {
      removePendingUpload(task.id);
    } else {
      removePendingUpload(task.id);
      showToast(error.message);
    }
  } finally {
    if (state.currentUploadTaskId === task.id) {
      state.currentUploadTaskId = null;
    }
    syncBusyState();
    void processUploadQueue();
  }
}

function pauseUploadTask(id) {
  const task = state.pendingUploads.find((item) => item.id === id);
  if (!task) {
    return;
  }
  if (task.status === 'queued') {
    updatePendingUpload(id, { status: 'paused' }, { replace: true });
    syncBusyState();
    return;
  }
  if (task.status === 'uploading' && task.xhr) {
    task.abortReason = 'pause';
    task.xhr.abort();
  }
}

function resumeUploadTask(id) {
  const task = state.pendingUploads.find((item) => item.id === id);
  if (!task || task.status !== 'paused') {
    return;
  }
  updatePendingUpload(id, {
    status: 'queued',
    uploadedBytes: 0,
    abortReason: ''
  }, { replace: true });
  syncBusyState();
  void processUploadQueue();
}

async function cancelUploadTask(id) {
  const task = state.pendingUploads.find((item) => item.id === id);
  if (!task) {
    return;
  }
  let cancelled = false;
  try {
    await notifyUploadCancelled(id);
    cancelled = true;
  } catch {
    showToast(t('toast.cancel_failed'));
  }
  if (!cancelled) {
    return;
  }
  scheduleMutationRefreshFallback();
  if (task.status === 'uploading' && task.xhr) {
    task.abortReason = 'cancel';
    task.xhr.abort();
    return;
  }
  removePendingUpload(id);
  syncBusyState();
  void processUploadQueue();
}

function syncBusyState() {
  const hasActiveQueueWork = state.pendingUploads.some((item) => item.status === 'queued' || item.status === 'uploading');
  setBusy(hasActiveQueueWork);
}

async function loadItems(options = {}) {
  if (state.authRequired && !state.authenticated) {
    return;
  }

  try {
    const data = await apiFetch('/api/items');
    clearMutationRefreshFallback();
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
  const completedTaskIds = new Set(items.map((item) => item.uploadTaskId).filter(Boolean));
  if (completedTaskIds.size) {
    state.pendingUploads = state.pendingUploads.filter((task) => !completedTaskIds.has(task.id));
  }
  state.items = items;
  state.itemTexts = new Map(items.filter((item) => item.type === 'text').map((item) => [item.id, item.text || '']));
  renderList();
}

function renderList() {
  const totalCount = state.pendingUploads.length + state.items.length;
  els.itemCount.textContent = formatItemCount(totalCount);
  els.emptyState.classList.toggle('hidden', totalCount > 0);
  els.items.innerHTML = [
    ...state.pendingUploads.map(renderPendingUpload),
    ...state.items.map(renderItem)
  ].join('');
}

function renderPendingUpload(task) {
  const label = task.kind === 'folder' ? t('item.folder') : t('item.file');
  const percent = task.totalBytes > 0 ? Math.min(100, Math.round((task.uploadedBytes / task.totalBytes) * 100)) : 0;
  const text = task.status === 'queued'
    ? t('upload.queued')
    : task.status === 'paused'
      ? t('upload.paused')
      : t('upload.uploading', {
          percent,
          loaded: formatBytes(task.uploadedBytes),
          size: formatBytes(task.totalBytes)
        });
  // Keep pause/resume logic in code for later, but hide those controls for now.
  const controls = `
    <button class="danger upload-control" type="button" data-upload-action="cancel" data-upload-id="${task.id}">${t('button.cancel')}</button>
  `;

  return `
    <article class="item" data-pending-upload-id="${task.id}">
      ${renderItemMeta(task, label, task.totalBytes || 0, 'files', { showDate: false })}
      <div class="item-content file-content">${escapeHtml(task.displayName)}</div>
      <div class="item-progress-row">
        <div class="item-progress ${task.status === 'queued' ? 'queued' : ''} ${task.status === 'paused' ? 'paused' : ''}">
          <div class="item-progress-fill" style="width: ${percent}%"></div>
          <div class="item-progress-text">${escapeHtml(text)}</div>
        </div>
        <div class="item-progress-actions">${controls}</div>
      </div>
    </article>
  `;
}

function replacePendingUploadDom(task) {
  const current = els.items.querySelector(`[data-pending-upload-id="${task.id}"]`);
  if (!current) {
    renderList();
    return;
  }
  current.outerHTML = renderPendingUpload(task);
}

function patchPendingUploadDom(task) {
  const current = els.items.querySelector(`[data-pending-upload-id="${task.id}"]`);
  if (!current) {
    return;
  }
  const percent = task.totalBytes > 0 ? Math.min(100, Math.round((task.uploadedBytes / task.totalBytes) * 100)) : 0;
  const text = task.status === 'queued'
    ? t('upload.queued')
    : task.status === 'paused'
      ? t('upload.paused')
      : t('upload.uploading', {
          percent,
          loaded: formatBytes(task.uploadedBytes),
          size: formatBytes(task.totalBytes)
        });
  current.querySelector('.item-progress-fill')?.setAttribute('style', `width: ${percent}%`);
  const progress = current.querySelector('.item-progress');
  progress?.classList.toggle('queued', task.status === 'queued');
  progress?.classList.toggle('paused', task.status === 'paused');
  const textNode = current.querySelector('.item-progress-text');
  if (textNode) {
    textNode.textContent = text;
  }
}

function renderItem(item) {
  if (item.type === 'text') {
    return `
      <article class="item">
        ${renderItemMeta(item, t('item.text'), item.size || 0, item.type)}
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
      ${renderItemMeta(item, label, item.totalSize || 0, item.type)}
      <div class="item-content file-content">${escapeHtml(contentName)}</div>
      <div class="item-actions">
        <a class="button-link" href="${item.downloadUrl}">${downloadText}</a>
        <button class="danger" type="button" data-action="delete" data-id="${item.id}">${t('item.delete')}</button>
      </div>
    </article>
  `;
}

function renderItemMeta(item, label, size, type, options = {}) {
  const showDate = options.showDate !== false;
  return `
    <div class="item-meta-row">
      <span class="badge ${type === 'text' ? '' : 'files'}">${label}</span>
      <span>${formatBytes(size)}</span>
      ${showDate ? `<span class="meta-date">${formatDate(item.createdAt)}</span>` : ''}
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

function notifyUploadCancelled(uploadTaskId) {
  return apiFetch('/api/uploads/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadTaskId })
  });
}

function scheduleMutationRefreshFallback() {
  clearMutationRefreshFallback();
  state.mutationRefreshTimer = setTimeout(async () => {
    state.mutationRefreshTimer = null;
    if (state.authRequired && !state.authenticated) {
      return;
    }
    await loadItems();
  }, 1200);
}

function clearMutationRefreshFallback() {
  if (!state.mutationRefreshTimer) {
    return;
  }
  clearTimeout(state.mutationRefreshTimer);
  state.mutationRefreshTimer = null;
}

function setBusy(busy) {
  state.busy = busy;
  for (const element of document.querySelectorAll('button')) {
    if (element.classList.contains('upload-control')) {
      continue;
    }
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
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

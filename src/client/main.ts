import './style.css';

type User = {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  created_at?: string;
  file_count?: number;
  storage_bytes?: string;
};
type Upload = {
  id: string;
  name: string;
  mime: string;
  size: number;
  created_at: string;
  owner_name?: string;
  owner_email?: string;
};
type Page = 'files' | 'users' | 'uploads';
const root = document.querySelector<HTMLDivElement>('#app')!;
let user: User | null = null;
let csrf = '';
let page: Page = 'files';
let files: Upload[] = [];
let users: User[] = [];
let filter = '';
let sort = 'newest';
let loading = false;
let uploading = false;
let pageError = '';
let toastTimer: ReturnType<typeof setTimeout>;

const icons: Record<string, string> = {
  box: '<path d="m3 7 9-5 9 5v10l-9 5-9-5V7Z"/><path d="m3 7 9 5 9-5M12 12v10M7.5 4.5l9 5"/>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  upload:
    '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  download:
    '<path d="M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  logout:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  cloud:
    '<path d="M7 18a5 5 0 1 1 .2-10 7 7 0 0 1 13.5 3A3.5 3.5 0 0 1 19 18"/><path d="M12 22V12m-4 4 4-4 4 4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
};
function icon(name: string, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.file}</svg>`;
}
function escape(value: unknown) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
}
function bytes(value: number) {
  return value < 1024
    ? `${value} B`
    : value < 1024 ** 2
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1024 ** 2).toFixed(1)} MB`;
}
function date(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}
function toast(message: string, error = false) {
  const el = document.querySelector<HTMLDivElement>('#toast')!;
  el.textContent = message;
  el.className = `visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = '';
  }, 5000);
}
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (options.method && options.method !== 'GET')
    headers.set('x-csrf-token', csrf);
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401 && user) {
      user = null;
      renderAuth();
    }
    throw new Error(result?.error ?? 'The request failed. Please try again.');
  }
  return result;
}
async function bootstrap() {
  try {
    const result = await api<{ user: User | null; csrfToken: string }>(
      '/session',
    );
    user = result.user;
    csrf = result.csrfToken;
    if (user) {
      renderShell();
      await loadPage();
    } else renderAuth();
  } catch {
    root.innerHTML = `<main class="unavailable"><div class="brand-mark">${icon('box')}</div><h1>We couldn’t open your drop box</h1><p>Check that the server and database are running, then try again.</p><button class="primary" id="retry">Try again ${icon('arrow')}</button></main>`;
    document
      .querySelector('#retry')!
      .addEventListener('click', () => void bootstrap());
  }
}
function renderAuth(register = false) {
  root.innerHTML = `<div class="auth-layout">
    <aside class="auth-story"><a class="brand" href="/"> <span class="brand-mark">${icon('box')}</span>drop box<span class="brand-dot">.</span></a>
      <div class="story-content"><span class="eyebrow">A LITTLE SPACE. ALL YOURS.</span><h1>Your files.<br>Your own<br><span>corner of the cloud.</span></h1><p>A simple, private place for the things you want to keep close. Upload, organize, and pick up where you left off.</p><div class="story-tags"><span>${icon('lock')} Private by default</span><span>${icon('shield')} Yours to access</span></div></div>
      <div class="story-bottom"><span class="azure-symbol">▰</span> Built for your Azure learning journey <span>01 / 01</span></div>
    </aside>
    <main class="auth-main"><div class="auth-top">${register ? 'Already have an account?' : 'New around here?'} <button class="text-button" id="switch-auth">${register ? 'Sign in' : 'Create an account'} ${icon('arrow')}</button></div>
      <div class="auth-card"><div class="small-label">YOUR PRIVATE WORKSPACE</div><h2>${register ? 'Make yourself at home.' : 'Welcome back.'}</h2><p class="muted">${register ? 'Create an account to start your own drop box.' : 'Sign in to your drop box. Everything is right where you left it.'}</p>
      <form id="auth-form">${register ? '<label for="name">Your name</label><input id="name" name="name" autocomplete="name" placeholder="Alex Morgan" required maxlength="80" />' : ''}
      <label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="254" />
      <div class="password-label"><label for="password">Password</label><button class="text-button subtle" type="button" id="show-password">Show</button></div><input id="password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="${register ? 'At least 12 characters' : 'Enter your password'}" required minlength="12" maxlength="72" />
      ${register ? '<p class="field-note">Use 12–72 characters. A longer, unique passphrase works well.</p>' : ''}
      <p id="auth-error" class="form-error" role="alert"></p><button class="primary auth-submit" type="submit">${register ? 'Create account' : 'Sign in'} ${icon('arrow')}</button></form>
      <div class="auth-privacy">${icon('shield')} Your files are only available to you.</div></div>
      <footer class="auth-footer"><span>Less sharing. More peace of mind.</span><span>${icon('lock')} A private file drop</span></footer>
    </main></div>`;
  document
    .querySelector('#switch-auth')!
    .addEventListener('click', () => renderAuth(!register));
  document
    .querySelector('#show-password')!
    .addEventListener('click', (event) => {
      const input = document.querySelector<HTMLInputElement>('#password')!;
      input.type = input.type === 'password' ? 'text' : 'password';
      (event.currentTarget as HTMLButtonElement).textContent =
        input.type === 'password' ? 'Show' : 'Hide';
    });
  document
    .querySelector<HTMLFormElement>('#auth-form')!
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const button = form.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;
      button.disabled = true;
      button.textContent = register ? 'Creating account…' : 'Signing in…';
      try {
        const result = await api<{ user: User; csrfToken: string }>(
          `/auth/${register ? 'register' : 'login'}`,
          {
            method: 'POST',
            body: JSON.stringify(Object.fromEntries(new FormData(form))),
          },
        );
        user = result.user;
        csrf = result.csrfToken;
        page = 'files';
        filter = '';
        renderShell();
        await loadPage();
        toast(
          register ? 'Your drop box is ready. Welcome in.' : 'Welcome back.',
        );
      } catch (error) {
        document.querySelector('#auth-error')!.textContent = (
          error as Error
        ).message;
        // Refresh the CSRF token if a prior session expired.
        await api<{ csrfToken: string }>('/session')
          .then((value) => {
            csrf = value.csrfToken;
          })
          .catch(() => {});
      } finally {
        button.disabled = false;
        button.innerHTML = `${register ? 'Create account' : 'Sign in'} ${icon('arrow')}`;
      }
    });
}
function renderShell() {
  if (!user) return;
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  root.innerHTML = `<div class="workspace"><aside class="sidebar"><a class="brand" href="/"> <span class="brand-mark">${icon('box')}</span>drop box<span class="brand-dot">.</span></a><div class="nav-label">WORKSPACE</div>
    <nav aria-label="Main navigation"><button class="nav-item" data-page="files">${icon('folder')} My files <span id="file-count"></span></button>${user.role === 'admin' ? `<div class="nav-label admin-label">ADMINISTRATION</div><button class="nav-item" data-page="users">${icon('users')} Users</button><button class="nav-item" data-page="uploads">${icon('shield')} All uploads</button>` : ''}</nav>
    <div class="sidebar-bottom"><div class="private-note">${icon('shield')}<strong>A space just for you</strong><p>Only you can download your files. Always.</p></div><div class="profile"><div class="avatar">${escape(initials)}</div><div class="profile-text"><strong>${escape(user.name)}</strong><span>${user.role === 'admin' ? 'Administrator' : 'Personal account'}</span></div><button class="icon-button" id="logout" aria-label="Sign out" title="Sign out">${icon('logout')}</button></div></div>
  </aside><div class="workspace-main"><header class="topbar"><span>Personal workspace <span class="slash">/</span> <strong id="breadcrumb">My files</strong></span><span class="private-badge">${icon('lock')} Private workspace</span></header><main id="content"></main><footer class="workspace-footer"><span>YOUR FILES. YOUR SPACE.</span><span>${icon('shield')} Private by default.</span></footer></div></div>`;
  document
    .querySelectorAll<HTMLButtonElement>('[data-page]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        page = button.dataset.page as Page;
        filter = '';
        void loadPage();
      }),
    );
  document.querySelector('#logout')!.addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
      user = null;
      files = [];
      users = [];
      await bootstrap();
    } catch (error) {
      toast((error as Error).message, true);
    }
  });
}
async function loadPage() {
  const requestedPage = page;
  loading = true;
  pageError = '';
  renderContent();
  try {
    if (requestedPage === 'files') {
      const result = await api<{ files: Upload[] }>('/files');
      if (page === requestedPage) files = result.files;
    } else if (requestedPage === 'uploads') {
      const result = await api<{ files: Upload[] }>('/admin/uploads');
      if (page === requestedPage) files = result.files;
    } else {
      const result = await api<{ users: User[] }>('/admin/users');
      if (page === requestedPage) users = result.users;
    }
  } catch (error) {
    if (requestedPage === page) pageError = (error as Error).message;
  } finally {
    if (requestedPage === page) {
      loading = false;
      renderContent();
    }
  }
}
function renderContent() {
  if (!user || !document.querySelector('#content')) return;
  const title =
    page === 'files'
      ? 'My files'
      : page === 'users'
        ? 'People in your workspace'
        : 'All uploads';
  document.querySelector('#breadcrumb')!.textContent =
    page === 'files' ? 'My files' : page === 'users' ? 'Users' : 'All uploads';
  document.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === page);
    if (el.dataset.page === page) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  if (page === 'files' && !loading)
    document.querySelector('#file-count')!.textContent = String(files.length);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const latest = files.length
    ? files.reduce((a, b) => (a.created_at > b.created_at ? a : b))
    : null;
  document.querySelector('#content')!.innerHTML =
    `<div class="page-heading"><div><div class="small-label">${page === 'files' ? 'YOUR PERSONAL DROP BOX' : 'WORKSPACE OVERVIEW'}</div><h1>${title}<span class="heading-dot">.</span></h1><p class="muted">${page === 'files' ? 'A little less clutter. A little more peace of mind.' : 'A clear view of your workspace. File contents stay private.'}</p></div>${page === 'files' ? `<button class="primary" id="upload-button" ${uploading ? 'disabled' : ''}>${icon('upload')} Upload file</button>` : `<span class="metadata-badge">${icon('shield')} Metadata only</span>`}</div>
    ${
      page === 'files'
        ? `<section class="stats" aria-label="Storage overview"><div class="stat"><span class="stat-icon blue">${icon('folder')}</span><div><span>Total files</span><strong>${loading ? '—' : files.length}<small>files in your space</small></strong></div></div><div class="stat"><span class="stat-icon lilac">${icon('box')}</span><div><span>Storage used</span><strong>${loading ? '—' : bytes(totalBytes)}<small>of 100 MB available</small></strong></div><div class="storage-track"><span class="storage-fill ${totalBytes >= 90 * 1024 ** 2 ? 'near-limit' : ''}" data-percent="${Math.min(100, totalBytes / 1024 ** 2)}"></span></div></div><div class="stat"><span class="stat-icon green">${icon('shield')}</span><div><span>Access level</span><strong class="stat-private">Just you <span class="green-dot"></span><small>Private by default</small></strong></div></div></section>
    <section class="dropzone ${uploading ? 'busy' : ''}" id="dropzone" aria-label="File upload"><div class="dropzone-icon">${icon('cloud')}</div><div><h2>${uploading ? 'Uploading your file…' : 'Drop it here. Keep it close.'}</h2><p>${uploading ? 'Your file will appear below when it’s ready.' : 'Drag and drop a file, or <button class="text-button" id="browse-button">browse files</button>'}</p><span>PDF, PNG, JPG, TXT, MD, CSV <i>·</i> Up to 10 MB per file</span></div><div class="dropzone-decoration" aria-hidden="true">${icon('file')}${icon('file')}</div></section><input id="file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.md,.csv" hidden />`
        : ''
    }
    <section class="files-panel"><div class="panel-heading"><div><h2>${page === 'files' ? 'Your files' : page === 'users' ? 'Registered users' : 'Upload inventory'} <span class="count-badge">${loading ? '—' : page === 'users' ? users.length : files.length}</span></h2><p>${page === 'files' ? (latest ? `Last upload ${date(latest.created_at)}` : 'Your next good idea belongs here.') : page === 'users' ? 'Account roles and storage usage.' : 'Upload metadata across all accounts. No content access.'}</p></div><div class="table-tools"><label class="search-field">${icon('search')}<input id="search" type="search" placeholder="${page === 'users' ? 'Search users…' : 'Search files…'}" aria-label="${page === 'users' ? 'Search users' : 'Search files'}" value="${escape(filter)}" /></label>${page !== 'users' ? `<select id="sort" aria-label="Sort files"><option value="newest" ${sort === 'newest' ? 'selected' : ''}>Newest first</option><option value="oldest" ${sort === 'oldest' ? 'selected' : ''}>Oldest first</option><option value="name" ${sort === 'name' ? 'selected' : ''}>Name A–Z</option><option value="size" ${sort === 'size' ? 'selected' : ''}>Largest first</option></select>` : ''}</div></div><div id="table-content"></div></section>
    ${page === 'files' ? `<div class="ownership-note">${icon('lock')} Your files stay yours. Other users and admins can’t download them.</div>` : ''}`;
  document.querySelectorAll<HTMLElement>('[data-percent]').forEach((el) => {
    // Use a native progress element below; CSP does not permit inline styles.
    const progress = document.createElement('progress');
    progress.max = 100;
    progress.value = Number(el.dataset.percent);
    progress.setAttribute('aria-label', 'Storage usage');
    el.replaceWith(progress);
  });
  document
    .querySelector<HTMLInputElement>('#search')!
    .addEventListener('input', (event) => {
      filter = (event.target as HTMLInputElement).value;
      renderTable();
    });
  document.querySelector('#sort')?.addEventListener('change', (event) => {
    sort = (event.target as HTMLSelectElement).value;
    renderTable();
  });
  const input = document.querySelector<HTMLInputElement>('#file-input');
  for (const id of ['upload-button', 'browse-button'])
    document
      .querySelector(`#${id}`)
      ?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', () => {
    if (input.files?.[0]) void uploadFile(input.files[0]);
  });
  const zone = document.querySelector<HTMLElement>('#dropzone');
  zone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('drag-over');
  });
  zone?.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone?.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('drag-over');
    if (event.dataTransfer?.files.length !== 1) {
      toast('Please upload one file at a time.', true);
      return;
    }
    void uploadFile(event.dataTransfer.files[0]);
  });
  renderTable();
}
function renderTable() {
  const container = document.querySelector('#table-content');
  if (!container) return;
  if (loading) {
    container.innerHTML =
      '<div class="empty-state"><div class="spinner"></div><h3>Gathering your workspace…</h3></div>';
    return;
  }
  if (pageError) {
    container.innerHTML = `<div class="empty-state"><h3>We couldn’t load this view</h3><p>${escape(pageError)}</p><button class="secondary" id="retry-page">Try again</button></div>`;
    document
      .querySelector('#retry-page')!
      .addEventListener('click', () => void loadPage());
    return;
  }
  const query = filter.toLowerCase();
  if (page === 'users') {
    const visible = users.filter((item) =>
      `${item.name} ${item.email}`.toLowerCase().includes(query),
    );
    if (!visible.length) {
      emptyTable(
        container,
        'No matching users',
        'Try a different name or email address.',
      );
      return;
    }
    container.innerHTML = `<div class="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Files</th><th>Storage</th><th>Joined</th></tr></thead><tbody>${visible.map((item) => `<tr><td><strong>${escape(item.name)}</strong></td><td>${escape(item.email)}</td><td><span class="role-badge">${escape(item.role)}</span></td><td>${item.file_count}</td><td>${bytes(Number(item.storage_bytes))}</td><td>${date(item.created_at!)}</td></tr>`).join('')}</tbody></table></div>`;
    return;
  }
  const visible = files
    .filter((item) =>
      `${item.name} ${item.owner_email ?? ''}`.toLowerCase().includes(query),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'size'
          ? b.size - a.size
          : sort === 'oldest'
            ? a.created_at.localeCompare(b.created_at)
            : b.created_at.localeCompare(a.created_at),
    );
  if (!visible.length) {
    emptyTable(
      container,
      filter ? 'No files found' : 'A fresh start for your files',
      filter
        ? 'Try another filename or clear your search.'
        : 'Upload your first file. We’ll keep it right here for you.',
    );
    return;
  }
  container.innerHTML = `<div class="table-scroll"><table><thead><tr><th class="name-column">File name</th><th>File size</th><th>Uploaded</th><th>${page === 'uploads' ? 'Owner' : 'Access'}</th>${page === 'files' ? '<th><span class="sr-only">Download</span></th>' : ''}</tr></thead><tbody>${visible
    .map((file) => {
      const ext = file.name.split('.').pop()!.toUpperCase();
      return `<tr><td><div class="file-cell"><span class="file-icon ${['PNG', 'JPG', 'JPEG'].includes(ext) ? 'image-file' : ext === 'PDF' ? 'pdf-file' : 'text-file'}">${icon('file')}<small>${escape(ext)}</small></span><div><strong>${escape(file.name)}</strong><span>${file.mime.startsWith('image/') ? 'Image' : ext === 'PDF' ? 'PDF document' : 'Text document'}</span></div></div></td><td>${bytes(file.size)}</td><td>${date(file.created_at)}</td><td>${page === 'uploads' ? `<span class="owner-email">${escape(file.owner_email)}</span>` : `<span class="access-label">${icon('lock')} Only you</span>`}</td>${page === 'files' ? `<td><button class="icon-button download-button" data-id="${file.id}" aria-label="Download ${escape(file.name)}" title="Download file">${icon('download')}</button></td>` : ''}</tr>`;
    })
    .join(
      '',
    )}</tbody></table></div><div class="table-footer">${visible.length} ${visible.length === 1 ? 'file' : 'files'}${filter ? ` matching “${escape(filter)}”` : ' in your workspace'}<span>${icon('check')} ${page === 'files' ? 'Only you have access' : 'Metadata access only'}</span></div>`;
  container
    .querySelectorAll<HTMLButtonElement>('.download-button')
    .forEach((button) =>
      button.addEventListener(
        'click',
        () => void downloadFile(button.dataset.id!, button),
      ),
    );
}
function emptyTable(container: Element, title: string, description: string) {
  container.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon(filter ? 'search' : 'folder')}</div><h3>${title}</h3><p>${description}</p></div>`;
}
async function uploadFile(file: File) {
  if (uploading) return;
  if (file.size > 10 * 1024 ** 2) {
    toast('Files must be 10 MB or smaller.', true);
    return;
  }
  if (!file.size) {
    toast('Choose a file with some content.', true);
    return;
  }
  if (!/\.(pdf|png|jpe?g|txt|md|csv)$/i.test(file.name)) {
    toast('Choose a PDF, PNG, JPG, TXT, MD, or CSV file.', true);
    return;
  }
  uploading = true;
  renderContent();
  try {
    const data = new FormData();
    data.append('file', file);
    await api('/files', { method: 'POST', body: data });
    toast(`${file.name} is safely in your drop box.`);
    await loadPage();
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    uploading = false;
    renderContent();
  }
}
async function downloadFile(id: string, button: HTMLButtonElement) {
  button.disabled = true;
  try {
    const response = await fetch(`/api/files/${id}/download`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = files.find((file) => file.id === id)?.name ?? 'download';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast('Your download is ready.');
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    button.disabled = false;
  }
}
void bootstrap();

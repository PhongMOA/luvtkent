/**
 * Main App - Routing & Init
 */
const App = {
  async init() {
    // Init database
    await window.appDB.init();

    // Warm up remote server in background — Render free tier sleeps after
    // 15min idle and cold start can take 30s+, which makes the first user
    // action (e.g. movie search) fail with "Failed to fetch".
    this.warmUpServer();

    // Init modules
    ComicCrawler.init();
    ComicReader.init();
    await ComicLibrary.init();
    await MovieManager.init();
    await MusicManager.init();
    if (typeof KaraokeManager !== 'undefined') await KaraokeManager.init();
    TabExtractor.init();

    // Load history
    ComicCrawler.loadHistory();

    // Auto sync from cloud silently in background
    setTimeout(async () => {
      try {
        // One-time fix: patch comics missing source_url on Supabase (id = url)
        const fixed = await window.cloudDB.fixMissingSourceUrls();
        if (fixed > 0) console.log(`🔧 Đã sửa ${fixed} truyện thiếu source_url`);

        console.log('🔄 Tự động đồng bộ từ Cloud...');
        await window.appDB.syncFromCloud();
        
        // Refresh UI if we are on those tabs
        MovieManager.loadMovies();
        ComicLibrary.loadComics();
        if (typeof MusicManager !== 'undefined') MusicManager.loadMusicList();
        if (typeof KaraokeManager !== 'undefined') KaraokeManager.loadList();
        console.log('✅ Đồng bộ tự động hoàn tất!');
      } catch (e) {
        console.log('⚠️ Không thể đồng bộ tự động:', e.message);
      }
    }, 1000);

    // Load settings
    this.loadSettings();

    // Setup routing
    this.setupRouting();

    // Setup settings handlers
    this.setupSettings();

    // Display version
    document.getElementById('app-version-text').textContent = `v${AppConfig.APP_VERSION}`;

    // Auto check for updates
    setTimeout(() => this.checkForUpdates(true), 3000);

    console.log('🎬 LuvTK Entertainment initialized');
  },

  setupRouting() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const page = tab.dataset.page;
        this.navigateTo(page);
      });
    });
  },

  navigateTo(pageName) {
    // Update tabs
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.nav-tab[data-page="${pageName}"]`)?.classList.add('active');

    // Update pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${pageName}`)?.classList.add('active');
  },

  warmUpServer() {
    // Skip on localhost — same-origin Express is always warm.
    const base = AppConfig.getApiBase();
    if (!base) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const t0 = performance.now();
    fetch(base + '/api/health', { cache: 'no-store', signal: controller.signal })
      .then(r => r.ok && console.log(`☕ Server warm (${Math.round(performance.now() - t0)}ms)`))
      .catch(err => console.log('⚠️ Warm-up ping failed:', err.message))
      .finally(() => clearTimeout(timer));
  },

  // Block until the remote server responds to /api/health, or the timeout
  // expires. Returns true if reachable, false otherwise. Use before any
  // user-triggered remote action that would otherwise crash with
  // "Failed to fetch" on a cold Render dyno.
  async ensureServerReady({ onProgress, totalTimeoutMs = 60000, intervalMs = 3000, pingTimeoutMs = 10000 } = {}) {
    const base = AppConfig.getApiBase();
    if (!base) return true; // localhost: same-origin Express is always up
    const deadline = Date.now() + totalTimeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt++;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), pingTimeoutMs);
        const res = await fetch(base + '/api/health', { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) return true;
      } catch (_) {
        // network error or abort — keep polling
      }
      onProgress?.(attempt);
      if (Date.now() + intervalMs >= deadline) break;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
  },

  async loadSettings() {
    const pairs = await window.appDB.getSetting('domainReplacements');
    AppConfig.setDomainMap(Array.isArray(pairs) ? pairs : []);
    this.renderDomainReplacements();
  },

  // Thu thập các domain nguồn hiện có trong thư viện để làm option cho
  // multi-select "domain cũ". Ưu tiên ComicLibrary.comics đã nạp; nếu chưa có
  // thì đọc thẳng từ DB.
  async _getLibraryHosts() {
    let comics = (window.ComicLibrary && ComicLibrary.comics) || [];
    if ((!comics || !comics.length) && window.appDB?.getAllComics) {
      try { comics = await window.appDB.getAllComics(); } catch (_) { comics = []; }
    }
    const set = new Set();
    (comics || []).forEach(c => {
      const url = c.url || (c.id && String(c.id).startsWith('http') ? c.id : '');
      if (!url) return;
      try { set.add(new URL(url).host.toLowerCase()); } catch (_) {}
    });
    return Array.from(set).sort();
  },

  async renderDomainReplacements() {
    const list = document.getElementById('domain-replacements-list');
    if (!list) return;
    const pairs = AppConfig.getDomainMap();
    if (pairs.length === 0) {
      list.innerHTML = `<div style="font-size:13px; color: var(--text-tertiary); font-style: italic;">
        Chưa có cặp domain nào. Bấm "Thêm cặp domain" để thêm.
      </div>`;
      return;
    }

    const hosts = await this._getLibraryHosts();

    list.innerHTML = pairs.map((p, i) => {
      const froms = Array.isArray(p.from) ? p.from : (p.from ? [p.from] : []);
      // Gộp host trong thư viện với các domain đang chọn (kể cả domain đã bị
      // migrate nên không còn trong thư viện) để không mất lựa chọn cũ.
      const optionHosts = Array.from(new Set([...hosts, ...froms])).sort();
      const size = Math.min(Math.max(optionHosts.length, 3), 6);
      const options = optionHosts.length
        ? optionHosts.map(h =>
            `<option value="${h}" ${froms.includes(h) ? 'selected' : ''}>${h}</option>`
          ).join('')
        : '';
      const emptyHint = optionHosts.length
        ? ''
        : `<div style="font-size:12px; color: var(--text-tertiary); font-style: italic; padding:8px;">Thư viện chưa có nguồn nào</div>`;
      return `
      <div class="domain-row" data-index="${i}" style="display:flex; gap:8px; align-items:flex-start;">
        <div style="flex:1; min-width:0;">
          <select multiple class="domain-from" size="${size}"
            style="width:100%; box-sizing:border-box; padding:6px 8px; border-radius:8px; border:1px solid var(--border); background:var(--bg-secondary); color:var(--text-primary); font-size:13px;">
            ${options}
          </select>
          ${emptyHint}
        </div>
        <span class="material-icons-round" style="color:var(--text-tertiary); font-size:18px; margin-top:8px;">arrow_forward</span>
        <input type="text" class="domain-to" value="${p.to}" placeholder="domain mới (vd: toptruyenzone9.com)"
          style="flex:1; min-width:0; margin-top:8px; padding:8px 10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-secondary); color:var(--text-primary); font-size:13px;">
        <button class="btn btn-danger domain-remove" title="Xóa cặp này" style="padding:6px 10px; margin-top:8px;">
          <span class="material-icons-round">delete</span>
        </button>
      </div>
    `;
    }).join('');

    list.querySelectorAll('.domain-row').forEach(row => {
      const idx = parseInt(row.dataset.index);
      const fromSelect = row.querySelector('.domain-from');
      const toInput = row.querySelector('.domain-to');
      const onChange = async () => {
        const pairs = AppConfig.getDomainMap();
        const froms = fromSelect
          ? Array.from(fromSelect.selectedOptions).map(o => o.value)
          : [];
        pairs[idx] = { from: froms, to: toInput.value.trim() };
        AppConfig.setDomainMap(pairs);
        await window.appDB.setSetting('domainReplacements', AppConfig.getDomainMap());
      };
      fromSelect?.addEventListener('change', onChange);
      toInput.addEventListener('change', onChange);
      row.querySelector('.domain-remove').addEventListener('click', async () => {
        const pairs = AppConfig.getDomainMap();
        pairs.splice(idx, 1);
        AppConfig.setDomainMap(pairs);
        await window.appDB.setSetting('domainReplacements', AppConfig.getDomainMap());
        this.renderDomainReplacements();
      });
    });
  },

  setupDomainReplacementSettings() {
    const addBtn = document.getElementById('btn-add-domain-replacement');
    const applyBtn = document.getElementById('btn-apply-domain-replacement');
    if (!addBtn || !applyBtn) return;

    addBtn.addEventListener('click', async () => {
      const pairs = AppConfig.getDomainMap();
      pairs.push({ from: [], to: '' });
      AppConfig.setDomainMap(pairs);
      await window.appDB.setSetting('domainReplacements', AppConfig.getDomainMap());
      this.renderDomainReplacements();
    });

    applyBtn.addEventListener('click', async () => {
      const pairs = AppConfig.getDomainMap().filter(p =>
        (Array.isArray(p.from) ? p.from.length : p.from) && p.to
      );
      if (pairs.length === 0) {
        this.showToast('Chưa có cặp domain hợp lệ để áp dụng', 'warning');
        return;
      }
      if (!confirm(`Áp dụng ${pairs.length} cặp domain cho toàn bộ thư viện truyện? URL và id của truyện sẽ được cập nhật.`)) {
        return;
      }
      const statusEl = document.getElementById('domain-replacement-status');
      applyBtn.disabled = true;
      const originalHtml = applyBtn.innerHTML;
      applyBtn.innerHTML = '<span class="material-icons-round spin">sync</span> Đang áp dụng...';
      statusEl.textContent = 'Đang quét thư viện...';

      try {
        const stats = await ComicLibrary.migrateAllDomains();
        statusEl.innerHTML = `<span style="color:var(--success)">✓ Đã cập nhật ${stats.updated}/${stats.scanned} truyện (${stats.chaptersUpdated} chapter)</span>`;
        this.showToast(`Đã migrate ${stats.updated} truyện sang domain mới`, 'success');
        await ComicLibrary.loadComics();
      } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--danger)">✗ Lỗi: ${err.message}</span>`;
        this.showToast(`Lỗi: ${err.message}`, 'error');
      } finally {
        applyBtn.disabled = false;
        applyBtn.innerHTML = originalHtml;
      }
    });
  },

  setupSettings() {
    // Export data
    document.getElementById('btn-export-data').addEventListener('click', async () => {
      const data = await window.appDB.exportAll();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `luvtk_ent_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Đã xuất dữ liệu', 'success');
    });

    // Import data
    document.getElementById('btn-import-data').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await window.appDB.importAll(data);
        this.showToast('Đã nhập dữ liệu thành công', 'success');
        MovieManager.loadMovies();
        ComicCrawler.loadHistory();
        this.loadSettings();
      } catch (err) {
        this.showToast(`Lỗi nhập dữ liệu: ${err.message}`, 'error');
      }
      e.target.value = '';
    });

    // Clear data
    document.getElementById('btn-clear-data').addEventListener('click', async () => {
      if (!confirm('Xóa TẤT CẢ dữ liệu? Hành động này không thể hoàn tác!')) return;
      if (!confirm('Bạn chắc chắn chứ?')) return;

      await window.appDB.clearAll();
      this.showToast('Đã xóa tất cả dữ liệu', 'info');
      MovieManager.loadMovies();
      ComicCrawler.loadHistory();
    });

    // Cloud Sync - Push to cloud
    document.getElementById('btn-sync-to-cloud').addEventListener('click', async () => {
      const btn = document.getElementById('btn-sync-to-cloud');
      const statusEl = document.getElementById('cloud-sync-status');
      btn.disabled = true;
      btn.innerHTML = '<span class="material-icons-round spin">sync</span> Đang đẩy...';
      statusEl.textContent = 'Đang đồng bộ lên cloud...';

      try {
        const result = await window.appDB.syncToCloud();
        statusEl.innerHTML = `<span style="color:var(--success)">✓ Đã đẩy: ${result.movies} phim, ${result.comics} truyện, ${result.karaoke || 0} bài karaoke</span>`;
        this.showToast('Đồng bộ lên cloud thành công!', 'success');
      } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--danger)">✗ Lỗi: ${err.message}</span>`;
        this.showToast(`Lỗi sync: ${err.message}`, 'error');
      }
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-round">cloud_upload</span> Đẩy lên Cloud';
    });

    // Cloud Sync - Pull from cloud
    document.getElementById('btn-sync-from-cloud').addEventListener('click', async () => {
      const btn = document.getElementById('btn-sync-from-cloud');
      const statusEl = document.getElementById('cloud-sync-status');
      btn.disabled = true;
      btn.innerHTML = '<span class="material-icons-round spin">sync</span> Đang kéo...';
      statusEl.textContent = 'Đang kéo dữ liệu từ cloud...';

      try {
        const result = await window.appDB.syncFromCloud();
        statusEl.innerHTML = `<span style="color:var(--success)">✓ Đã kéo: ${result.movies} phim, ${result.comics} truyện, ${result.karaoke || 0} bài karaoke</span>`;
        this.showToast('Kéo dữ liệu từ cloud thành công!', 'success');
        MovieManager.loadMovies();
        ComicLibrary.loadComics();
        if (typeof KaraokeManager !== 'undefined') KaraokeManager.loadList();
      } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--danger)">✗ Lỗi: ${err.message}</span>`;
        this.showToast(`Lỗi sync: ${err.message}`, 'error');
      }
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-round">cloud_download</span> Kéo từ Cloud';
    });

    // Check for updates button
    document.getElementById('btn-check-update').addEventListener('click', () => {
      this.checkForUpdates(false);
    });

    // Domain replacement handlers
    this.setupDomainReplacementSettings();
  },

  async checkForUpdates(silent) {
    const btn = document.getElementById('btn-check-update');
    const statusEl = document.getElementById('update-check-status');
    const banner = document.getElementById('update-banner');

    if (!silent) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-icons-round spin">sync</span> Đang kiểm tra...';
      statusEl.textContent = '';
    }

    const update = await AppConfig.checkForUpdates(silent);

    if (update) {
      // Show update banner
      banner.classList.remove('hidden');
      document.getElementById('update-version-info').textContent = 
        `v${update.current} → v${update.latest}`;
      document.getElementById('update-download-link').href = update.url;

      if (!silent) {
        this.showToast(`Có phiên bản mới v${update.latest}!`, 'success');
      }
    } else if (!silent) {
      statusEl.innerHTML = `<span style="color:var(--success)">✓ Đang dùng bản mới nhất (v${AppConfig.APP_VERSION})</span>`;
      banner.classList.add('hidden');
      this.showToast('Bạn đang dùng phiên bản mới nhất!', 'info');
    }

    if (!silent) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-round">system_update</span> Kiểm tra cập nhật';
    }
  },

  // Toast notification system
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = {
      success: 'check_circle',
      error: 'error',
      warning: 'warning',
      info: 'info',
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="material-icons-round">${icons[type]}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    // Click to dismiss
    toast.addEventListener('click', () => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    });

    // Auto remove after 4s
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
      }
    }, 4000);
  },

  confirm(message, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    const msgEl = document.getElementById('confirm-modal-msg');
    const btnCancel = document.getElementById('confirm-modal-cancel');
    const btnOk = document.getElementById('confirm-modal-ok');

    msgEl.textContent = message;
    modal.classList.remove('hidden');

    const hide = () => {
      modal.classList.add('hidden');
      btnCancel.removeEventListener('click', handleCancel);
      btnOk.removeEventListener('click', handleOk);
    };

    const handleCancel = () => hide();
    const handleOk = () => {
      hide();
      if (typeof onConfirm === 'function') onConfirm();
    };

    btnCancel.addEventListener('click', handleCancel);
    btnOk.addEventListener('click', handleOk);
  }
};

// Initialize when DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());

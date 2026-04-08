/**
 * Main App - Routing & Init
 */
const App = {
  async init() {
    // Init database
    await window.appDB.init();

    // Init modules
    ComicCrawler.init();
    ComicReader.init();
    await ComicLibrary.init();
    await MovieManager.init();
    await MusicManager.init();

    // Load history
    ComicCrawler.loadHistory();

    // Auto sync from cloud silently in background
    setTimeout(async () => {
      try {
        console.log('🔄 Tự động đồng bộ từ Cloud...');
        await window.appDB.syncFromCloud();
        
        // Refresh UI if we are on those tabs
        MovieManager.loadMovies();
        ComicLibrary.loadComics();
        if (typeof MusicManager !== 'undefined') MusicManager.loadMusicList();
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

  async loadSettings() {
    // Settings loaded here if any
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
        statusEl.innerHTML = `<span style="color:var(--success)">✓ Đã đẩy: ${result.movies} phim, ${result.comics} truyện, ${result.settings} cài đặt</span>`;
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
        statusEl.innerHTML = `<span style="color:var(--success)">✓ Đã kéo: ${result.movies} phim, ${result.comics} truyện</span>`;
        this.showToast('Kéo dữ liệu từ cloud thành công!', 'success');
        MovieManager.loadMovies();
        ComicLibrary.loadComics();
      } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--danger)">✗ Lỗi: ${err.message}</span>`;
        this.showToast(`Lỗi sync: ${err.message}`, 'error');
      }
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-round">cloud_download</span> Kéo từ Cloud';
    });
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

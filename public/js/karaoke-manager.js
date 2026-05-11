/**
 * Karaoke Manager
 * - Lưu trữ tên bài hát + lyrics
 * - Tìm kiếm tên bài và lyrics qua Google Search (qua /api/karaoke/search)
 */
const KaraokeManager = {
  songs: [],
  _filterText: '',
  _readerFontSize: 18,

  async init() {
    this.bindEvents();
    await this.loadList();
  },

  bindEvents() {
    // Search from Google
    document.getElementById('btn-karaoke-search').addEventListener('click', () => this.searchGoogle());
    document.getElementById('karaoke-search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.searchGoogle();
      }
    });

    // Add / Update form
    document.getElementById('karaoke-add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSubmit();
    });

    // Cancel edit
    document.getElementById('karaoke-cancel-edit').addEventListener('click', () => this.resetForm());

    // Filter input
    document.getElementById('karaoke-filter-input').addEventListener('input', (e) => {
      this._filterText = e.target.value.trim().toLowerCase();
      this.renderList();
    });

    // Reader overlay
    document.getElementById('karaoke-reader-close').addEventListener('click', () => this.closeReader());
    document.addEventListener('keydown', (e) => {
      const overlay = document.getElementById('karaoke-reader-overlay');
      if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) {
        this.closeReader();
      }
    });
    document.getElementById('karaoke-font-up').addEventListener('click', () => this.adjustFontSize(2));
    document.getElementById('karaoke-font-down').addEventListener('click', () => this.adjustFontSize(-2));
  },

  // ===== GOOGLE SEARCH =====
  async searchGoogle() {
    const input = document.getElementById('karaoke-search-input');
    const status = document.getElementById('karaoke-search-status');
    const resultsBox = document.getElementById('karaoke-search-results');
    const btn = document.getElementById('btn-karaoke-search');
    const query = input.value.trim();

    if (!query) {
      App.showToast('Vui lòng nhập tên bài hát', 'warning');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-round spin">sync</span> Đang tìm...';
    status.textContent = 'Đang tìm kiếm...';
    resultsBox.classList.add('hidden');
    resultsBox.innerHTML = '';

    try {
      const res = await fetch(`/api/karaoke/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Không tìm thấy kết quả');
      }

      const results = data.results || [];
      if (results.length === 0) {
        status.innerHTML = '<span style="color:var(--warning,#f59e0b)">Không tìm thấy kết quả nào.</span>';
      } else {
        status.innerHTML = `<span style="color:var(--success,#10b981)">Tìm thấy ${results.length} kết quả. Bấm để lấy lời.</span>`;
        resultsBox.classList.remove('hidden');
        resultsBox.innerHTML = results.map((r, idx) => `
          <div class="karaoke-result-item" data-idx="${idx}" style="padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); cursor: pointer; transition: background 0.15s;">
            <div style="font-weight: 600; font-size: 14px; color: var(--text-primary); margin-bottom: 3px;">${this.escapeHtml(r.title || '(không tiêu đề)')}</div>
            <div style="font-size: 12px; color: var(--text-secondary); opacity: 0.85; word-break: break-all;">${this.escapeHtml(r.url || '')}</div>
            ${r.snippet ? `<div style="font-size: 12px; color: var(--text-tertiary); margin-top: 4px; line-height: 1.4;">${this.escapeHtml(r.snippet.slice(0, 200))}</div>` : ''}
          </div>
        `).join('');

        resultsBox.querySelectorAll('.karaoke-result-item').forEach(el => {
          el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-tertiary, rgba(255,255,255,0.05))');
          el.addEventListener('mouseleave', () => el.style.background = 'var(--bg-secondary)');
          el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.idx);
            this.fetchLyricsFromResult(results[idx]);
          });
        });
      }
    } catch (err) {
      status.innerHTML = `<span style="color:var(--danger,#ef4444)">Lỗi: ${this.escapeHtml(err.message)}</span>`;
      App.showToast(`Tìm kiếm lỗi: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-round">travel_explore</span> <span>Tìm</span>';
    }
  },

  async fetchLyricsFromResult(result) {
    const status = document.getElementById('karaoke-search-status');
    status.innerHTML = '<span class="material-icons-round spin" style="font-size:14px;vertical-align:middle">sync</span> Đang tải lời từ ' + this.escapeHtml(this.extractDomain(result.url)) + '...';

    try {
      const res = await fetch(`/api/karaoke/fetch-lyrics?url=${encodeURIComponent(result.url)}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Không lấy được lời bài hát');
      }

      // Fill the form
      document.getElementById('karaoke-title').value = data.title || result.title || '';
      document.getElementById('karaoke-artist').value = data.artist || '';
      document.getElementById('karaoke-lyrics').value = data.lyrics || '';

      status.innerHTML = '<span style="color:var(--success,#10b981)">✓ Đã điền vào form. Kiểm tra & nhấn "Lưu bài hát".</span>';
      App.showToast('Đã lấy lời bài hát thành công!', 'success');

      // Scroll to form
      document.getElementById('karaoke-add-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      status.innerHTML = `<span style="color:var(--danger,#ef4444)">Lỗi: ${this.escapeHtml(err.message)}</span>`;
      App.showToast(`Lỗi lấy lời: ${err.message}`, 'error');
    }
  },

  extractDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
      return url;
    }
  },

  // ===== ADD / EDIT =====
  async handleSubmit() {
    const id = document.getElementById('karaoke-edit-id').value;
    const title = document.getElementById('karaoke-title').value.trim();
    const artist = document.getElementById('karaoke-artist').value.trim();
    const lyrics = document.getElementById('karaoke-lyrics').value;

    if (!title) {
      App.showToast('Vui lòng nhập tên bài hát', 'warning');
      return;
    }
    if (!lyrics.trim()) {
      App.showToast('Vui lòng nhập lời bài hát', 'warning');
      return;
    }

    const songData = {
      id: id || ('karaoke_' + Date.now()),
      title,
      artist,
      lyrics,
    };

    try {
      // Preserve addedAt on edit
      if (id) {
        const existing = await window.appDB.getKaraoke(id);
        if (existing) songData.addedAt = existing.addedAt;
      }

      await window.appDB.saveKaraoke(songData);
      App.showToast(id ? 'Đã cập nhật bài hát' : 'Đã lưu bài hát', 'success');
      this.resetForm();
      await this.loadList();
    } catch (err) {
      App.showToast('Lỗi khi lưu bài hát', 'error');
      console.error(err);
    }
  },

  resetForm() {
    document.getElementById('karaoke-edit-id').value = '';
    document.getElementById('karaoke-title').value = '';
    document.getElementById('karaoke-artist').value = '';
    document.getElementById('karaoke-lyrics').value = '';
    document.getElementById('karaoke-form-icon').textContent = 'add_circle';
    document.getElementById('karaoke-form-title').textContent = 'Thêm bài hát mới';
    document.getElementById('karaoke-submit-text').textContent = 'Lưu bài hát';
    document.getElementById('karaoke-cancel-edit').classList.add('hidden');
  },

  startEdit(id) {
    const song = this.songs.find(s => s.id === id);
    if (!song) return;
    document.getElementById('karaoke-edit-id').value = song.id;
    document.getElementById('karaoke-title').value = song.title || '';
    document.getElementById('karaoke-artist').value = song.artist || '';
    document.getElementById('karaoke-lyrics').value = song.lyrics || '';
    document.getElementById('karaoke-form-icon').textContent = 'edit';
    document.getElementById('karaoke-form-title').textContent = 'Sửa bài hát';
    document.getElementById('karaoke-submit-text').textContent = 'Cập nhật';
    document.getElementById('karaoke-cancel-edit').classList.remove('hidden');
    document.getElementById('karaoke-add-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  async deleteSong(id) {
    const song = this.songs.find(s => s.id === id);
    if (!song) return;

    App.confirm(`Xóa bài hát "${song.title}"?`, async () => {
      try {
        await window.appDB.deleteKaraoke(id);
        App.showToast('Đã xóa bài hát', 'info');
        await this.loadList();
      } catch (err) {
        App.showToast('Lỗi khi xóa', 'error');
        console.error(err);
      }
    });
  },

  // ===== READER =====
  openReader(id) {
    const song = this.songs.find(s => s.id === id);
    if (!song) return;

    document.getElementById('karaoke-reader-title').textContent = song.title || 'Bài hát';
    document.getElementById('karaoke-reader-artist').textContent = song.artist || '';
    document.getElementById('karaoke-lyrics-wrapper').textContent = song.lyrics || '';

    this._readerFontSize = 18;
    this.applyFontSize();
    document.getElementById('karaoke-reader-overlay').classList.remove('hidden');
  },

  closeReader() {
    document.getElementById('karaoke-reader-overlay').classList.add('hidden');
  },

  adjustFontSize(delta) {
    this._readerFontSize = Math.max(12, Math.min(40, this._readerFontSize + delta));
    this.applyFontSize();
  },

  applyFontSize() {
    document.getElementById('karaoke-lyrics-wrapper').style.fontSize = this._readerFontSize + 'px';
  },

  // ===== LIST =====
  async loadList() {
    try {
      this.songs = await window.appDB.getAllKaraoke();
      this.renderList();
    } catch (err) {
      console.error('Lỗi tải danh sách karaoke:', err);
    }
  },

  renderList() {
    const listEl = document.getElementById('karaoke-list');
    const emptyEl = document.getElementById('karaoke-empty');

    const filtered = this._filterText
      ? this.songs.filter(s =>
          (s.title || '').toLowerCase().includes(this._filterText) ||
          (s.artist || '').toLowerCase().includes(this._filterText))
      : this.songs;

    if (filtered.length === 0) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');

    listEl.innerHTML = filtered.map((song, idx) => {
      const lineCount = (song.lyrics || '').split('\n').length;
      return `
        <div class="karaoke-row" data-id="${song.id}" style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-secondary); transition: background 0.15s;">
          <div style="width: 28px; text-align: center; font-size: 12px; color: var(--text-tertiary); flex-shrink: 0;">${idx + 1}</div>
          <span class="material-icons-round" style="color: var(--primary-color, #8b5cf6); font-size: 20px; flex-shrink: 0;">mic</span>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escapeHtml(song.title)}</div>
            <div style="font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escapeHtml(song.artist || '—')}</div>
          </div>
          <div style="font-size: 11px; color: var(--text-tertiary); text-align: right; flex-shrink: 0; min-width: 70px;">
            <div>${lineCount} dòng</div>
            <div>${new Date(song.addedAt).toLocaleDateString('vi-VN')}</div>
          </div>
          <div style="display: flex; gap: 4px; flex-shrink: 0;">
            <button class="btn btn-primary btn-sm karaoke-open-btn" data-id="${song.id}" title="Hát" style="padding: 6px 10px; min-width: unset;">
              <span class="material-icons-round" style="font-size: 16px;">play_arrow</span>
            </button>
            <button class="btn btn-sm btn-secondary karaoke-edit-btn" data-id="${song.id}" title="Sửa" style="padding: 6px; min-width: unset;">
              <span class="material-icons-round" style="font-size: 16px;">edit</span>
            </button>
            <button class="btn btn-sm btn-danger karaoke-delete-btn" data-id="${song.id}" title="Xóa" style="padding: 6px; min-width: unset;">
              <span class="material-icons-round" style="font-size: 16px;">delete</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Click row (ngoài button) cũng mở reader
    listEl.querySelectorAll('.karaoke-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        this.openReader(row.dataset.id);
      });
    });

    // Bind events
    listEl.querySelectorAll('.karaoke-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => this.startEdit(btn.dataset.id));
    });
    listEl.querySelectorAll('.karaoke-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this.deleteSong(btn.dataset.id));
    });
    listEl.querySelectorAll('.karaoke-open-btn').forEach(btn => {
      btn.addEventListener('click', () => this.openReader(btn.dataset.id));
    });
  },

  // ===== HELPERS =====
  escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  },
};

window.KaraokeManager = KaraokeManager;

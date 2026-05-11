/**
 * Comic Library Module
 * Displays all crawled comics in a beautiful grid with pagination
 */
const ComicLibrary = {
  comics: [],
  currentPage: 1,
  pageSize: 20,
  selectedComic: null,

  async init() {
    this.bindEvents();
    await this.loadComics();
  },

  bindEvents() {
    // Back from detail
    document.getElementById('lib-back-btn').addEventListener('click', () => this.showGrid());

    // Delete from detail
    document.getElementById('lib-delete-detail-btn').addEventListener('click', () => {
      if (this.selectedComic) {
        this.deleteComic(this.selectedComic.id);
      }
    });

    // Star from detail
    document.getElementById('lib-star-detail-btn').addEventListener('click', () => {
      if (this.selectedComic) {
        this.toggleStar(this.selectedComic.id);
      }
    });

    // Focus search
    document.getElementById('lib-search-input').addEventListener('input', (e) => {
      this.currentPage = 1;
      this.renderGrid();
    });

    // Detail view action buttons
    document.getElementById('lib-detail-read-first').addEventListener('click', () => {
      if (!this.selectedComic || !this.selectedComic.chapters?.length) return;
      let startIdx = this.selectedComic.chapters.length - 1;
      const firstNum = parseInt((this.selectedComic.chapters[0].chapter.match(/\d+/) || [0])[0]);
      const lastNum = parseInt((this.selectedComic.chapters[startIdx].chapter.match(/\d+/) || [0])[0]);
      // If chapter 1 is at index 0, then startIdx = 0
      if (firstNum > 0 && lastNum > 0 && firstNum < lastNum) startIdx = 0;
      this.readFromChapter(this.selectedComic, startIdx);
    });

    document.getElementById('lib-detail-read-continue').addEventListener('click', () => {
      if (!this.selectedComic || !this.selectedComic.chapters?.length) return;
      const startIdx = this.selectedComic.lastReadChapter !== undefined ? this.selectedComic.lastReadChapter : 0;
      this.readFromChapter(this.selectedComic, startIdx);
    });

    document.getElementById('lib-update-comic-btn').addEventListener('click', () => {
      if (this.selectedComic) this.updateComic(this.selectedComic);
    });

    const updateAllBtn = document.getElementById('lib-update-all-btn');
    if (updateAllBtn) {
      updateAllBtn.addEventListener('click', () => this.updateAllComics());
    }
  },

  async updateComic(comic) {
    const updateBtn = document.getElementById('lib-update-comic-btn');
    const originalText = updateBtn.innerHTML;
    updateBtn.disabled = true;

    try {
      const result = await this._runUpdate(comic, {
        onStage: (stage, pct) => {
          if (stage === 'scan') {
            updateBtn.innerHTML = '<span class="material-icons-round spin">sync</span> Kiểm tra...';
          } else if (stage === 'download') {
            updateBtn.innerHTML = `<span class="material-icons-round spin">sync</span> Tải... ${pct ?? 0}%`;
          }
        },
      });

      if (result.status === 'up-to-date') {
        App.showToast('Truyện đã ở tập mới nhất!', 'info');
      } else if (result.status === 'updated') {
        App.showToast(`Đã tự động cập nhật ${result.newCount} tập mới!`, 'success');
        this.showDetail(comic.id);
      }
    } catch (err) {
      App.showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      updateBtn.disabled = false;
      updateBtn.innerHTML = originalText;
    }
  },

  /**
   * Core update pipeline for a single comic. Resolves when the job is fully
   * done (or rejects on error), so callers can await it sequentially.
   * Returns { status: 'up-to-date' | 'updated' | 'skipped', newCount }.
   */
  async _runUpdate(comic, { onStage } = {}) {
    const sourceUrl = comic.url || comic.sourceUrl || (comic.id && comic.id.startsWith('http') ? comic.id : null);
    if (!sourceUrl) {
      return { status: 'skipped', reason: 'no-url', newCount: 0 };
    }
    comic.url = sourceUrl;

    onStage?.('scan');

    const scanRes = await fetch('/api/crawl/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: comic.url })
    });
    const scanData = await scanRes.json();
    if (!scanRes.ok) throw new Error(scanData.error || 'Scan lỗi');

    const comicInfo = scanData.data;
    const allChapters = comicInfo.chapters || [];

    comicInfo.description = comic.description || comicInfo.description;
    comicInfo.cover = comic.cover || comicInfo.cover;

    const existingUrls = new Set((comic.chapters || []).map(c => c.url));
    let maxExistingNum = -1;
    (comic.chapters || []).forEach(c => {
      const match = (c.chapter || c.title || '').match(/[\d.,]+/);
      if (match) maxExistingNum = Math.max(maxExistingNum, parseFloat(match[0]));
    });

    const newChapters = allChapters.filter(ch => {
      if (existingUrls.has(ch.url)) return false;
      const match = (ch.chapter || ch.title || '').match(/[\d.,]+/);
      const num = match ? parseFloat(match[0]) : null;
      if (num !== null && maxExistingNum !== -1) return num > maxExistingNum;
      return true;
    });

    if (newChapters.length === 0) {
      return { status: 'up-to-date', newCount: 0 };
    }

    onStage?.('download', 0);

    const startRes = await fetch('/api/crawl/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: comic.url,
        chapters: newChapters.map(c => c.url),
        comicTitle: comicInfo.title
      })
    });
    const startData = await startRes.json();
    if (!startRes.ok) throw new Error(startData.error || 'Crawl lỗi');

    const jobId = startData.jobId;

    const job = await new Promise((resolve, reject) => {
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/crawl/status/${jobId}`);
          const j = await statusRes.json();
          if (j.status === 'running') {
            const pct = j.progress?.total > 0
              ? Math.round((j.progress.current / j.progress.total) * 100)
              : 0;
            onStage?.('download', pct);
          } else if (j.status === 'done') {
            clearInterval(pollInterval);
            resolve(j);
          } else if (j.status === 'error') {
            clearInterval(pollInterval);
            reject(new Error(j.error || 'Crawl lỗi'));
          }
        } catch (pollErr) {
          console.error(pollErr);
        }
      }, 1500);
    });

    await this.saveFromCrawlResults(comicInfo, job.results.chaptersData);
    fetch(`/api/crawl/job/${jobId}`, { method: 'DELETE' }).catch(() => {});

    return { status: 'updated', newCount: newChapters.length };
  },

  async updateAllComics() {
    const btn = document.getElementById('lib-update-all-btn');
    if (!btn || btn.disabled) return;

    // Snapshot to avoid concurrent mutations from saveFromCrawlResults
    // (which rewrites this.comics after each save).
    const snapshot = await window.appDB.getAllComics();
    const candidates = snapshot.filter(c =>
      c.url || c.sourceUrl || (c.id && String(c.id).startsWith('http'))
    );

    if (candidates.length === 0) {
      App.showToast('Thư viện chưa có truyện nào có link nguồn!', 'warning');
      return;
    }

    if (!confirm(`Quét & cập nhật tập mới cho ${candidates.length} truyện? Quá trình chạy tuần tự và có thể mất vài phút.`)) {
      return;
    }

    const originalText = btn.innerHTML;
    btn.disabled = true;

    let updated = 0;
    let upToDate = 0;
    let failed = 0;
    let totalNew = 0;

    for (let i = 0; i < candidates.length; i++) {
      const comic = candidates[i];
      const prefix = `[${i + 1}/${candidates.length}]`;
      btn.innerHTML = `<span class="material-icons-round spin">sync</span> ${prefix} ${this._shortTitle(comic.title)}...`;

      try {
        const result = await this._runUpdate(comic, {
          onStage: (stage, pct) => {
            if (stage === 'download') {
              btn.innerHTML = `<span class="material-icons-round spin">sync</span> ${prefix} Tải ${pct ?? 0}%`;
            }
          },
        });

        if (result.status === 'updated') {
          updated++;
          totalNew += result.newCount;
        } else if (result.status === 'up-to-date') {
          upToDate++;
        }
      } catch (err) {
        failed++;
        console.error(`[UpdateAll] ${comic.title}:`, err);
        App.showToast(`Lỗi "${this._shortTitle(comic.title)}": ${err.message}`, 'error');
      }
    }

    btn.disabled = false;
    btn.innerHTML = originalText;

    App.showToast(
      `Hoàn tất: ${updated} truyện +${totalNew} tập • ${upToDate} đã mới • ${failed} lỗi`,
      failed > 0 ? 'warning' : 'success'
    );
  },

  _shortTitle(title) {
    if (!title) return '';
    return title.length > 30 ? title.slice(0, 30) + '…' : title;
  },

  async loadComics() {
    this.comics = await window.appDB.getAllComics();
    this.renderGrid();
    this.updateStats();
  },

  updateStats() {
    const totalChapters = this.comics.reduce((sum, c) => sum + (c.chapters?.length || 0), 0);
    const totalImages = this.comics.reduce((sum, c) => {
      return sum + (c.chapters?.reduce((s, ch) => s + (ch.images?.length || 0), 0) || 0);
    }, 0);

    document.getElementById('lib-stat-comics').textContent = this.comics.length;
    document.getElementById('lib-stat-chapters').textContent = totalChapters;
    document.getElementById('lib-stat-images').textContent = totalImages;
  },

  getFilteredComics() {
    const search = document.getElementById('lib-search-input').value.trim().toLowerCase();
    let filtered = this.comics;
    if (search) {
      filtered = this.comics.filter(c =>
        c.title.toLowerCase().includes(search) ||
        (c.genres || []).some(g => g.toLowerCase().includes(search))
      );
    }
    return filtered.sort((a, b) => {
      if (a.isStarred && !b.isStarred) return -1;
      if (!a.isStarred && b.isStarred) return 1;
      return new Date(b.savedAt) - new Date(a.savedAt);
    });
  },

  renderGrid() {
    const filtered = this.getFilteredComics();
    const totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
    this.currentPage = Math.min(this.currentPage, totalPages);

    const start = (this.currentPage - 1) * this.pageSize;
    const pageComics = filtered.slice(start, start + this.pageSize);

    const grid = document.getElementById('lib-grid');
    const empty = document.getElementById('lib-empty');

    if (filtered.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      document.getElementById('lib-pagination').innerHTML = '';
      return;
    }

    empty.classList.add('hidden');

    grid.innerHTML = pageComics.map(comic => {
      const totalCh = comic.chapters?.length || 0;
      const lastRead = comic.lastReadChapter !== undefined ? comic.lastReadChapter + 1 : 0;
      const progressPct = totalCh > 0 ? Math.round((lastRead / totalCh) * 100) : 0;
      const coverUrl = comic.cover
        ? AppConfig.rewriteUrl(`/api/proxy-image?url=${encodeURIComponent(comic.cover)}`)
        : '';

      return `
        <div class="lib-card" data-id="${comic.id}" title="${comic.title}">
          <div class="lib-card-cover">
            ${coverUrl
              ? `<img src="${coverUrl}" alt="${comic.title}" loading="lazy">`
              : `<div class="lib-card-placeholder"><span class="material-icons-round">menu_book</span></div>`
            }
            <div class="lib-card-badge">${totalCh} ch</div>
            ${progressPct > 0 ? `<div class="lib-card-progress"><div class="lib-card-progress-fill" style="width:${progressPct}%"></div></div>` : ''}
            <div class="lib-card-overlay">
              <button class="lib-card-action lib-action-star" title="Gắn sao / Bỏ sao">
                <span class="material-icons-round" style="${comic.isStarred ? 'color: gold;' : ''}">${comic.isStarred ? 'star' : 'star_border'}</span>
              </button>

              <button class="lib-card-action lib-action-detail" title="Chi tiết">
                <span class="material-icons-round">info</span>
              </button>
              <button class="lib-card-action lib-action-delete" title="Xóa">
                <span class="material-icons-round">delete</span>
              </button>
            </div>
          </div>
          <div class="lib-card-info">
            <div class="lib-card-title">${comic.title}</div>
            <div class="lib-card-meta">
              ${comic.status ? `<span>${comic.status}</span>` : ''}
              <span>${new Date(comic.savedAt).toLocaleDateString('vi-VN')}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind card actions
    grid.querySelectorAll('.lib-card').forEach(card => {
      const id = card.dataset.id;

      card.querySelector('.lib-action-star').addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleStar(id);
      });



      card.querySelector('.lib-action-detail').addEventListener('click', (e) => {
        e.stopPropagation();
        this.showDetail(id);
      });

      card.querySelector('.lib-action-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteComic(id);
      });

      // Double click to read
      card.addEventListener('dblclick', () => this.readComic(id));
      // Single click to detail
      card.addEventListener('click', () => this.showDetail(id));
    });

    // Pagination
    this.renderPagination(filtered.length, totalPages);
  },

  renderPagination(totalItems, totalPages) {
    const container = document.getElementById('lib-pagination');

    if (totalPages <= 1) {
      container.innerHTML = `<span class="pagination-info">${totalItems} truyện</span>`;
      return;
    }

    let html = '';

    // Prev button
    html += `<button class="page-btn ${this.currentPage === 1 ? 'disabled' : ''}" data-page="${this.currentPage - 1}" ${this.currentPage === 1 ? 'disabled' : ''}>
      <span class="material-icons-round">chevron_left</span>
    </button>`;

    // Page numbers
    const maxVisible = 5;
    let startPage = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
      html += `<button class="page-btn" data-page="1">1</button>`;
      if (startPage > 2) html += `<span class="page-ellipsis">…</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="page-btn ${i === this.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) html += `<span class="page-ellipsis">…</span>`;
      html += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    // Next button
    html += `<button class="page-btn ${this.currentPage === totalPages ? 'disabled' : ''}" data-page="${this.currentPage + 1}" ${this.currentPage === totalPages ? 'disabled' : ''}>
      <span class="material-icons-round">chevron_right</span>
    </button>`;

    html += `<span class="pagination-info">${totalItems} truyện</span>`;

    container.innerHTML = html;

    // Bind pagination buttons
    container.querySelectorAll('.page-btn:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentPage = parseInt(btn.dataset.page);
        this.renderGrid();
        // Scroll to top of grid
        document.getElementById('lib-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  },

  showDetail(id) {
    const comic = this.comics.find(c => c.id === id);
    if (!comic) return;

    this.selectedComic = comic;

    document.getElementById('lib-grid-view').classList.add('hidden');
    document.getElementById('lib-detail-view').classList.remove('hidden');

    // Cover
    const coverEl = document.getElementById('lib-detail-cover');
    if (comic.cover) {
      coverEl.innerHTML = `<img src="${AppConfig.rewriteUrl('/api/proxy-image?url=' + encodeURIComponent(comic.cover))}" alt="${comic.title}">`;
    } else {
      coverEl.innerHTML = `<div class="lib-card-placeholder"><span class="material-icons-round">menu_book</span></div>`;
    }

    document.getElementById('lib-detail-title').textContent = comic.title;
    document.getElementById('lib-detail-status').textContent = comic.status || '';
    document.getElementById('lib-detail-chapters-count').textContent = `${comic.chapters?.length || 0} chapters`;

    // Genres
    const genresEl = document.getElementById('lib-detail-genres');
    genresEl.innerHTML = (comic.genres || []).map(g => `<span class="genre-tag">${g}</span>`).join('');

    // Star Button
    const starBtn = document.getElementById('lib-star-detail-btn');
    starBtn.innerHTML = `<span class="material-icons-round" style="${comic.isStarred ? 'color: gold;' : ''}">${comic.isStarred ? 'star' : 'star_border'}</span>`;

    // Description
    document.getElementById('lib-detail-desc').textContent = comic.description || 'Không có mô tả';

    // Saved date
    document.getElementById('lib-detail-date').textContent = `Lưu: ${new Date(comic.savedAt).toLocaleDateString('vi-VN')}`;

    // Read actions text
    const lastReadText = document.getElementById('lib-detail-last-read');
    if (comic.lastReadChapter !== undefined && comic.chapters[comic.lastReadChapter]) {
      lastReadText.textContent = `(${comic.chapters[comic.lastReadChapter].chapter})`;
    } else {
      lastReadText.textContent = '';
    }

    // Auto delete old chapters toggle
    const autoDeleteCheck = document.getElementById('lib-auto-delete-old');
    autoDeleteCheck.checked = !!comic.autoDeleteOldChapters;
    autoDeleteCheck.onchange = async (e) => {
      comic.autoDeleteOldChapters = e.target.checked;
      await window.appDB.saveComic(comic);
      App.showToast(e.target.checked ? 'Đã bật tự động xóa chap cũ' : 'Đã tắt tự động xóa chap cũ', 'info');
    };

    // Extract numbers to determine read status and newest-first order
    let displayChapters = (comic.chapters || []).map((ch, i) => {
      const numMatch = ch.chapter.match(/[\d.,]+/);
      const num = numMatch ? parseFloat(numMatch[0]) : 0;
      return { ch, index: i, num };
    });

    // Ensure newest first (largest num at top)
    if (displayChapters.length > 1) {
      if (displayChapters[0].num < displayChapters[displayChapters.length - 1].num) {
        displayChapters.reverse();
      }
    }

    let lastReadNum = -1;
    if (comic.lastReadChapter !== undefined && comic.chapters[comic.lastReadChapter]) {
      const numMatch = comic.chapters[comic.lastReadChapter].chapter.match(/[\d.,]+/);
      lastReadNum = numMatch ? parseFloat(numMatch[0]) : -1;
    }

    // Chapter list
    const chList = document.getElementById('lib-detail-chapters');
    chList.innerHTML = displayChapters.map((item) => {
      const isRead = lastReadNum !== -1 && item.num <= lastReadNum;
      
      return `
        <div class="lib-ch-item ${isRead ? 'read' : ''}" data-index="${item.index}">
          <span class="lib-ch-name">${item.ch.chapter}</span>
          <span class="lib-ch-images">${item.ch.images?.length || 0} ảnh</span>
          <button class="lib-ch-read-btn" title="Đọc chapter này">
            <span class="material-icons-round">play_arrow</span>
          </button>
        </div>
      `;
    }).join('');

    // Bind chapter read buttons
    chList.querySelectorAll('.lib-ch-item').forEach(item => {
      const idx = parseInt(item.dataset.index);
      item.querySelector('.lib-ch-read-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.readFromChapter(comic, idx);
      });
      item.addEventListener('click', () => this.readFromChapter(comic, idx));
    });
  },

  showGrid() {
    document.getElementById('lib-detail-view').classList.add('hidden');
    document.getElementById('lib-grid-view').classList.remove('hidden');
    this.selectedComic = null;
  },

  readComic(id) {
    const comic = this.comics.find(c => c.id === id);
    if (!comic || !comic.chapters?.length) {
      App.showToast('Truyện không có dữ liệu chapter', 'warning');
      return;
    }
    const startCh = comic.lastReadChapter || 0;
    this.readFromChapter(comic, startCh);
  },

  readFromChapter(comic, chapterIndex) {
    if (!comic.chapters?.length) return;

    // Update read progress
    window.appDB.updateComicReadProgress(comic.id, chapterIndex);
    comic.lastReadChapter = chapterIndex;
    comic.lastReadAt = new Date().toISOString();

    ComicReader.openFromCrawlResults(comic.chapters, chapterIndex, comic.id);
  },

  async deleteComic(id) {
    const comic = this.comics.find(c => c.id === id);
    if (!comic) return;

    App.confirm(`Xóa "${comic.title}" khỏi thư viện?`, async () => {
      await window.appDB.deleteComic(id);
      this.comics = this.comics.filter(c => c.id !== id);
      this.renderGrid();
      this.updateStats();

      if (this.selectedComic?.id === id) {
        this.showGrid();
      }

      App.showToast(`Đã xóa "${comic.title}"`, 'info');
    });
  },

  async toggleStar(id) {
    const comic = this.comics.find(c => c.id === id);
    if (!comic) return;
    
    comic.isStarred = !comic.isStarred;
    await window.appDB.saveComic(comic);
    App.showToast(comic.isStarred ? 'Đã gắn sao truyện' : 'Đã bỏ sao', 'success');
    
    this.renderGrid();
    if (this.selectedComic && this.selectedComic.id === id) {
      this.showDetail(id);
    }
  },

  // Called from ComicCrawler after crawl completes
  async saveFromCrawlResults(comicInfo, chaptersData) {
    const id = comicInfo.url || `comic_${Date.now()}`;
    const newChapters = chaptersData.filter(ch => ch.images && ch.images.length > 0);

    const existingComic = await window.appDB.getComic(id);

    let mergedChapters = newChapters;
    let lastReadChapter = undefined;
    let lastReadAt = undefined;

    if (existingComic) {
      lastReadChapter = existingComic.lastReadChapter;
      lastReadAt = existingComic.lastReadAt;

      const chapterMap = new Map();
      (existingComic.chapters || []).forEach(ch => chapterMap.set(ch.url, ch));
      newChapters.forEach(ch => chapterMap.set(ch.url, ch));

      // Re-order based on original info from crawler
      const usedUrls = new Set();
      mergedChapters = (comicInfo.chapters || [])
           .map(ch => {
             const m = chapterMap.get(ch.url);
             if (m) usedUrls.add(ch.url);
             return m;
           })
           .filter(Boolean);

      // Preserve any existing/new chapters whose URL didn't appear in the
      // latest scan (source URL scheme changes, tcomic id shift, etc.).
      // Without this, re-ordering would silently drop all previously saved
      // chapters when URLs no longer match.
      const leftover = [];
      chapterMap.forEach((ch, url) => {
        if (!usedUrls.has(url)) leftover.push(ch);
      });
      if (leftover.length) {
        mergedChapters = [...leftover, ...mergedChapters];
      }

      // Fallback if comicInfo.chapters is missing
      if (mergedChapters.length === 0) {
         mergedChapters = Array.from(chapterMap.values());
      }
      
      // Feature: Keep max 10 read chapters
      if (existingComic.autoDeleteOldChapters && lastReadChapter !== undefined && mergedChapters[lastReadChapter]) {
        // Find numerical values and actual index mappings
        let sortedDesc = mergedChapters.map((ch, i) => {
          const numMatch = ch.chapter.match(/[\d.,]+/);
          return { originalIndex: i, num: numMatch ? parseFloat(numMatch[0]) : 0 };
        }).sort((a, b) => b.num - a.num); // newest first

        // Find the last read chapter in this sorted list
        const lastReadItem = sortedDesc.find(item => item.originalIndex === lastReadChapter);
        
        if (lastReadItem) {
          const lastReadSortedIndex = sortedDesc.indexOf(lastReadItem);
          const keepCount = 10;
          
          sortedDesc.forEach((item, sortedIdx) => {
            // sortedIdx > lastReadSortedIndex + keepCount means it's older than the last read chapter by > 10 chapters
            if (sortedIdx > lastReadSortedIndex + keepCount) {
              if (mergedChapters[item.originalIndex]) {
                mergedChapters[item.originalIndex].images = [];
              }
            }
          });
        }
      }
    }

    const comic = {
      id,
      title: comicInfo.title,
      cover: comicInfo.cover || existingComic?.cover || '',
      status: comicInfo.status || existingComic?.status || '',
      genres: comicInfo.genres || existingComic?.genres || [],
      description: comicInfo.description || existingComic?.description || '',
      url: comicInfo.url,
      chapters: mergedChapters,
      savedAt: existingComic?.savedAt || new Date().toISOString(),
      isStarred: existingComic?.isStarred || false,
      autoDeleteOldChapters: existingComic?.autoDeleteOldChapters || false,
      lastReadChapter,
      lastReadAt
    };

    await window.appDB.saveComic(comic);
    await this.loadComics();
    App.showToast(`Đã lưu "${comic.title}" vào thư viện`, 'success');
  },
};

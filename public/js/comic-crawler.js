/**
 * Comic Crawler Module
 */
const ComicCrawler = {
  currentComicInfo: null,
  currentJobId: null,
  pollingInterval: null,

  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Scan button
    document.getElementById('btn-scan').addEventListener('click', () => this.scanComic());

    // Enter key on URL input
    document.getElementById('comic-url').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.scanComic();
    });

    // Crawl mode toggle
    document.querySelectorAll('input[name="crawl-mode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const storageOption = document.getElementById('storage-option');
        if (e.target.value === 'download') {
          storageOption.classList.remove('hidden');
        } else {
          storageOption.classList.add('hidden');
        }
      });
    });

    // Select all button
    document.getElementById('btn-select-all').addEventListener('click', () => this.toggleSelectAll());

    // Select range
    document.getElementById('btn-select-range').addEventListener('click', () => this.selectRange());

    // Start crawl
    document.getElementById('btn-start-crawl').addEventListener('click', () => this.startCrawl());

    // Copy links
    document.getElementById('btn-copy-links').addEventListener('click', () => this.copyAllLinks());

    // Export JSON
    document.getElementById('btn-export-json').addEventListener('click', () => this.exportJSON());
  },

  async scanComic() {
    const url = document.getElementById('comic-url').value.trim();
    if (!url) {
      App.showToast('Vui lòng nhập URL truyện', 'warning');
      return;
    }

    // Validate URL
    if (!url.includes('toptruyens') && !url.includes('truyen-tranh')) {
      App.showToast('URL không hợp lệ. Vui lòng nhập link từ TopTruyen', 'error');
      return;
    }

    const btn = document.getElementById('btn-scan');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-round spin">sync</span><span>Đang quét...</span>';

    try {
      const response = await fetch('/api/crawl/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Scan failed');
      }

      this.currentComicInfo = data.data;
      this.renderComicInfo(data.data);
      App.showToast(`Tìm thấy ${data.data.totalChapters} chapters`, 'success');
    } catch (err) {
      App.showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-round">search</span><span>Quét</span>';
    }
  },

  renderComicInfo(info) {
    const card = document.getElementById('comic-info-card');
    card.classList.remove('hidden');

    // Cover image via proxy
    const coverImg = document.getElementById('comic-cover');
    if (info.cover) {
      coverImg.src = AppConfig.rewriteUrl(`/api/proxy-image?url=${encodeURIComponent(info.cover)}`);
    } else {
      coverImg.src = '';
    }

    document.getElementById('comic-title').textContent = info.title;
    document.getElementById('comic-alt-name').textContent = info.altName || '';
    document.getElementById('comic-status').textContent = info.status;
    document.getElementById('comic-chapter-count').textContent = `${info.totalChapters} chapters`;

    // Genres
    const genresDiv = document.getElementById('comic-genres');
    genresDiv.innerHTML = info.genres.map(g =>
      `<span class="genre-tag">${g}</span>`
    ).join('');

    // Description and URL for quick edit
    const descInput = document.getElementById('comic-desc-input');
    if (descInput) descInput.value = info.description || '';

    const urlInput = document.getElementById('comic-source-url');
    if (urlInput) {
      urlInput.value = info.url || document.getElementById('comic-url').value;
    }

    // Chapter list
    this.renderChapterList(info.chapters);
  },

  renderChapterList(chapters) {
    const list = document.getElementById('chapter-list');
    list.innerHTML = chapters.map((ch, i) => `
      <div class="chapter-item" data-url="${ch.url}">
        <input type="checkbox" id="ch-${i}" checked>
        <label class="chapter-name" for="ch-${i}">${ch.title}</label>
      </div>
    `).join('');
  },

  toggleSelectAll() {
    const checkboxes = document.querySelectorAll('#chapter-list input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);

    const btnText = document.getElementById('btn-select-all-text');
    if (btnText) {
      btnText.textContent = allChecked ? 'Chọn tất cả' : 'Bỏ chọn tất cả';
    }
  },

  selectRange() {
    const inputFrom = document.getElementById('input-range-from');
    const fromVal = parseFloat(inputFrom.value);
    
    if (isNaN(fromVal)) {
      App.showToast('Vui lòng nhập số chapter bắt đầu', 'warning');
      return;
    }

    if (!document.getElementById('chapter-list').innerHTML.trim()) return;

    const chapterItems = document.querySelectorAll('#chapter-list .chapter-item');
    let matchedCount = 0;

    chapterItems.forEach(item => {
      const label = item.querySelector('.chapter-name').textContent;
      const cb = item.querySelector('input[type="checkbox"]');
      
      const numMatch = label.match(/[\d.,]+/);
      const num = numMatch ? parseFloat(numMatch[0]) : -1;
      
      if (num >= fromVal) {
        cb.checked = true;
        matchedCount++;
      } else {
        cb.checked = false;
      }
    });

    App.showToast(`Đã tự động chọn ${matchedCount} chap (từ chap ${fromVal} trở lên)`, 'success');
  },

  async startCrawl() {
    if (!this.currentComicInfo) {
      App.showToast('Vui lòng quét truyện trước', 'warning');
      return;
    }

    // Get selected chapters
    const selectedUrls = [];
    document.querySelectorAll('#chapter-list .chapter-item').forEach(item => {
      const cb = item.querySelector('input[type="checkbox"]');
      if (cb.checked) {
        selectedUrls.push(item.dataset.url);
      }
    });

    if (selectedUrls.length === 0) {
      App.showToast('Vui lòng chọn ít nhất 1 chapter', 'warning');
      return;
    }

    const mode = document.querySelector('input[name="crawl-mode"]:checked').value;
    const endpoint = mode === 'download' ? '/api/crawl/download' : '/api/crawl/links';

    // Show progress
    document.getElementById('crawl-progress-card').classList.remove('hidden');
    document.getElementById('crawl-results-card').classList.add('hidden');
    document.getElementById('btn-start-crawl').disabled = true;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: this.currentComicInfo.url,
          chapters: selectedUrls,
          comicTitle: this.currentComicInfo.title,
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      this.currentJobId = data.jobId;
      this.startProgressPolling();
    } catch (err) {
      App.showToast(`Lỗi: ${err.message}`, 'error');
      document.getElementById('crawl-progress-card').classList.add('hidden');
      document.getElementById('btn-start-crawl').disabled = false;
    }
  },

  startProgressPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);

    this.pollingInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/crawl/status/${this.currentJobId}`);
        const job = await response.json();

        this.updateProgress(job);

        if (job.status === 'done') {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
          this.onCrawlComplete(job);
        } else if (job.status === 'error') {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
          App.showToast(`Lỗi crawl: ${job.error}`, 'error');
          document.getElementById('crawl-progress-card').classList.add('hidden');
          document.getElementById('btn-start-crawl').disabled = false;
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 1500);
  },

  updateProgress(job) {
    const { progress } = job;
    const pct = progress.total > 0 ? (progress.current / progress.total * 100) : 0;

    document.getElementById('progress-bar').style.width = `${pct}%`;
    document.getElementById('progress-text').textContent = `${progress.current}/${progress.total}`;
    document.getElementById('progress-chapter').textContent = progress.chapter;

    if (job.type === 'download' && progress.page) {
      document.getElementById('progress-detail').textContent =
        `Trang ${progress.page}/${progress.totalPages}`;
    }

    // Update chapter status in list
    const chapters = document.querySelectorAll('#chapter-list .chapter-item');
    for (let i = 0; i < Math.min(progress.current, chapters.length); i++) {
      const existing = chapters[i].querySelector('.chapter-status');
      if (!existing) {
        const badge = document.createElement('span');
        badge.className = 'chapter-status done';
        badge.textContent = '✓';
        chapters[i].appendChild(badge);
      }
    }
  },

  async onCrawlComplete(job) {
    const mode = document.querySelector('input[name="crawl-mode"]:checked').value;

    document.getElementById('crawl-progress-card').classList.add('hidden');
    document.getElementById('btn-start-crawl').disabled = false;

    // Store results
    this.crawlResults = job.results;

    // Show results
    document.getElementById('crawl-results-card').classList.remove('hidden');

    if (mode === 'links' && job.results.chaptersData) {
      const totalImages = job.results.chaptersData.reduce((sum, ch) => sum + ch.imageCount, 0);
      document.getElementById('results-summary').innerHTML = `
        <strong>${job.results.title}</strong><br>
        Đã crawl ${job.results.chaptersData.length} chapters, tổng ${totalImages} ảnh
      `;

      document.getElementById('results-list').innerHTML = job.results.chaptersData.map((ch, i) => `
        <div class="result-item">
          <div class="result-chapter">${ch.chapter}</div>
          <div class="result-images">${ch.imageCount} ảnh ${ch.error ? `<span style="color:var(--danger)">- ${ch.error}</span>` : ''}</div>
          ${ch.imageCount > 0 ? `<button class="btn btn-sm btn-read-chapter" data-index="${i}" title="Đọc chapter này">
            <span class="material-icons-round">auto_stories</span>
          </button>` : ''}
        </div>
      `).join('');

      // Show read-all button
      document.getElementById('btn-read-all').style.display = '';

      // Bind read buttons
      document.querySelectorAll('.btn-read-chapter').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.currentTarget.dataset.index);
          ComicReader.openFromCrawlResults(job.results.chaptersData, idx);
        });
      });
    } else if (mode === 'download' && job.results.chaptersDownloaded) {
      const total = job.results.chaptersDownloaded.reduce((sum, ch) => sum + (ch.downloaded || 0), 0);
      document.getElementById('results-summary').innerHTML = `
        <strong>${job.results.comicTitle}</strong><br>
        Đã download ${total} ảnh vào: <code>${job.results.downloadDir}</code>
      `;

      document.getElementById('results-list').innerHTML = job.results.chaptersDownloaded.map(ch => `
        <div class="result-item">
          <div class="result-chapter">${ch.chapter}</div>
          <div class="result-images">
            ${ch.downloaded || 0} tải / ${ch.skipped || 0} bỏ qua / ${ch.failed || 0} lỗi
          </div>
        </div>
      `).join('');
    }

    // Save to history
    await window.appDB.addCrawlHistory({
      title: job.results?.title || job.results?.comicTitle || 'Unknown',
      url: document.getElementById('comic-source-url')?.value || this.currentComicInfo?.url,
      mode: mode,
      chapters: job.progress?.total || 0,
      date: new Date().toISOString(),
    });

    // Auto-save to library
    if (mode === 'links' && job.results.chaptersData && this.currentComicInfo) {
      // Pull edited values
      this.currentComicInfo.description = document.getElementById('comic-desc-input')?.value || this.currentComicInfo.description;
      this.currentComicInfo.url = document.getElementById('comic-source-url')?.value || this.currentComicInfo.url;
      
      await ComicLibrary.saveFromCrawlResults(this.currentComicInfo, job.results.chaptersData);
    }

    this.loadHistory();
    App.showToast('Crawl hoàn tất!', 'success');

    // Clean up job on server
    fetch(`/api/crawl/job/${this.currentJobId}`, { method: 'DELETE' });
  },

  copyAllLinks() {
    if (!this.crawlResults?.chaptersData) {
      App.showToast('Không có dữ liệu để copy', 'warning');
      return;
    }

    let text = '';
    this.crawlResults.chaptersData.forEach(ch => {
      text += `=== ${ch.chapter} ===\n`;
      ch.images.forEach(img => {
        text += img + '\n';
      });
      text += '\n';
    });

    navigator.clipboard.writeText(text).then(() => {
      App.showToast('Đã copy tất cả links!', 'success');
    }).catch(() => {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      App.showToast('Đã copy tất cả links!', 'success');
    });
  },

  exportJSON() {
    if (!this.crawlResults) {
      App.showToast('Không có dữ liệu để xuất', 'warning');
      return;
    }

    const json = JSON.stringify(this.crawlResults, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.crawlResults.title || 'crawl'}_data.json`;
    a.click();
    URL.revokeObjectURL(url);
    App.showToast('Đã xuất file JSON', 'success');
  },

  async loadHistory() {
    const history = await window.appDB.getCrawlHistory();
    const container = document.getElementById('crawl-history');

    if (history.length === 0) {
      container.innerHTML = '<p class="empty-state">Chưa có lịch sử crawl nào</p>';
      return;
    }

    container.innerHTML = history.slice(0, 20).map(item => `
      <div class="history-item" data-url="${item.url || ''}">
        <div class="history-item-icon">
          <span class="material-icons-round">${item.mode === 'download' ? 'download' : 'link'}</span>
        </div>
        <div class="history-item-info">
          <div class="history-item-title">${item.title}</div>
          <div class="history-item-meta">${item.chapters} chapters • ${new Date(item.date).toLocaleDateString('vi-VN')}</div>
        </div>
      </div>
    `).join('');

    // Click to re-scan
    container.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        const url = item.dataset.url;
        if (url) {
          document.getElementById('comic-url').value = url;
          this.scanComic();
        }
      });
    });
  }
};

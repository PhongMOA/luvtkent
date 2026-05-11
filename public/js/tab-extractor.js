/**
 * Tab Extractor - Auto-detect and crop tablature from YouTube videos
 * Supports: auto-detect, manual region selection, timestamps
 */
const TabExtractor = {
  currentJobId: null,
  currentResult: null,
  pollTimer: null,

  // Manual region selection state
  previewJobId: null,
  previewData: null,
  selectedRegion: null,
  isDragging: false,
  dragStart: null,

  init() {
    this.bindEvents();
    this.checkDependencies();
  },

  bindEvents() {
    const previewBtn = document.getElementById('tab-preview-btn');
    const extractBtn = document.getElementById('tab-extract-btn');
    const cropExtractBtn = document.getElementById('tab-crop-extract-btn');
    const downloadBtn = document.getElementById('tab-download-btn');
    const saveBtn = document.getElementById('tab-save-btn');
    const clearBtn = document.getElementById('tab-clear-btn');
    const urlInput = document.getElementById('tab-youtube-url');

    if (previewBtn) {
      previewBtn.addEventListener('click', () => this.startPreview());
    }
    if (extractBtn) {
      extractBtn.addEventListener('click', () => this.startExtraction());
    }
    if (cropExtractBtn) {
      cropExtractBtn.addEventListener('click', () => this.startCropExtraction());
    }
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => this.downloadImage());
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveToLibrary());
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearResult());
    }
    if (urlInput) {
      urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.startPreview();
      });
    }

    // Canvas region selection events
    this.setupCanvasEvents();
  },

  setupCanvasEvents() {
    const container = document.getElementById('tab-preview-container');
    if (!container) return;

    const getPos = (e) => {
      const rect = container.getBoundingClientRect();
      const touch = e.touches ? e.touches[0] : e;
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
        containerW: rect.width,
        containerH: rect.height,
      };
    };

    const onStart = (e) => {
      e.preventDefault();
      const pos = getPos(e);
      this.isDragging = true;
      this.dragStart = pos;
      this.selectedRegion = null;
      this.drawCanvas(null);
    };

    const onMove = (e) => {
      if (!this.isDragging || !this.dragStart) return;
      e.preventDefault();
      const pos = getPos(e);
      const rect = {
        x: Math.min(this.dragStart.x, pos.x),
        y: Math.min(this.dragStart.y, pos.y),
        w: Math.abs(pos.x - this.dragStart.x),
        h: Math.abs(pos.y - this.dragStart.y),
        containerW: pos.containerW,
        containerH: pos.containerH,
      };
      this.drawCanvas(rect);
    };

    const onEnd = (e) => {
      if (!this.isDragging || !this.dragStart) return;
      this.isDragging = false;

      const pos = e.changedTouches ?
        { x: e.changedTouches[0].clientX - container.getBoundingClientRect().left,
          y: e.changedTouches[0].clientY - container.getBoundingClientRect().top,
          containerW: container.getBoundingClientRect().width,
          containerH: container.getBoundingClientRect().height } :
        { x: e.clientX - container.getBoundingClientRect().left,
          y: e.clientY - container.getBoundingClientRect().top,
          containerW: container.getBoundingClientRect().width,
          containerH: container.getBoundingClientRect().height };

      const rect = {
        x: Math.min(this.dragStart.x, pos.x),
        y: Math.min(this.dragStart.y, pos.y),
        w: Math.abs(pos.x - this.dragStart.x),
        h: Math.abs(pos.y - this.dragStart.y),
        containerW: pos.containerW,
        containerH: pos.containerH,
      };

      // Ignore tiny selections (accidental clicks)
      if (rect.w < 20 || rect.h < 10) {
        this.selectedRegion = null;
        this.drawCanvas(null);
        this.updateCropButton();
        return;
      }

      this.selectedRegion = rect;
      this.drawCanvas(rect);
      this.updateCropButton();
    };

    container.addEventListener('mousedown', onStart);
    container.addEventListener('mousemove', onMove);
    container.addEventListener('mouseup', onEnd);
    container.addEventListener('mouseleave', onEnd);

    container.addEventListener('touchstart', onStart, { passive: false });
    container.addEventListener('touchmove', onMove, { passive: false });
    container.addEventListener('touchend', onEnd);
  },

  drawCanvas(rect) {
    const canvas = document.getElementById('tab-preview-canvas');
    const img = document.getElementById('tab-preview-image');
    if (!canvas || !img) return;

    const container = document.getElementById('tab-preview-container');
    const cRect = container.getBoundingClientRect();
    canvas.width = cRect.width;
    canvas.height = cRect.height;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!rect) return;

    // Draw semi-transparent overlay outside selection
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clear the selected region (show original image)
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h);

    // Draw selection border
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    // Draw corner handles
    ctx.setLineDash([]);
    ctx.fillStyle = '#3b82f6';
    const handleSize = 6;
    const corners = [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
    ];
    corners.forEach(([cx, cy]) => {
      ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
    });

    // Show dimensions text
    const infoEl = document.getElementById('tab-region-info');
    if (infoEl && this.previewData) {
      const scaleX = this.previewData.width / rect.containerW;
      const scaleY = this.previewData.height / rect.containerH;
      const realW = Math.round(rect.w * scaleX);
      const realH = Math.round(rect.h * scaleY);
      infoEl.textContent = `Vùng chọn: ${realW} x ${realH}px`;
    }
  },

  updateCropButton() {
    const btn = document.getElementById('tab-crop-extract-btn');
    if (btn) {
      btn.disabled = !this.selectedRegion;
    }
  },

  async checkDependencies() {
    try {
      const apiBase = typeof AppConfig !== 'undefined' ? AppConfig.getApiBase() : '';
      const res = await fetch(`${apiBase}/api/tab/check`);
      const data = await res.json();

      const warning = document.getElementById('tab-deps-warning');
      const btn = document.getElementById('tab-extract-btn');
      const previewBtn = document.getElementById('tab-preview-btn');

      if (!data.dependencies.ytdlp || !data.dependencies.ffmpeg) {
        const missing = [];
        if (!data.dependencies.ytdlp) missing.push('yt-dlp');
        if (!data.dependencies.ffmpeg) missing.push('ffmpeg');

        if (warning) {
          document.getElementById('tab-deps-text').textContent =
            `Cần cài đặt ${missing.join(' và ')} để sử dụng tính năng này.`;
          warning.classList.remove('hidden');
        }
        if (btn) btn.disabled = true;
        if (previewBtn) previewBtn.disabled = true;
      }
    } catch (_) {}
  },

  // ========================
  // PREVIEW FLOW (manual region)
  // ========================

  async startPreview() {
    const urlInput = document.getElementById('tab-youtube-url');
    const url = urlInput ? urlInput.value.trim() : '';

    if (!url) {
      App.showToast('Vui lòng nhập URL YouTube', 'warning');
      return;
    }

    if (!/youtube\.com\/watch|youtu\.be\//i.test(url)) {
      App.showToast('Chỉ hỗ trợ URL YouTube', 'warning');
      return;
    }

    this.showProgress(true);
    this.hideError();
    this.hideResult();
    this.hidePreview();
    this.setExtracting(true);

    try {
      const apiBase = typeof AppConfig !== 'undefined' ? AppConfig.getApiBase() : '';
      const res = await fetch(`${apiBase}/api/tab/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Lỗi không xác định');
      }

      this.previewJobId = data.jobId;
      this.currentJobId = data.jobId;
      this.startPolling('preview');
    } catch (err) {
      this.showError(err.message);
      this.showProgress(false);
      this.setExtracting(false);
    }
  },

  // ========================
  // AUTO-DETECT FLOW (original)
  // ========================

  async startExtraction() {
    const urlInput = document.getElementById('tab-youtube-url');
    const url = urlInput ? urlInput.value.trim() : '';

    if (!url) {
      App.showToast('Vui lòng nhập URL YouTube', 'warning');
      return;
    }

    if (!/youtube\.com\/watch|youtu\.be\//i.test(url)) {
      App.showToast('Chỉ hỗ trợ URL YouTube', 'warning');
      return;
    }

    const timestamps = this.parseTimestamps();

    this.showProgress(true);
    this.hideError();
    this.hideResult();
    this.hidePreview();
    this.setExtracting(true);

    try {
      const apiBase = typeof AppConfig !== 'undefined' ? AppConfig.getApiBase() : '';
      const body = { url };
      if (timestamps) body.timestamps = timestamps;
      const sensitivity = document.getElementById('tab-sensitivity')?.value;
      if (sensitivity && sensitivity !== 'normal') body.sensitivity = sensitivity;

      const res = await fetch(`${apiBase}/api/tab/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Lỗi không xác định');
      }

      this.currentJobId = data.jobId;
      this.startPolling('extract');
    } catch (err) {
      this.showError(err.message);
      this.showProgress(false);
      this.setExtracting(false);
    }
  },

  // ========================
  // CROP + EXTRACT FLOW (manual region)
  // ========================

  async startCropExtraction() {
    if (!this.selectedRegion || !this.previewJobId || !this.previewData) {
      App.showToast('Vui lòng chọn vùng tab trên ảnh trước', 'warning');
      return;
    }

    const urlInput = document.getElementById('tab-youtube-url');
    const url = urlInput ? urlInput.value.trim() : '';
    if (!url) return;

    const timestamps = this.parseTimestamps();

    // Convert canvas coordinates to actual image coordinates
    const region = {
      left: Math.round(this.selectedRegion.x / this.selectedRegion.containerW * this.previewData.width),
      top: Math.round(this.selectedRegion.y / this.selectedRegion.containerH * this.previewData.height),
      width: Math.round(this.selectedRegion.w / this.selectedRegion.containerW * this.previewData.width),
      height: Math.round(this.selectedRegion.h / this.selectedRegion.containerH * this.previewData.height),
      sourceWidth: this.previewData.width,
      sourceHeight: this.previewData.height,
    };

    this.showProgress(true);
    this.hideError();
    this.hideResult();
    this.hidePreview();
    this.setExtracting(true);

    try {
      const apiBase = typeof AppConfig !== 'undefined' ? AppConfig.getApiBase() : '';
      const body = {
        url,
        region,
        jobId: this.previewJobId,  // reuse job (video already downloaded)
      };
      if (timestamps) body.timestamps = timestamps;
      const sensitivity = document.getElementById('tab-sensitivity')?.value;
      if (sensitivity && sensitivity !== 'normal') body.sensitivity = sensitivity;

      const res = await fetch(`${apiBase}/api/tab/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Lỗi không xác định');
      }

      this.currentJobId = data.jobId;
      this.startPolling('extract');
    } catch (err) {
      this.showError(err.message);
      this.showProgress(false);
      this.setExtracting(false);
    }
  },

  // ========================
  // POLLING
  // ========================

  startPolling(mode) {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this._pollMode = mode;
    this.pollTimer = setInterval(() => this.pollStatus(), 2000);
    this.pollStatus();
  },

  async pollStatus() {
    if (!this.currentJobId) return;

    try {
      const apiBase = typeof AppConfig !== 'undefined' ? AppConfig.getApiBase() : '';
      const res = await fetch(`${apiBase}/api/tab/status/${this.currentJobId}`);
      const job = await res.json();

      if (job.status === 'done') {
        this.stopPolling();
        this.showProgress(false);
        this.setExtracting(false);
        this.currentResult = job.result;
        this.showResult(job.result);
        App.showToast(`Trích xuất thành công! ${job.result.tabCount} tab được phát hiện`, 'success');
      } else if (job.status === 'preview_ready') {
        this.stopPolling();
        this.showProgress(false);
        this.setExtracting(false);
        this.previewData = job.result;
        this.showPreview(job.result);
        App.showToast('Đã tải frame mẫu. Kéo chuột để chọn vùng tab!', 'info');
      } else if (job.status === 'error') {
        this.stopPolling();
        this.showProgress(false);
        this.setExtracting(false);
        this.showError(job.error);
      } else {
        this.updateProgress(job);
      }
    } catch (err) {
      // Network error, keep polling
    }
  },

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },

  // ========================
  // HELPERS
  // ========================

  parseTimestamps() {
    const tsInput = document.getElementById('tab-timestamps');
    const tsText = tsInput ? tsInput.value.trim() : '';
    if (!tsText) return null;

    const timestamps = tsText
      .split(/[\n,]+/)
      .map(t => t.trim())
      .filter(Boolean)
      .map(t => {
        const parts = t.split(':').map(Number);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] || 0;
      })
      .filter(s => s >= 0)
      .sort((a, b) => a - b);

    return timestamps.length > 0 ? timestamps : null;
  },

  updateProgress(job) {
    const textEl = document.getElementById('tab-progress-text');
    const fillEl = document.getElementById('tab-progress-fill');

    if (textEl && job.progress) {
      let text = job.progress.step || 'Đang xử lý...';
      if (job.videoTitle) {
        text = `${job.videoTitle} - ${text}`;
      }
      textEl.textContent = text;
    }

    if (fillEl && job.progress) {
      let percent = 0;
      if (job.status === 'downloading' && job.progress.percent) {
        percent = job.progress.percent * 0.3;
      } else if (job.status === 'extracting') {
        percent = 30 + (job.progress.total ? (job.progress.current / job.progress.total) * 20 : 0);
      } else if (job.status === 'detecting') {
        percent = 50 + (job.progress.total ? (job.progress.current / job.progress.total) * 40 : 0);
      } else if (job.status === 'stitching') {
        percent = 92;
      }
      fillEl.style.width = `${Math.min(percent, 98)}%`;
    }
  },

  showProgress(show) {
    const el = document.getElementById('tab-progress');
    if (el) el.classList.toggle('hidden', !show);
    if (show) {
      const fillEl = document.getElementById('tab-progress-fill');
      if (fillEl) fillEl.style.width = '0%';
    }
  },

  showError(message) {
    const el = document.getElementById('tab-error');
    const textEl = document.getElementById('tab-error-text');
    if (el) el.classList.remove('hidden');
    if (textEl) textEl.textContent = message;
  },

  hideError() {
    const el = document.getElementById('tab-error');
    if (el) el.classList.add('hidden');
  },

  showPreview(data) {
    const el = document.getElementById('tab-preview');
    const imgEl = document.getElementById('tab-preview-image');
    const titleEl = document.getElementById('tab-preview-title');

    if (el) el.classList.remove('hidden');
    if (titleEl) titleEl.textContent = `${data.videoTitle || 'Video'} - Chọn vùng tab`;

    if (imgEl) {
      const apiBase = typeof AppConfig !== 'undefined' ? AppConfig.getApiBase() : '';
      imgEl.src = `${apiBase}${data.previewUrl}`;
      imgEl.onload = () => {
        // Reset canvas size when image loads
        const canvas = document.getElementById('tab-preview-canvas');
        const container = document.getElementById('tab-preview-container');
        if (canvas && container) {
          const rect = container.getBoundingClientRect();
          canvas.width = rect.width;
          canvas.height = rect.height;
        }
      };
    }

    this.selectedRegion = null;
    this.updateCropButton();
  },

  hidePreview() {
    const el = document.getElementById('tab-preview');
    if (el) el.classList.add('hidden');
  },

  showResult(result) {
    const el = document.getElementById('tab-result');
    const titleEl = document.getElementById('tab-result-title');
    const infoEl = document.getElementById('tab-result-info');
    const imgEl = document.getElementById('tab-result-image');

    if (el) el.classList.remove('hidden');
    if (titleEl) titleEl.textContent = result.videoTitle || 'Tab Result';
    if (infoEl) infoEl.textContent = `${result.tabCount} tab | ${result.detectedFrames}/${result.totalFrames} frames`;

    if (imgEl) {
      const apiBase = typeof AppConfig !== 'undefined' ? AppConfig.getApiBase() : '';
      imgEl.src = `${apiBase}${result.imageUrl}`;
    }
  },

  hideResult() {
    const el = document.getElementById('tab-result');
    if (el) el.classList.add('hidden');
  },

  setExtracting(active) {
    const previewBtn = document.getElementById('tab-preview-btn');
    const extractBtn = document.getElementById('tab-extract-btn');
    const cropBtn = document.getElementById('tab-crop-extract-btn');
    const input = document.getElementById('tab-youtube-url');

    if (previewBtn) {
      previewBtn.disabled = active;
      previewBtn.innerHTML = active && this._pollMode === 'preview'
        ? '<span class="material-icons-round tab-spin">sync</span> Đang tải...'
        : '<span class="material-icons-round">visibility</span> Xem trước';
    }
    if (extractBtn) {
      extractBtn.disabled = active;
      extractBtn.innerHTML = active && this._pollMode === 'extract' && !this.selectedRegion
        ? '<span class="material-icons-round tab-spin">sync</span> Đang xử lý...'
        : '<span class="material-icons-round">auto_fix_high</span> Auto detect';
    }
    if (cropBtn) {
      cropBtn.disabled = active;
    }
    if (input) input.disabled = active;
  },

  async downloadImage() {
    if (!this.currentResult) return;

    try {
      const apiBase = typeof AppConfig !== 'undefined' ? AppConfig.getApiBase() : '';
      const res = await fetch(`${apiBase}${this.currentResult.imageUrl}`);
      const blob = await res.blob();

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(this.currentResult.videoTitle || 'tabs').replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')}_tabs.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      App.showToast('Đã tải ảnh tab', 'success');
    } catch (err) {
      App.showToast('Lỗi tải ảnh: ' + err.message, 'error');
    }
  },

  async saveToLibrary() {
    if (!this.currentResult) return;

    try {
      const apiBase = typeof AppConfig !== 'undefined' ? AppConfig.getApiBase() : '';
      const res = await fetch(`${apiBase}${this.currentResult.imageUrl}`);
      const blob = await res.blob();

      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });

      const material = {
        id: 'music_' + Date.now(),
        title: this.currentResult.videoTitle || 'Extracted Tab',
        type: 'tab-image',
        content: base64,
        url: document.getElementById('tab-youtube-url')?.value || '',
        note: `${this.currentResult.tabCount} tabs trích xuất tự động`,
        addedAt: new Date().toISOString(),
      };

      await window.appDB.saveMusic(material);
      App.showToast('Đã lưu vào thư viện Tập Đàn!', 'success');

      if (typeof MusicManager !== 'undefined' && MusicManager.loadMusicList) {
        await MusicManager.loadMusicList();
      }
    } catch (err) {
      App.showToast('Lỗi lưu: ' + err.message, 'error');
    }
  },

  async clearResult() {
    if (this.currentJobId) {
      try {
        const apiBase = typeof AppConfig !== 'undefined' ? AppConfig.getApiBase() : '';
        await fetch(`${apiBase}/api/tab/job/${this.currentJobId}`, { method: 'DELETE' });
      } catch (_) {}
    }

    this.currentJobId = null;
    this.currentResult = null;
    this.previewJobId = null;
    this.previewData = null;
    this.selectedRegion = null;
    this.hideResult();
    this.hideError();
    this.hidePreview();

    const urlInput = document.getElementById('tab-youtube-url');
    if (urlInput) urlInput.value = '';
  },
};

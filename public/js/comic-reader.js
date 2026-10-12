/**
 * Comic Reader Module
 * Full-screen webtoon-style comic reader with lazy loading
 */
const ComicReader = {
  chapters: [],
  currentChapterIndex: 0,
  isOpen: false,

  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Close reader
    document.getElementById('reader-close').addEventListener('click', () => this.close());

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') this.close();
      if (e.key === 'ArrowLeft') this.prevChapter();
      if (e.key === 'ArrowRight') this.nextChapter();
    });

    // Chapter navigation
    document.getElementById('reader-prev-ch').addEventListener('click', () => this.prevChapter());
    document.getElementById('reader-next-ch').addEventListener('click', () => this.nextChapter());

    // Scroll to top button
    const scrollBtn = document.getElementById('reader-scroll-top');
    scrollBtn.addEventListener('click', () => {
      document.getElementById('reader-content').scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Show/hide scroll-to-top based on scroll position
    document.getElementById('reader-content').addEventListener('scroll', (e) => {
      if (e.target.scrollTop > 800) {
        scrollBtn.classList.remove('hidden');
      } else {
        scrollBtn.classList.add('hidden');
      }
      // Update page info based on scroll
      this.updatePageInfo(e.target);
    });

    // Read all button
    document.getElementById('btn-read-all').addEventListener('click', () => {
      if (ComicCrawler.crawlResults?.chaptersData) {
        this.openFromCrawlResults(ComicCrawler.crawlResults.chaptersData, 0);
      }
    });
  },

  /**
   * Load crawl results and open reader
   * @param {Array} chaptersData - Array of {chapter, images[], url}
   * @param {number} startIndex - Which chapter to start reading
   * @param {string} comicId - Optional ID of comic to track read progress
   */
  openFromCrawlResults(chaptersData, startIndex = 0, comicId = null) {
    this.comicId = comicId;
    this.chapters = chaptersData.filter(ch => ch.images && ch.images.length > 0);

    if (this.chapters.length === 0) {
      App.showToast('Không có ảnh để hiển thị', 'warning');
      return;
    }

    this.currentChapterIndex = Math.min(startIndex, this.chapters.length - 1);
    this.open();
  },

  open() {
    this.isOpen = true;
    const overlay = document.getElementById('reader-overlay');
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    this.renderChapter();
  },

  close() {
    this.isOpen = false;
    const overlay = document.getElementById('reader-overlay');
    overlay.classList.add('hidden');
    document.body.style.overflow = '';

    // Clear images to free memory
    document.getElementById('reader-content').innerHTML = '';
    this.revokeBlobUrls();

    // Refresh library view if opened from library
    if (this.comicId && typeof ComicLibrary !== 'undefined') {
      ComicLibrary.renderLibrary();
      if (ComicLibrary.selectedComic && ComicLibrary.selectedComic.id === this.comicId) {
        ComicLibrary.showDetail(this.comicId);
      }
    }
  },

  renderChapter() {
    const chapter = this.chapters[this.currentChapterIndex];
    if (!chapter) return;

    // Update title
    document.getElementById('reader-title').textContent = chapter.chapter;
    document.getElementById('reader-page-info').textContent =
      `${this.currentChapterIndex + 1}/${this.chapters.length} • ${chapter.images.length} ảnh`;

    // Update nav buttons
    document.getElementById('reader-prev-ch').disabled = this.currentChapterIndex === 0;
    document.getElementById('reader-next-ch').disabled = this.currentChapterIndex === this.chapters.length - 1;

    // Render images with lazy loading
    const content = document.getElementById('reader-content');
    content.scrollTop = 0;
    this.revokeBlobUrls();

    content.innerHTML = `
      <div class="reader-chapter-header">
        <h2>${chapter.chapter}</h2>
        <p>${chapter.images.length} trang</p>
      </div>
      ${chapter.images.map((img, i) => `
        <div class="reader-page" data-page="${i + 1}">
          <img
            class="reader-img"
            data-src="${AppConfig.rewriteUrl('/api/proxy-image?url=' + encodeURIComponent(img))}"
            data-orig="${encodeURIComponent(img)}"
            alt="Trang ${i + 1}"
            loading="lazy"
          >
          <div class="reader-page-number">${i + 1}</div>
        </div>
      `).join('')}
      <div class="reader-chapter-footer">
        <p>— Hết ${chapter.chapter} —</p>
        ${this.currentChapterIndex < this.chapters.length - 1
          ? `<button class="btn btn-primary btn-lg reader-next-btn" id="reader-next-inline">
               <span class="material-icons-round">arrow_forward</span>
               ${this.chapters[this.currentChapterIndex + 1].chapter}
             </button>`
          : '<p class="reader-end-text">🎉 Đã đọc hết tất cả chapters!</p>'
        }
      </div>
    `;

    // Inline next chapter button
    const nextBtn = document.getElementById('reader-next-inline');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.nextChapter());
    }

    // Start lazy loading images
    this.lazyLoadImages(content);
  },

  // Trên app Android, server Render (IP datacenter) bị Cloudflare của CDN ảnh
  // (anhvip.xyz) chặn 403 bất kể Referer, trong khi IP nhà mạng của điện thoại
  // thì không. Nên tải ảnh trực tiếp từ máy bằng HTTP native (CapacitorHttp —
  // WebView không cho đặt Referer tùy ý trên <img>), lỗi mới rơi về proxy.
  // Giữ đồng bộ danh sách domain với server/referer.js.
  NATIVE_REFERERS: [
    'https://www.toptruyenzone9.com/',
    'https://www.toptruyenzone7.com/',
    'https://www.toptruyenzone.com/',
  ],
  TCOMIC_REFERERS: ['https://tcomicfanq.com/'],
  _nativeReferer: new Map(), // host ảnh -> referer đã tải thành công
  _blobUrls: [],

  _nativeHttp() {
    if (!AppConfig.isNative()) return null;
    const p = window.Capacitor && window.Capacitor.Plugins;
    return (p && p.CapacitorHttp) || null;
  },

  async fetchImageNative(url) {
    const http = this._nativeHttp();
    if (!http) throw new Error('CapacitorHttp không khả dụng');
    const host = new URL(url).host;
    const base = /tcomic\.top|wasabisys\.com/i.test(host) ? this.TCOMIC_REFERERS : this.NATIVE_REFERERS;
    const candidates = [...new Set([this._nativeReferer.get(host), ...base].filter(Boolean))];

    for (const referer of candidates) {
      const resp = await http.request({
        method: 'GET',
        url,
        headers: { Referer: referer, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
        responseType: 'blob',
        connectTimeout: 12000,
        readTimeout: 20000,
      });
      if (resp.status >= 200 && resp.status < 400 && resp.data) {
        this._nativeReferer.set(host, referer);
        const headers = resp.headers || {};
        const ctKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
        const type = (ctKey && headers[ctKey]) || 'image/jpeg';
        // responseType 'blob' trả về base64
        const bin = atob(resp.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type }));
        this._blobUrls.push(blobUrl);
        return blobUrl;
      }
      // Chỉ 403/503 (chặn hotlink) mới đáng thử Referer khác.
      if (resp.status !== 403 && resp.status !== 503) break;
    }
    throw new Error('native fetch failed');
  },

  revokeBlobUrls() {
    this._blobUrls.forEach(u => URL.revokeObjectURL(u));
    this._blobUrls = [];
  },

  lazyLoadImages(container) {
    const images = container.querySelectorAll('.reader-img[data-src]');

    // Trên điện thoại, ảnh hiển thị hẹp hơn (width:100%, max-width:800px) nên
    // thấp hơn nhiều so với desktop → cùng rootMargin 500px "trúng" nhiều ảnh
    // hơn hẳn, khiến rất nhiều request /api/proxy-image bắn đồng thời và dồn
    // tải lên server (đặc biệt Render free tier), dẫn tới timeout hàng loạt.
    // Giới hạn số ảnh tải cùng lúc + tự động thử lại để chịu được việc đó.
    const MAX_CONCURRENT = 3;
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1500;
    let active = 0;
    const queue = [];

    const runNext = () => {
      while (active < MAX_CONCURRENT && queue.length) {
        loadImage(queue.shift());
      }
    };

    const loadImage = (img) => {
      const baseSrc = img.dataset.src || img._baseSrc;
      if (!baseSrc) return;
      img._baseSrc = baseSrc;
      const attempt = img._retryCount || 0;

      active++;
      img.style.minHeight = '200px';
      img.style.background = 'rgba(139, 92, 246, 0.1)';
      img.classList.remove('error');
      img.style.cursor = '';
      img.onclick = null;

      img.onload = () => {
        img.style.minHeight = '';
        img.style.background = '';
        img.classList.add('loaded');
        active--;
        runNext();
      };

      img.onerror = () => {
        active--;
        if (attempt < MAX_RETRIES) {
          img._retryCount = attempt + 1;
          setTimeout(() => {
            queue.push(img);
            runNext();
          }, RETRY_DELAY_MS * img._retryCount);
          return;
        }
        img.style.minHeight = '60px';
        img.style.background = 'rgba(239, 68, 68, 0.1)';
        const pageNum = img.alt.replace(/^⚠ Không tải được /, '').replace('Trang ', '').replace(/ \(chạm để thử lại\)$/, '');
        img.alt = `⚠ Không tải được trang ${pageNum} (chạm để thử lại)`;
        img.classList.add('error');
        img.style.cursor = 'pointer';
        img.onclick = () => {
          img._retryCount = 0;
          queue.push(img);
          runNext();
        };
        runNext();
      };

      // Cache-bust trên các lần thử lại để tránh CDN/trình duyệt trả lại
      // response lỗi đã cache theo đúng URL cũ.
      const proxySrc = attempt > 0
        ? baseSrc + (baseSrc.includes('?') ? '&' : '?') + '_retry=' + attempt
        : baseSrc;
      img.removeAttribute('data-src');

      const orig = img.dataset.orig ? decodeURIComponent(img.dataset.orig) : '';
      if (orig && this._nativeHttp()) {
        this.fetchImageNative(orig)
          .then(blobUrl => { img.src = blobUrl; })
          .catch(() => { img.src = proxySrc; });
      } else {
        img.src = proxySrc;
      }
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          queue.push(entry.target);
          observer.unobserve(entry.target);
          runNext();
        }
      });
    }, {
      root: container,
      rootMargin: '500px 0px', // Preload 500px ahead
    });

    images.forEach(img => observer.observe(img));
  },

  updatePageInfo(container) {
    const pages = container.querySelectorAll('.reader-page');
    let visiblePage = 1;

    pages.forEach(page => {
      const rect = page.getBoundingClientRect();
      if (rect.top < window.innerHeight / 2) {
        visiblePage = parseInt(page.dataset.page);
      }
    });

    const chapter = this.chapters[this.currentChapterIndex];
    if (chapter) {
      document.getElementById('reader-page-info').textContent =
        `${this.currentChapterIndex + 1}/${this.chapters.length} • ${visiblePage}/${chapter.images.length}`;
    }
  },

  nextChapter() {
    if (this.currentChapterIndex < this.chapters.length - 1) {
      this.currentChapterIndex++;
      this.saveProgress();
      this.renderChapter();
    }
  },

  prevChapter() {
    if (this.currentChapterIndex > 0) {
      this.currentChapterIndex--;
      this.saveProgress();
      this.renderChapter();
    }
  },
  
  saveProgress() {
    if (this.comicId) {
      window.appDB.updateComicReadProgress(this.comicId, this.currentChapterIndex);
      if (typeof ComicLibrary !== 'undefined') {
        if (ComicLibrary.selectedComic && ComicLibrary.selectedComic.id === this.comicId) {
          ComicLibrary.selectedComic.lastReadChapter = this.currentChapterIndex;
          ComicLibrary.selectedComic.lastReadAt = new Date().toISOString();
        }
        const mainComic = ComicLibrary.comics.find(c => c.id === this.comicId);
        if (mainComic) {
          mainComic.lastReadChapter = this.currentChapterIndex;
          mainComic.lastReadAt = new Date().toISOString();
        }
      }
    }
  },
};

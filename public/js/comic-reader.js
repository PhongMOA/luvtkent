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

  lazyLoadImages(container) {
    const images = container.querySelectorAll('.reader-img[data-src]');

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const src = img.dataset.src;

          // Create a loading indicator
          img.style.minHeight = '200px';
          img.style.background = 'rgba(139, 92, 246, 0.1)';

          img.onload = () => {
            img.style.minHeight = '';
            img.style.background = '';
            img.classList.add('loaded');
          };

          img.onerror = () => {
            img.style.minHeight = '60px';
            img.style.background = 'rgba(239, 68, 68, 0.1)';
            img.alt = `⚠ Không tải được trang ${img.alt.replace('Trang ', '')}`;
            img.classList.add('error');
          };

          img.src = src;
          img.removeAttribute('data-src');
          observer.unobserve(img);
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

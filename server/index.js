const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getComicInfo, getChapterImages, crawlLinks, delay } = require('./crawler');
const { downloadChapter } = require('./downloader');
const { checkDependencies, extractTabsFromVideo, extractPreviewFrame, extractTabsWithRegion, cleanupJob, startAutoCleanup, TAB_JOBS_DIR } = require('./tab-extractor');
const { searchGoogle: karaokeSearch, fetchLyrics: karaokeFetchLyrics } = require('./karaoke');
const { refererCandidates, rememberReferer } = require('./referer');

const app = express();
const PORT = process.env.PORT || 3005;

// Download directory
const DOWNLOAD_DIR = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Lightweight health endpoint for client-side warm-up pings (Render free tier
// sleeps after 15min idle; cold start can take 30s+).
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Lazy-load got-scraping (ESM only) — mimics real Chrome TLS fingerprint to
// bypass Cloudflare bot detection on datacenter IPs (Railway/Vercel).
let gotScrapingPromise = null;
function loadGotScraping() {
  if (!gotScrapingPromise) {
    gotScrapingPromise = import('got-scraping').then(m => m.gotScraping);
  }
  return gotScrapingPromise;
}

// ========================
// CRAWL ENDPOINTS
// ========================

// Store active crawl jobs
const crawlJobs = new Map();

/**
 * POST /api/crawl/scan
 * Scan a comic page to get info + chapter list
 */
app.post('/api/crawl/scan', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    console.log(`[SCAN] Scanning: ${url}`);
    const info = await getComicInfo(url);
    console.log(`[SCAN] Found: ${info.title} - ${info.totalChapters} chapters`);

    res.json({ success: true, data: info });
  } catch (err) {
    console.error('[SCAN] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/crawl/chapter-images
 * Get image URLs from a single chapter
 */
app.post('/api/crawl/chapter-images', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const images = await getChapterImages(url);
    res.json({ success: true, images, count: images.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/crawl/links
 * Crawl all chapters and get all image links
 * Returns a job ID for progress tracking via SSE
 */
app.post('/api/crawl/links', async (req, res) => {
  try {
    const { url, chapters } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const jobId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    crawlJobs.set(jobId, {
      status: 'running',
      progress: { current: 0, total: 0, chapter: '' },
      results: null,
      error: null,
    });

    // Start async crawl
    (async () => {
      try {
        const comicInfo = await getComicInfo(url);
        const job = crawlJobs.get(jobId);
        job.comicTitle = comicInfo.title;

        // If specific chapters provided, filter them
        let chaptersToCrawl = comicInfo.chapters;
        if (chapters && chapters.length > 0) {
          chaptersToCrawl = comicInfo.chapters.filter(ch =>
            chapters.includes(ch.title) || chapters.includes(ch.url)
          );
        }

        job.progress.total = chaptersToCrawl.length;

        const results = [];
        for (let i = 0; i < chaptersToCrawl.length; i++) {
          const chapter = chaptersToCrawl[i];
          try {
            const images = await getChapterImages(chapter.url);
            results.push({
              chapter: chapter.title,
              url: chapter.url,
              images,
              imageCount: images.length,
            });
          } catch (err) {
            results.push({
              chapter: chapter.title,
              url: chapter.url,
              images: [],
              imageCount: 0,
              error: err.message,
            });
          }

          job.progress.current = i + 1;
          job.progress.chapter = chapter.title;
          await delay(800);
        }

        job.status = 'done';
        job.results = { ...comicInfo, chaptersData: results };
      } catch (err) {
        const job = crawlJobs.get(jobId);
        job.status = 'error';
        job.error = err.message;
      }
    })();

    res.json({ success: true, jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/crawl/download
 * Download images for chapters
 */
app.post('/api/crawl/download', async (req, res) => {
  try {
    const { url, chapters, comicTitle } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const jobId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    crawlJobs.set(jobId, {
      status: 'running',
      type: 'download',
      progress: { current: 0, total: 0, chapter: '', page: 0, totalPages: 0 },
      results: null,
      error: null,
    });

    (async () => {
      try {
        const comicInfo = await getComicInfo(url);
        const job = crawlJobs.get(jobId);
        const title = comicTitle || comicInfo.title;

        let chaptersToCrawl = comicInfo.chapters;
        if (chapters && chapters.length > 0) {
          chaptersToCrawl = comicInfo.chapters.filter(ch =>
            chapters.includes(ch.title) || chapters.includes(ch.url)
          );
        }

        job.progress.total = chaptersToCrawl.length;

        const results = [];
        for (let i = 0; i < chaptersToCrawl.length; i++) {
          const chapter = chaptersToCrawl[i];
          job.progress.current = i + 1;
          job.progress.chapter = chapter.title;

          try {
            const images = await getChapterImages(chapter.url);

            const downloadResult = await downloadChapter(
              title,
              chapter.title,
              images,
              DOWNLOAD_DIR,
              chapter.url,
              (pageProgress) => {
                job.progress.page = pageProgress.page;
                job.progress.totalPages = pageProgress.totalPages;
              }
            );

            results.push(downloadResult);
          } catch (err) {
            results.push({
              chapter: chapter.title,
              error: err.message,
            });
          }

          await delay(500);
        }

        job.status = 'done';
        job.results = {
          comicTitle: title,
          downloadDir: path.join(DOWNLOAD_DIR, title),
          chaptersDownloaded: results,
        };
      } catch (err) {
        const job = crawlJobs.get(jobId);
        job.status = 'error';
        job.error = err.message;
      }
    })();

    res.json({ success: true, jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/crawl/status/:jobId
 * Check crawl job progress
 */
app.get('/api/crawl/status/:jobId', (req, res) => {
  const job = crawlJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

/**
 * DELETE /api/crawl/job/:jobId
 * Remove a completed job
 */
app.delete('/api/crawl/job/:jobId', (req, res) => {
  crawlJobs.delete(req.params.jobId);
  res.json({ success: true });
});

// ========================
// MOVIE ENDPOINTS (OMDb Proxy)
// ========================
// imdbapi.dev đã ngừng hoạt động (domain NXDOMAIN từ ~7/2026), chuyển sang OMDb.
// OMDb giữ nguyên IMDb ID dạng "tt..." nên phim đã lưu vẫn tương thích.
// Key mặc định đã nhúng sẵn; có thể ghi đè bằng biến môi trường OMDB_API_KEY
// (lấy miễn phí tại https://www.omdbapi.com/apikey.aspx).

const OMDB_API_KEY = process.env.OMDB_API_KEY || '1e91b1c1';
const OMDB_BASE = 'https://www.omdbapi.com/';

function omdbUrl(params) {
  const usp = new URLSearchParams({ apikey: OMDB_API_KEY, ...params });
  return `${OMDB_BASE}?${usp.toString()}`;
}

// "N/A" -> null, đồng thời loại chuỗi rỗng
function clean(v) {
  return v && v !== 'N/A' ? v : null;
}

// Lấy 4 chữ số năm đầu tiên từ "2008", "2008–2015", "23 Sep 2008"...
function firstYear(v) {
  const m = String(v || '').match(/\d{4}/);
  return m ? m[0] : null;
}

// Chuẩn hóa ngày phát hành về ISO "YYYY-MM-DD".
// OMDb trả "23 Sep 2008" (chi tiết phim) hoặc "2008-09-23" (tập phim).
function toIsoDate(v) {
  if (!clean(v)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d)) {
    const y = firstYear(v);
    return y ? `${y}-01-01` : null;
  }
  return d.toISOString().slice(0, 10);
}

// { year, month, day } cho frontend từ ISO date
function toReleaseParts(iso) {
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

// OMDb báo lỗi (hết hạn mức, sai key, không tìm thấy...)
function omdbError(data) {
  const err = clean(data && data.Error);
  if (/request limit/i.test(err || '')) {
    return 'OMDb đã hết hạn mức request. Vui lòng đặt biến môi trường OMDB_API_KEY bằng key riêng (miễn phí tại omdbapi.com/apikey.aspx).';
  }
  if (/invalid api key/i.test(err || '')) {
    return 'OMDB_API_KEY không hợp lệ. Lấy key miễn phí tại omdbapi.com/apikey.aspx.';
  }
  return err;
}

/**
 * GET /api/movies/search?query=...&year=...
 * Tìm phim qua OMDb
 */
app.get('/api/movies/search', async (req, res) => {
  try {
    const { query, year } = req.query;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    const params = { s: query, type: '' };
    if (year) params.y = year;

    const response = await require('axios').get(omdbUrl(params), { timeout: 15000 });
    const data = response.data;

    if (data.Response === 'False') {
      // "Movie not found!" là kết quả rỗng bình thường, không phải lỗi
      if (/not found/i.test(data.Error || '')) {
        return res.json({ success: true, data: { results: [] } });
      }
      return res.status(502).json({ error: omdbError(data) || 'OMDb request failed' });
    }

    const results = (data.Search || []).map(item => ({
      id: item.imdbID,
      title: item.Title,
      original_title: item.Title,
      release_date: firstYear(item.Year) ? `${firstYear(item.Year)}-01-01` : null,
      poster_path: clean(item.Poster),
      vote_average: null, // OMDb không trả rating ở kết quả tìm kiếm
    }));

    res.json({ success: true, data: { results } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/movies/details/:id
 * Chi tiết phim từ OMDb
 */
app.get('/api/movies/details/:id', async (req, res) => {
  try {
    const response = await require('axios').get(
      omdbUrl({ i: req.params.id, plot: 'full' }),
      { timeout: 15000 }
    );
    const item = response.data;

    if (item.Response === 'False') {
      return res.status(502).json({ error: omdbError(item) || 'Không lấy được thông tin phim' });
    }

    const runtimeMin = parseInt(clean(item.Runtime), 10);
    const rating = parseFloat(clean(item.imdbRating));
    const releaseIso = toIsoDate(item.Released) ||
      (firstYear(item.Year) ? `${firstYear(item.Year)}-01-01` : null);

    const movieData = {
      id: item.imdbID,
      title: item.Title,
      original_title: item.Title,
      release_date: releaseIso,
      poster_path: clean(item.Poster),
      backdrop_path: clean(item.Poster),
      overview: clean(item.Plot) || 'Chưa có mô tả',
      vote_average: isNaN(rating) ? null : rating,
      genres: (clean(item.Genre) || '').split(',').map(g => g.trim()).filter(Boolean).map(name => ({ name })),
      runtime: isNaN(runtimeMin) ? null : runtimeMin,
      total_seasons: parseInt(clean(item.totalSeasons), 10) || null,
    };

    res.json({ success: true, data: movieData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/movies/details/:id/episodes
 * Danh sách tập phim (theo từng season) từ OMDb
 */
app.get('/api/movies/details/:id/episodes', async (req, res) => {
  try {
    const axios = require('axios');
    const id = req.params.id;

    // Lấy tổng số season trước
    const detailRes = await axios.get(omdbUrl({ i: id }), { timeout: 15000 });
    const detail = detailRes.data;

    if (detail.Response === 'False') {
      return res.json({ success: true, data: { episodes: [] } });
    }

    const totalSeasons = parseInt(clean(detail.totalSeasons), 10);
    if (!totalSeasons || detail.Type !== 'series') {
      return res.json({ success: true, data: { episodes: [] } }); // Phim lẻ, không có tập
    }

    const seasonNumbers = Array.from({ length: totalSeasons }, (_, i) => i + 1);
    const seasonResults = await Promise.all(
      seasonNumbers.map(n =>
        axios.get(omdbUrl({ i: id, Season: String(n) }), { timeout: 15000 })
          .then(r => ({ n, data: r.data }))
          .catch(() => ({ n, data: null }))
      )
    );

    const allEpisodes = [];
    for (const { n, data } of seasonResults) {
      if (!data || data.Response === 'False' || !Array.isArray(data.Episodes)) continue;
      for (const ep of data.Episodes) {
        const iso = toIsoDate(ep.Released);
        const epRating = parseFloat(clean(ep.imdbRating));
        allEpisodes.push({
          id: ep.imdbID,
          season: String(n),
          episodeNumber: parseInt(ep.Episode, 10) || 0,
          title: ep.Title || '',
          originalTitle: ep.Title || '',
          releaseDate: toReleaseParts(iso),
          rating: isNaN(epRating) ? null : { aggregateRating: epRating },
        });
      }
    }

    res.json({ success: true, data: { episodes: allEpisodes } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// TAB EXTRACTOR ENDPOINTS
// ========================

const tabJobs = new Map();

// Start auto-cleanup for old tab jobs
startAutoCleanup();

/**
 * GET /api/tab/check
 * Check if yt-dlp and ffmpeg are available
 */
app.get('/api/tab/check', async (req, res) => {
  const deps = await checkDependencies();
  res.json({ success: true, dependencies: deps });
});

/**
 * POST /api/tab/preview
 * Download video and extract a preview frame for manual region selection
 */
app.post('/api/tab/preview', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    if (!/youtube\.com\/watch|youtu\.be\//i.test(url)) {
      return res.status(400).json({ error: 'Chỉ hỗ trợ URL YouTube' });
    }

    const deps = await checkDependencies();
    if (!deps.ytdlp || !deps.ffmpeg) {
      const missing = [];
      if (!deps.ytdlp) missing.push('yt-dlp');
      if (!deps.ffmpeg) missing.push('ffmpeg');
      return res.status(503).json({ error: `Thiếu: ${missing.join(', ')}. Vui lòng cài đặt trước khi sử dụng.` });
    }

    const jobId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    tabJobs.set(jobId, {
      status: 'starting',
      progress: { step: 'Khởi tạo...' },
      videoTitle: null,
      result: null,
      error: null,
    });

    // Start async preview extraction
    (async () => {
      try {
        const result = await extractPreviewFrame(url, jobId, (update) => {
          const job = tabJobs.get(jobId);
          if (job) {
            job.status = update.status;
            job.progress = update.progress;
            if (update.videoTitle) job.videoTitle = update.videoTitle;
          }
        });

        const job = tabJobs.get(jobId);
        if (job) {
          job.status = 'preview_ready';
          job.videoTitle = result.videoTitle;
          job.result = {
            previewUrl: `/api/tab/preview-image/${jobId}`,
            videoTitle: result.videoTitle,
            width: result.width,
            height: result.height,
            duration: result.duration,
          };
        }
      } catch (err) {
        const job = tabJobs.get(jobId);
        if (job) {
          job.status = 'error';
          job.error = err.message;
        }
      }
    })();

    res.json({ success: true, jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tab/preview-image/:jobId
 * Serve the preview frame image
 */
app.get('/api/tab/preview-image/:jobId', (req, res) => {
  const previewPath = path.join(TAB_JOBS_DIR, req.params.jobId, 'preview.jpg');
  if (!fs.existsSync(previewPath)) {
    return res.status(404).json({ error: 'Preview not found' });
  }
  res.set('Content-Type', 'image/jpeg');
  res.sendFile(previewPath);
});

/**
 * POST /api/tab/extract
 * Start tab extraction from YouTube video
 * Supports: auto-detect, timestamps, and manual region modes
 */
app.post('/api/tab/extract', async (req, res) => {
  try {
    const { url, timestamps, region, jobId: existingJobId, sensitivity } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    if (!/youtube\.com\/watch|youtu\.be\//i.test(url)) {
      return res.status(400).json({ error: 'Chỉ hỗ trợ URL YouTube' });
    }

    const deps = await checkDependencies();
    if (!deps.ytdlp || !deps.ffmpeg) {
      const missing = [];
      if (!deps.ytdlp) missing.push('yt-dlp');
      if (!deps.ffmpeg) missing.push('ffmpeg');
      return res.status(503).json({ error: `Thiếu: ${missing.join(', ')}. Vui lòng cài đặt trước khi sử dụng.` });
    }

    // Use existing jobId (from preview) or create new one
    const jobId = existingJobId || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    const existingJob = tabJobs.get(jobId);
    const videoTitle = existingJob?.videoTitle || null;

    tabJobs.set(jobId, {
      status: 'starting',
      progress: { step: 'Khởi tạo...' },
      videoTitle,
      result: null,
      error: null,
    });

    // Start async extraction
    (async () => {
      try {
        let result;
        const onUpdate = (update) => {
          const job = tabJobs.get(jobId);
          if (job) {
            job.status = update.status;
            job.progress = update.progress;
            if (update.videoTitle) job.videoTitle = update.videoTitle;
          }
        };

        if (region) {
          // Manual region mode - crop using user-selected region
          const opts = { videoTitle };
          if (timestamps && Array.isArray(timestamps) && timestamps.length > 0) {
            opts.timestamps = timestamps;
          }
          if (sensitivity) opts.sensitivity = sensitivity;
          result = await extractTabsWithRegion(url, jobId, region, onUpdate, opts);
        } else {
          // Auto-detect mode (original behavior)
          const opts = {};
          if (timestamps && Array.isArray(timestamps) && timestamps.length > 0) {
            opts.timestamps = timestamps;
          }
          if (sensitivity) opts.sensitivity = sensitivity;
          result = await extractTabsFromVideo(url, jobId, onUpdate, opts);
        }

        const job = tabJobs.get(jobId);
        if (job) {
          job.status = 'done';
          job.videoTitle = result.videoTitle;
          job.result = {
            imageUrl: `/api/tab/result/${jobId}`,
            tabCount: result.tabCount,
            totalFrames: result.totalFrames,
            detectedFrames: result.detectedFrames,
            videoTitle: result.videoTitle,
          };
        }
      } catch (err) {
        const job = tabJobs.get(jobId);
        if (job) {
          job.status = 'error';
          job.error = err.message;
        }
      }
    })();

    res.json({ success: true, jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tab/status/:jobId
 * Check extraction job progress
 */
app.get('/api/tab/status/:jobId', (req, res) => {
  const job = tabJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

/**
 * GET /api/tab/result/:jobId
 * Serve the stitched tab result image
 */
app.get('/api/tab/result/:jobId', (req, res) => {
  const resultPath = path.join(TAB_JOBS_DIR, req.params.jobId, 'result.jpg');
  if (!fs.existsSync(resultPath)) {
    return res.status(404).json({ error: 'Result not found' });
  }
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(resultPath);
});

/**
 * DELETE /api/tab/job/:jobId
 * Cleanup tab extraction job
 */
app.delete('/api/tab/job/:jobId', (req, res) => {
  cleanupJob(req.params.jobId);
  tabJobs.delete(req.params.jobId);
  res.json({ success: true });
});

// ========================
// KARAOKE ENDPOINTS
// ========================

/**
 * GET /api/karaoke/search?q=...
 * Tìm bài hát qua Google Search, trả về danh sách kết quả
 */
app.get('/api/karaoke/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Tham số q là bắt buộc' });

    console.log(`[KARAOKE] Search: ${q}`);
    const results = await karaokeSearch(q);
    res.json({ success: true, results });
  } catch (err) {
    console.error('[KARAOKE] Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/karaoke/fetch-lyrics?url=...
 * Tải URL và trích xuất lyrics
 */
app.get('/api/karaoke/fetch-lyrics', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Tham số url là bắt buộc' });

    console.log(`[KARAOKE] Fetch lyrics: ${url}`);
    const data = await karaokeFetchLyrics(url);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('[KARAOKE] Fetch lyrics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// PROXY IMAGE ENDPOINT
// ========================

/**
 * GET /api/proxy-image?url=...
 * Proxy images to bypass CORS/Referer restrictions
 */
app.get('/api/proxy-image', async (req, res) => {
  const axios = require('axios');
  const { url } = req.query;
  if (!url) return res.status(400).send('URL required');

  const decoded = decodeURIComponent(url);
  // CDN ảnh chặn hotlink theo Referer và domain nguồn đổi liên tục, nên thử
  // lần lượt các ứng viên thay vì hardcode một domain (xem server/referer.js).
  const candidates = refererCandidates(decoded, req.query.referer);

  const baseHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Fetch-Dest': 'image',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
  };

  let lastStatus = null;
  let lastMessage = '';

  for (const referer of candidates) {
    try {
      const response = await axios.get(decoded, {
        responseType: 'stream',
        // Giữ ngắn: khi nhiều ảnh của cùng 1 chapter bắn request đồng thời
        // (đặc biệt trên mobile, xem comic-reader.js lazyLoadImages), một
        // request treo 30s mỗi ứng viên Referer sẽ dồn tải/giữ kết nối lâu
        // trên Render free tier và làm các request khác timeout theo.
        timeout: 12000,
        headers: { ...baseHeaders, Referer: referer },
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400,
      });

      rememberReferer(decoded, referer);

      if (response.headers['content-type']) res.set('Content-Type', response.headers['content-type']);
      if (response.headers['content-length']) res.set('Content-Length', response.headers['content-length']);
      res.set('Cache-Control', 'public, max-age=86400');

      response.data.on('error', (err) => {
        console.error('[PROXY-IMAGE] stream error:', err.message);
        if (!res.headersSent) res.status(502).end();
        else res.end();
      });

      return response.data.pipe(res);
    } catch (err) {
      lastStatus = err.response?.status || null;
      lastMessage = err.message;
      // 403/503 = bị chặn hotlink hoặc Cloudflare → thử Referer kế tiếp.
      // Lỗi khác (404, timeout...) thì đổi Referer cũng vô ích.
      if (lastStatus !== 403 && lastStatus !== 503) break;
    }
  }

  console.error(`[PROXY-IMAGE] ${lastStatus || 'ERR'} ${decoded.substring(0, 100)} — ${lastMessage}`);

  // Fallback cuối: got-scraping giả TLS fingerprint của Chrome thật, dùng khi
  // Cloudflare chặn theo bot score chứ không phải theo Referer.
  if (lastStatus === 403 || lastStatus === 503) {
    try {
      const gotScraping = await loadGotScraping();
      const resp = await gotScraping({
        url: decoded,
        responseType: 'buffer',
        timeout: { request: 30000 },
        retry: { limit: 0 },
        headers: { Referer: candidates[0], Accept: baseHeaders.Accept },
        headerGeneratorOptions: {
          browsers: [{ name: 'chrome', minVersion: 120 }],
          devices: ['desktop'],
          locales: ['vi-VN', 'en-US'],
          operatingSystems: ['windows'],
        },
      });
      if (resp.statusCode >= 400) {
        return res.status(resp.statusCode).end();
      }
      rememberReferer(decoded, candidates[0]);
      if (resp.headers['content-type']) res.set('Content-Type', resp.headers['content-type']);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(resp.body);
    } catch (gErr) {
      console.error('[PROXY-IMAGE] got-scraping fallback failed:', gErr.message);
    }
  }

  if (!res.headersSent) res.status(lastStatus || 502).send('Error proxying image');
});

// SPA fallback
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║     🎬 LuvTK Entertainment App 🎬      ║
  ║                                          ║
  ║  Server running at:                      ║
  ║  http://localhost:${PORT}                   ║
  ║                                          ║
  ║  Downloads: ${DOWNLOAD_DIR.substring(0, 28).padEnd(28)}║
  ╚══════════════════════════════════════════╝
  `);
  if (!process.env.OMDB_API_KEY) {
    console.log('[MOVIES] Dùng OMDb key mặc định trong code. Có thể ghi đè bằng biến môi trường OMDB_API_KEY.');
  }
});

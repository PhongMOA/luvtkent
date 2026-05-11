const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getComicInfo, getChapterImages, crawlLinks, delay } = require('./crawler');
const { downloadChapter } = require('./downloader');
const { checkDependencies, extractTabsFromVideo, extractPreviewFrame, extractTabsWithRegion, cleanupJob, startAutoCleanup, TAB_JOBS_DIR } = require('./tab-extractor');
const { searchGoogle: karaokeSearch, fetchLyrics: karaokeFetchLyrics } = require('./karaoke');

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
// MOVIE ENDPOINTS (TMDB Proxy)
// ========================

/**
 * GET /api/movies/search?query=...&year=...
 * Search movies via IMDB API
 */
app.get('/api/movies/search', async (req, res) => {
  try {
    const { query, year } = req.query;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    // using imdbapi.dev
    const response = await require('axios').get(
      `https://api.imdbapi.dev/search/titles?query=${encodeURIComponent(query)}`
    );

    // Map IMDB to TMDB-like format for frontend
    const results = (response.data.titles || []).map(item => ({
      id: item.id,
      title: item.primaryTitle,
      original_title: item.originalTitle,
      release_date: item.startYear ? `${item.startYear}-01-01` : null,
      poster_path: item.primaryImage?.url || null,
      vote_average: item.rating?.aggregateRating || null,
    }));

    res.json({ success: true, data: { results } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/movies/details/:id
 * Get movie details from IMDB API
 */
app.get('/api/movies/details/:id', async (req, res) => {
  try {
    const response = await require('axios').get(
      `https://api.imdbapi.dev/titles/${req.params.id}`
    );

    const item = response.data;
    const movieData = {
      id: item.id,
      title: item.primaryTitle,
      original_title: item.originalTitle,
      release_date: item.startYear ? `${item.startYear}-01-01` : null,
      poster_path: item.primaryImage?.url || null,
      backdrop_path: item.primaryImage?.url || null,
      overview: item.plot || 'Chưa có mô tả',
      vote_average: item.rating?.aggregateRating || null,
      genres: (item.genres || []).map(g => ({ name: g })),
      runtime: item.runtimeSeconds ? Math.floor(item.runtimeSeconds / 60) : null
    };

    res.json({ success: true, data: movieData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/movies/details/:id/episodes
 * Get movie episodes from IMDB API
 */
app.get('/api/movies/details/:id/episodes', async (req, res) => {
  try {
    let allEpisodes = [];
    let nextPageToken = null;
    const axios = require('axios');
    
    do {
      const url = `https://api.imdbapi.dev/titles/${req.params.id}/episodes?pageSize=50` + 
                  (nextPageToken ? `&pageToken=${nextPageToken}` : '');
      const response = await axios.get(url);
      
      if (response.data && response.data.episodes) {
        allEpisodes = allEpisodes.concat(response.data.episodes);
      }
      
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);
    
    res.json({ success: true, data: { episodes: allEpisodes } });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.json({ success: true, data: { episodes: [] } }); // No episodes
    }
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
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL required');

    const decoded = decodeURIComponent(url);
    let referer = 'https://www.toptruyenssi.com/';
    try {
      const host = new URL(decoded).host;
      if (/tcomic\.top|wasabisys\.com/i.test(host)) referer = 'https://tcomicfanq.com/';
    } catch (_) {}

    const gotScraping = await loadGotScraping();
    const stream = gotScraping.stream({
      url: decoded,
      timeout: { request: 30000 },
      retry: { limit: 0 },
      headers: {
        Referer: referer,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        locales: ['vi-VN', 'en-US'],
        operatingSystems: ['windows'],
      },
    });

    let headersSent = false;
    stream.on('response', (resp) => {
      if (headersSent) return;
      headersSent = true;
      if (resp.statusCode >= 400) {
        res.status(resp.statusCode).end();
        stream.destroy();
        return;
      }
      if (resp.headers['content-type']) res.set('Content-Type', resp.headers['content-type']);
      if (resp.headers['content-length']) res.set('Content-Length', resp.headers['content-length']);
      res.set('Cache-Control', 'public, max-age=86400');
    });

    stream.on('error', (err) => {
      console.error('[PROXY-IMAGE]', err.message);
      if (!headersSent) {
        res.status(502).send('Error proxying image');
      } else {
        res.end();
      }
    });

    stream.pipe(res);
  } catch (err) {
    console.error('[PROXY-IMAGE] fatal:', err.message);
    if (!res.headersSent) res.status(500).send('Error proxying image');
  }
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
});

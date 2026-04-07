const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getComicInfo, getChapterImages, crawlLinks, delay } = require('./crawler');
const { downloadChapter } = require('./downloader');

const app = express();
const PORT = process.env.PORT || 3000;

// Download directory
const DOWNLOAD_DIR = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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

    const response = await require('axios')({
      method: 'GET',
      url: decodeURIComponent(url),
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.toptruyenssi.com/',
      },
    });

    res.set('Content-Type', response.headers['content-type']);
    res.set('Cache-Control', 'public, max-age=86400');
    response.data.pipe(res);
  } catch (err) {
    res.status(500).send('Error proxying image');
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

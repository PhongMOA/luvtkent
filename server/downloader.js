const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Sanitize folder/file name
 */
function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
}

/**
 * Download a single image
 */
// Pick a sensible Referer based on the image host (CDNs usually require
// a matching site referer to avoid 403). Falls back to the chapter URL.
function pickReferer(imageUrl, chapterUrl) {
  try {
    const host = new URL(imageUrl).host;
    if (/tcomic\.top|wasabisys\.com/i.test(host)) return 'https://tcomicfanq.com/';
  } catch (_) {}
  if (chapterUrl && /^https?:/i.test(chapterUrl)) return chapterUrl;
  return 'https://www.toptruyenssi.com/';
}

async function downloadImage(url, savePath, referer) {
  const dir = path.dirname(savePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Skip if already exists
  if (fs.existsSync(savePath)) {
    return { success: true, skipped: true, path: savePath };
  }

  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': pickReferer(url, referer),
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });

    const writer = fs.createWriteStream(savePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve({ success: true, skipped: false, path: savePath }));
      writer.on('error', (err) => reject(err));
    });
  } catch (err) {
    return { success: false, error: err.message, path: savePath };
  }
}

/**
 * Download all images for a chapter
 */
async function downloadChapter(comicTitle, chapterTitle, images, baseDir, referer, onProgress) {
  const comicDir = sanitizeName(comicTitle);
  const chapterDir = sanitizeName(chapterTitle);
  const fullDir = path.join(baseDir, comicDir, chapterDir);

  const results = [];
  for (let i = 0; i < images.length; i++) {
    const imageUrl = images[i];
    const ext = getExtension(imageUrl);
    const fileName = `${String(i + 1).padStart(3, '0')}${ext}`;
    const savePath = path.join(fullDir, fileName);

    const result = await downloadImage(imageUrl, savePath, referer);
    results.push(result);

    if (onProgress) {
      onProgress({
        page: i + 1,
        totalPages: images.length,
        chapter: chapterTitle,
        ...result,
      });
    }

    // Small delay between downloads
    if (!result.skipped) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  return {
    chapter: chapterTitle,
    directory: fullDir,
    totalImages: images.length,
    downloaded: results.filter(r => r.success && !r.skipped).length,
    skipped: results.filter(r => r.skipped).length,
    failed: results.filter(r => !r.success).length,
    results,
  };
}

/**
 * Get file extension from URL
 */
function getExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).split('?')[0];
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(ext.toLowerCase())) {
      return ext;
    }
  } catch (e) { }
  return '.jpg';
}

module.exports = {
  downloadImage,
  downloadChapter,
  sanitizeName,
};

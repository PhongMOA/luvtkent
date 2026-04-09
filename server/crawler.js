const cheerio = require('cheerio');

// Lazy-load got-scraping (ESM only) via dynamic import
let gotScrapingPromise = null;
function loadGotScraping() {
  if (!gotScrapingPromise) {
    gotScrapingPromise = import('got-scraping').then(m => m.gotScraping);
  }
  return gotScrapingPromise;
}

// Delay utility
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch page HTML with retry logic + exponential backoff.
 * Uses got-scraping which mimics real Chrome TLS fingerprint + headers
 * to bypass Cloudflare bot detection on datacenter IPs (e.g. Railway).
 */
async function fetchPage(url, retries = 5) {
  const gotScraping = await loadGotScraping();
  let lastErr;

  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[FETCH] Attempt ${i + 1}/${retries}: ${url.substring(0, 100)}`);

      const response = await gotScraping({
        url,
        timeout: { request: 45000 },
        retry: { limit: 0 }, // we handle retry ourselves
        headerGeneratorOptions: {
          browsers: [{ name: 'chrome', minVersion: 120 }],
          devices: ['desktop'],
          locales: ['vi-VN', 'en-US'],
          operatingSystems: ['windows'],
        },
      });

      if (response.statusCode >= 400) {
        const err = new Error(`HTTP ${response.statusCode}`);
        err.response = { status: response.statusCode };
        throw err;
      }

      return response.body;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status || err.response?.statusCode;
      const code = err.code;
      console.error(`[FETCH] Attempt ${i + 1} failed (${code || status || 'unknown'}): ${err.message}`);

      // Don't retry on 404
      if (status === 404) {
        throw new Error(`Page not found (404): ${url}`);
      }

      // Don't retry on other 4xx (except 403 = Cloudflare, 429 = rate limit)
      if (status && status >= 400 && status < 500 && status !== 429 && status !== 403) {
        throw new Error(`HTTP ${status}: ${url}`);
      }

      if (i < retries - 1) {
        const backoff = Math.min(2000 * Math.pow(2, i), 16000);
        console.log(`[FETCH] Retrying in ${backoff}ms...`);
        await delay(backoff);
      }
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} retries. Last error: ${lastErr?.message || 'unknown'}`);
}

/**
 * Extract comic info + chapter list from a comic detail page
 * URL format: https://www.toptruyenssi.com/truyen-tranh/[slug]/[id]
 */
async function getComicInfo(url) {
  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  // Extract comic title
  const title = $('h1.title-detail').text().trim() ||
    $('title').text().split('[')[0].split(' - ')[0].trim() ||
    $('ul.breadcrumb li:last-child').text().trim();

  // Extract alternate name
  const altName = $('li.othername h2').text().trim() || '';

  // Extract status
  const status = $('li.status p.col-xs-8').text().trim() || 'Đang cập nhật';

  // Extract genres
  const genres = [];
  $('li.kind p.col-xs-8 a').each((_, el) => {
    genres.push($(el).text().trim());
  });

  // Helper to extract text while preserving <br> as newlines
  const extractWithNewlines = (selector) => {
    const node = $(selector).first();
    if (!node.length) return '';
    // Replace <br> tags with \n so that text() retains line breaks
    node.find('br').replaceWith('\n');
    return node.text().trim();
  };

  // Extract description
  let description = extractWithNewlines('p.detail-summary') || 
                    extractWithNewlines('div.detail-content p.shortened') || 
                    extractWithNewlines('div.detail-content p') || 
                    extractWithNewlines('div.detail-content') || 
                    extractWithNewlines('.summary-content p') || 
                    extractWithNewlines('.summary-content') || 
                    extractWithNewlines('.comic-info .description');

  description = description.replace(/Tóm tắt truyện[:\n\s]*/gi, '').trim();

  // Extract cover/thumbnail - try multiple selectors and fallbacks
  const cover = $('div.col-image img').attr('data-original') ||
    $('div.col-image img').attr('data-src') ||
    $('div.col-image img').attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    $('.book3d img').attr('src') ||
    $('img[alt*="' + ($('h1.title-detail').text().trim() || '') + '"]').attr('src') ||
    '';

  // Extract chapter list
  const chapters = [];
  const uniqueUrls = new Set();

  $('.list-chapter li.row, #nt_listchapter li.row, ul.list-chapter li').each((_, el) => {
    const $el = $(el);
    
    // Skip pagination and heading rows
    if ($el.hasClass('heading') || $el.hasClass('page-item') || $el.closest('.pagination').length > 0) {
      return;
    }

    // Skip hidden elements (display: none)
    const styleAttr = $el.attr('style') || '';
    if (styleAttr.replace(/\s+/g, '').toLowerCase().includes('display:none')) {
      return;
    }

    const link = $el.find('a').first();
    if (!link.length) return;
    
    const linkStyleAttr = link.attr('style') || '';
    if (linkStyleAttr.replace(/\s+/g, '').toLowerCase().includes('display:none')) {
      return;
    }
    const href = link.attr('href');
    let text = link.text().trim();

    if (!href || !text) return;
    
    // Make sure it's not a pagination number that snuck in
    if (/^\d{1,3}$/.test(text) && !$el.hasClass('row')) {
       // If it's just a number like "1" or "183" and doesn't belong to a .row, it's highly likely pagination
       return; 
    }

    // Build absolute URL
    let fullUrl = href;
    if (!href.startsWith('http')) {
      const baseUrl = new URL(url);
      fullUrl = `${baseUrl.origin}${href}`;
    }

    if (!uniqueUrls.has(fullUrl)) {
      uniqueUrls.add(fullUrl);
      chapters.push({
        title: text,
        url: fullUrl,
      });
    }
  });

  // Remove duplicates (the page often has duplicate links)
  const seen = new Set();
  const uniqueChapters = chapters.filter(ch => {
    if (seen.has(ch.url)) return false;
    seen.add(ch.url);
    return true;
  });

  // Reverse to get oldest first
  uniqueChapters.reverse();

  return {
    title,
    altName,
    status,
    genres,
    description,
    cover,
    url,
    chapters: uniqueChapters,
    totalChapters: uniqueChapters.length,
  };
}

/**
 * Extract image URLs from a chapter page
 * TopTruyen uses .reading-detail .page-chapter img
 */
async function getChapterImages(chapterUrl) {
  const html = await fetchPage(chapterUrl);
  const $ = cheerio.load(html);
  console.log(`[IMAGES] HTML length: ${html.length}, looking for images...`);

  const images = [];

  // TopTruyen/NetTruyen structure: images in .reading-detail .page-chapter img
  $('div.reading-detail div.page-chapter img, div#content_chap img, .chapter-content img').each((_, el) => {
    let src = $(el).attr('data-original') ||
      $(el).attr('data-src') ||
      $(el).attr('data-lazy-src') ||
      $(el).attr('src') || '';

    // Clean the src
    src = src.trim();

    // Skip placeholder/icon images
    if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('ads')
      && (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.webp') || src.includes('.gif')
        || src.includes('img_') || src.includes('_img') || src.includes('data='))) {
      // Ensure absolute URL
      if (src.startsWith('//')) {
        src = 'https:' + src;
      }
      images.push(src);
    }
  });

  console.log(`[IMAGES] Found ${images.length} images from reading-detail selectors`);

  // Alternative: look for all img tags within content area
  if (images.length === 0) {
    // Try broader selectors - many TopTruyen clones have different structures
    $('img').each((_, el) => {
      let src = $(el).attr('data-original') ||
        $(el).attr('data-src') ||
        $(el).attr('data-lazy-src') ||
        $(el).attr('data-cdn') ||
        $(el).attr('src') || '';
      src = src.trim();

      // Accept any image that looks like comic content
      if (src && src.length > 20
        && !src.includes('logo') && !src.includes('icon') && !src.includes('ads')
        && !src.includes('avatar') && !src.includes('banner') && !src.includes('btn')
        && !src.includes('favicon') && !src.includes('google') && !src.includes('facebook')
        && (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.webp'))) {
        if (src.startsWith('//')) src = 'https:' + src;
        if (!images.includes(src)) images.push(src);
      }
    });
    console.log(`[IMAGES] Fallback: found ${images.length} images from all img tags`);
  }

  // Last resort: look for image URLs in script tags (some sites embed image lists in JS)
  if (images.length === 0) {
    const scriptContent = $('script').map((_, el) => $(el).html()).get().join('\n');
    const imgRegex = /https?:\/\/[^"'\s]+\.(jpg|jpeg|png|webp|gif)/gi;
    const matches = scriptContent.match(imgRegex) || [];
    const filtered = matches.filter(url =>
      !url.includes('logo') && !url.includes('icon') && !url.includes('ads')
      && !url.includes('google') && !url.includes('facebook')
    );
    // Deduplicate
    const unique = [...new Set(filtered)];
    if (unique.length > 0) {
      images.push(...unique);
      console.log(`[IMAGES] Script extraction: found ${unique.length} images`);
    }
  }

  return images;
}

/**
 * Crawl all chapters of a comic - get links only
 */
async function crawlLinks(comicUrl, onProgress) {
  const comicInfo = await getComicInfo(comicUrl);
  const results = [];

  for (let i = 0; i < comicInfo.chapters.length; i++) {
    const chapter = comicInfo.chapters[i];
    try {
      const images = await getChapterImages(chapter.url);
      results.push({
        chapter: chapter.title,
        url: chapter.url,
        images,
        imageCount: images.length,
      });

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: comicInfo.chapters.length,
          chapter: chapter.title,
          imageCount: images.length,
        });
      }

      // Rate limiting - wait between requests
      await delay(800);
    } catch (err) {
      results.push({
        chapter: chapter.title,
        url: chapter.url,
        images: [],
        imageCount: 0,
        error: err.message,
      });
    }
  }

  return {
    ...comicInfo,
    chaptersData: results,
  };
}

module.exports = {
  getComicInfo,
  getChapterImages,
  crawlLinks,
  fetchPage,
  delay,
};

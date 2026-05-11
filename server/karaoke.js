/**
 * Karaoke - Tìm tên bài hát + lyrics qua Google Search
 *
 * Sử dụng got-scraping để bypass Cloudflare/anti-bot và cheerio để parse HTML.
 *  - searchGoogle(query): trả về list { title, url, snippet }
 *  - fetchLyrics(url): tải URL, cố gắng trích xuất { title, artist, lyrics }
 */
const cheerio = require('cheerio');

let gotScrapingPromise = null;
function loadGotScraping() {
  if (!gotScrapingPromise) {
    gotScrapingPromise = import('got-scraping').then(m => m.gotScraping);
  }
  return gotScrapingPromise;
}

const COMMON_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
};

// Filter out URL types không phải trang lyrics
const BLACKLIST_HOSTS = /(google\.|youtube\.com|youtu\.be|facebook\.com|tiktok\.com|instagram\.com|twitter\.com|x\.com|spotify\.com|apple\.com|amazon\.|wikipedia\.org)/i;

/**
 * Tìm kiếm bài hát qua web search.
 *
 * Google chính thống trả về trang JS-only và yêu cầu enable JS để chống bot,
 * nên ta dùng DuckDuckGo HTML (no-JS endpoint) cho ổn định. DuckDuckGo
 * cho ra cùng tập kết quả web tương đương với "Google Search lite".
 */
async function searchGoogle(query) {
  if (!query || !query.trim()) {
    throw new Error('Query is required');
  }

  const got = await loadGotScraping();

  // Thêm "lời bài hát" để bias kết quả về các trang lyrics
  const searchQuery = `${query} lời bài hát`;

  const res = await got({
    url: 'https://html.duckduckgo.com/html/',
    method: 'POST',
    form: { q: searchQuery },
    headers: {
      ...COMMON_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: { request: 20000 },
  });

  const html = res.body;
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $('.result').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('.result__a').first();
    let href = $a.attr('href') || '';

    // DuckDuckGo đôi khi wrap link trong //duckduckgo.com/l/?uddg=<encoded>
    href = unwrapDuckDuckGoRedirect(href);

    if (!href || !/^https?:\/\//i.test(href)) return;
    if (BLACKLIST_HOSTS.test(href)) return;
    if (seen.has(href)) return;
    seen.add(href);

    const title = $a.text().trim();
    const snippet = $el.find('.result__snippet').first().text().trim();

    if (title) {
      results.push({ title, url: href, snippet });
    }
  });

  return results.slice(0, 10);
}

function unwrapDuckDuckGoRedirect(href) {
  if (!href) return href;
  // protocol-relative
  let abs = href.startsWith('//') ? 'https:' + href : href;
  if (!/duckduckgo\.com\/l\//i.test(abs)) return href;
  try {
    const u = new URL(abs);
    const real = u.searchParams.get('uddg');
    return real ? decodeURIComponent(real) : href;
  } catch (_) {
    return href;
  }
}

/**
 * Tải nội dung URL và cố gắng trích xuất lyrics
 */
async function fetchLyrics(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('URL không hợp lệ');
  }

  const got = await loadGotScraping();

  const res = await got({
    url,
    headers: COMMON_HEADERS,
    timeout: { request: 25000 },
  });

  const html = res.body;
  const $ = cheerio.load(html);

  // Bóc tách title bài hát: ưu tiên og:title hoặc <title>
  let pageTitle = $('meta[property="og:title"]').attr('content') ||
                  $('meta[name="twitter:title"]').attr('content') ||
                  $('title').text().trim();
  pageTitle = (pageTitle || '').trim();

  // Cố tách "Tên bài - Ca sĩ" hoặc "Lời bài hát XYZ - Ca sĩ"
  let title = pageTitle;
  let artist = '';
  const tMatch = pageTitle.match(/^(?:lời bài hát|lyrics?|hợp âm)\s*[:\-–]?\s*(.+?)\s*[-–|]\s*(.+?)(?:\s*[-–|].*)?$/i);
  if (tMatch) {
    title = tMatch[1].trim();
    artist = tMatch[2].trim();
  } else {
    const dashMatch = pageTitle.split(/\s+[-–|]\s+/);
    if (dashMatch.length >= 2) {
      title = dashMatch[0].trim();
      artist = dashMatch[1].trim();
    }
  }

  // Loại bỏ scripts/styles để không làm nhiễu khi tách text
  $('script, style, noscript, iframe').remove();

  // Thử các selector thường gặp ở các trang lyrics phổ biến
  const candidates = [
    '.lyric-content', '.lyric_content', '.lyric',  // chung
    '#fulllyric', '#lyric-body', '#lyric_details', '.lyric-original', // nhaccuatui, zing variants
    '.song-lyric', '.song-lyrics', '.song_lyric',
    'div[itemprop="lyrics"]',
    '.entry-content', '.post-content', '.content-lyric',
    '#article-lyrics', '.lyrics', '#lyrics',
    '.lyric-detail', '.lyric_detail',
    // Genius / azlyrics / generic
    '[data-lyrics-container]', '.Lyrics__Container',
  ];

  let lyrics = '';
  for (const sel of candidates) {
    const $node = $(sel).first();
    if ($node.length) {
      const text = extractTextPreservingLineBreaks($, $node);
      if (text && text.split('\n').length >= 4 && text.length >= 80) {
        lyrics = text;
        break;
      }
    }
  }

  // Fallback: tìm khối <div> hoặc <p> có nhiều dòng nhất (giống lyrics)
  if (!lyrics) {
    let best = '';
    $('div, article, section, pre').each((_, el) => {
      const $el = $(el);
      // Skip nếu chứa nhiều block elements (chứng tỏ là layout, không phải lyrics)
      if ($el.find('div, article, section, header, footer, nav, ul, table').length > 3) return;
      const text = extractTextPreservingLineBreaks($, $el);
      if (!text) return;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 6) return;
      if (text.length < 150) return;
      if (text.length > 6000) return;
      // Heuristic: lyrics có nhiều dòng ngắn
      const avgLen = lines.reduce((s, l) => s + l.length, 0) / lines.length;
      if (avgLen > 120) return;
      if (text.length > best.length) best = text;
    });
    if (best) lyrics = best;
  }

  // Cleanup
  lyrics = (lyrics || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();

  if (!lyrics) {
    throw new Error('Không thể trích xuất lời bài hát từ trang này. Hãy thử kết quả khác hoặc dán lời thủ công.');
  }

  return { title, artist, lyrics, sourceUrl: url };
}

/**
 * Trích xuất text từ một node giữ nguyên xuống dòng (br -> \n, block -> \n)
 */
function extractTextPreservingLineBreaks($, $node) {
  // Replace <br> bằng newline
  $node.find('br').replaceWith('\n');
  // Block-level elements -> thêm newline
  $node.find('p, div, li').each((_, el) => {
    const $el = $(el);
    $el.append('\n');
  });
  let text = $node.text();
  // Normalize whitespace nhưng giữ line breaks
  text = text.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

module.exports = {
  searchGoogle,
  fetchLyrics,
};

/**
 * Lọc ảnh quảng cáo theo nội dung (perceptual hash).
 *
 * Nguồn truyện chèn banner quảng bá domain (TOPTRUYENZONE…, TComic…) vào đầu
 * và cuối chương, nhưng mỗi chương upload lại thành một file riêng nên lọc
 * theo URL không bắt được. Module này tải vài ảnh ở hai đầu chương, tính dHash
 * 256-bit rồi so với danh sách hash quảng cáo đã biết trong
 * junk-image-hashes.json (sinh từ đợt quét DB 2026-10).
 *
 * Fail-open: ảnh tải/giải mã lỗi thì giữ lại, không bao giờ chặn crawl.
 */

const sharp = require('sharp');
const { refererCandidates, rememberReferer } = require('./referer');

const JUNK_HASHES = require('./junk-image-hashes.json').map(h => Buffer.from(h, 'hex'));

// Hamming tối đa để coi là cùng một ảnh quảng cáo (trên 256 bit).
const MAX_DISTANCE = 30;
// Ảnh gần như trắng/đen trơn có dHash ít bit 1, dễ trùng nhầm với nhau -> bỏ qua.
const MIN_POPCOUNT = 64;
// Số ảnh kiểm tra ở mỗi đầu chương (quảng cáo chỉ nằm ở đầu/cuối).
const EDGE_COUNT = 2;

const POPCOUNT = new Uint8Array(256).map((_, i) => {
  let c = 0;
  for (let v = i; v; v >>= 1) c += v & 1;
  return c;
});

function popcount(buf) {
  let c = 0;
  for (const b of buf) c += POPCOUNT[b];
  return c;
}

function isKnownJunkHash(hash) {
  if (popcount(hash) < MIN_POPCOUNT) return false;
  return JUNK_HASHES.some(junk => {
    let d = 0;
    for (let i = 0; i < hash.length && d <= MAX_DISTANCE; i++) d += POPCOUNT[junk[i] ^ hash[i]];
    return d <= MAX_DISTANCE;
  });
}

async function fetchImage(url, chapterUrl) {
  for (const ref of refererCandidates(url, chapterUrl)) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': ref,
        },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        rememberReferer(url, ref);
        return Buffer.from(await res.arrayBuffer());
      }
      if (res.status !== 403 && res.status !== 503) return null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

/** dHash 256-bit: 16 hàng × 16 phép so sánh pixel liền kề trên ảnh xám 17×16. */
async function dHash(buf) {
  const px = await sharp(buf).greyscale().resize(17, 16, { fit: 'fill' }).raw().toBuffer();
  const out = Buffer.alloc(32);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (px[y * 17 + x] > px[y * 17 + x + 1]) out[y * 2 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

async function isJunkByContent(url, chapterUrl) {
  const buf = await fetchImage(url, chapterUrl);
  if (!buf) return false;
  try {
    return isKnownJunkHash(await dHash(buf));
  } catch (_) {
    return false;
  }
}

/**
 * Bỏ các ảnh quảng cáo ở đầu/cuối chương.
 * @param {string[]} images danh sách URL ảnh theo thứ tự
 * @param {string} [chapterUrl] URL chapter, dùng làm Referer dự phòng
 * @returns {Promise<string[]>}
 */
async function filterJunkByContent(images, chapterUrl) {
  if (!images.length) return images;
  const edge = new Set();
  for (let i = 0; i < Math.min(EDGE_COUNT, images.length); i++) {
    edge.add(i);
    edge.add(images.length - 1 - i);
  }
  const idx = [...edge];
  const junk = await Promise.all(idx.map(i => isJunkByContent(images[i], chapterUrl)));
  const drop = new Set(idx.filter((_, k) => junk[k]));
  return images.filter((_, i) => !drop.has(i));
}

module.exports = { filterJunkByContent, dHash, isKnownJunkHash };

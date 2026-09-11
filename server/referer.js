/**
 * Chọn Referer khi tải ảnh từ CDN truyện.
 *
 * CDN anhvip.xyz (ảnh của TopTruyen) bật hotlink protection ở tầng Cloudflare:
 * chỉ chấp nhận Referer thuộc domain TopTruyen đang sống. Domain cũ đã chết
 * (toptruyenssi.com giờ redirect về Google) nên mọi request kèm Referer cũ
 * — hoặc không có Referer — đều bị trả 403.
 *
 * Vì domain nguồn đổi vài tháng một lần, module giữ một danh sách ứng viên và
 * thử lần lượt khi gặp 403, rồi ghi nhớ cái nào work cho từng host ảnh.
 * Muốn thêm domain mới mà không sửa code: đặt env COMIC_REFERER
 * (nhiều domain ngăn cách bằng dấu phẩy).
 */

const ENV_REFERERS = (process.env.COMIC_REFERER || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(s => (/^https?:/i.test(s) ? s : `https://${s}`))
  .map(s => (s.endsWith('/') ? s : `${s}/`));

// Domain TopTruyen được CDN anhvip.xyz chấp nhận (kiểm chứng 2026-08-03).
const TOPTRUYEN_REFERERS = [
  'https://www.toptruyenzone9.com/',
  'https://www.toptruyenzone7.com/',
  'https://www.toptruyenzone.com/',
];

const TCOMIC_REFERERS = ['https://tcomicfanq.com/'];

// host ảnh -> referer đã tải thành công gần nhất, để lần sau đi thẳng.
const workingReferer = new Map();

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return '';
  }
}

/**
 * Danh sách Referer nên thử cho một ảnh, theo thứ tự ưu tiên.
 * @param {string} imageUrl URL ảnh cần tải
 * @param {string} [chapterUrl] URL chapter gốc (nếu còn sống thì ưu tiên)
 * @returns {string[]}
 */
function refererCandidates(imageUrl, chapterUrl) {
  const host = hostOf(imageUrl);
  const list = [];

  const remembered = workingReferer.get(host);
  if (remembered) list.push(remembered);

  list.push(...ENV_REFERERS);

  if (/tcomic\.top|wasabisys\.com/i.test(host)) {
    list.push(...TCOMIC_REFERERS);
  } else {
    // Chapter URL chỉ dùng được khi domain nguồn còn sống — với anhvip.xyz nó
    // thường là domain cũ đã chết nên xếp sau danh sách domain đã kiểm chứng.
    list.push(...TOPTRUYEN_REFERERS);
    if (chapterUrl && /^https?:/i.test(chapterUrl)) list.push(chapterUrl);
  }

  return [...new Set(list)];
}

/** Referer đầu tiên nên thử (dùng cho code chỉ cần một giá trị). */
function pickReferer(imageUrl, chapterUrl) {
  return refererCandidates(imageUrl, chapterUrl)[0];
}

/** Ghi nhớ referer đã tải thành công cho host ảnh này. */
function rememberReferer(imageUrl, referer) {
  const host = hostOf(imageUrl);
  if (host && referer) workingReferer.set(host, referer);
}

module.exports = { refererCandidates, pickReferer, rememberReferer };

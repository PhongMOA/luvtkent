const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// Use npm-installed ffmpeg/ffprobe binaries instead of system PATH
let FFMPEG_PATH = 'ffmpeg';
let FFPROBE_PATH = 'ffprobe';
try {
  FFMPEG_PATH = require('@ffmpeg-installer/ffmpeg').path;
  console.log(`[TAB] Using ffmpeg from npm: ${FFMPEG_PATH}`);
} catch (_) {}
try {
  FFPROBE_PATH = require('@ffprobe-installer/ffprobe').path;
  console.log(`[TAB] Using ffprobe from npm: ${FFPROBE_PATH}`);
} catch (_) {}

const TAB_JOBS_DIR = path.join(__dirname, '..', 'downloads', 'tab-jobs');

/**
 * Parse start time from YouTube URL (?t=91s or &t=91 or &t=1m30s)
 * Returns seconds or 0 if not found
 */
function parseStartTime(url) {
  try {
    const u = new URL(url);
    const t = u.searchParams.get('t');
    if (!t) return 0;
    // Format: "91s", "91", "1m30s", "1h2m30s"
    const hMatch = t.match(/(\d+)h/);
    const mMatch = t.match(/(\d+)m/);
    const sMatch = t.match(/(\d+)s?$/);
    let secs = 0;
    if (hMatch) secs += parseInt(hMatch[1]) * 3600;
    if (mMatch) secs += parseInt(mMatch[1]) * 60;
    if (sMatch && !mMatch && !hMatch) {
      // Just a number like "91" or "91s"
      secs = parseInt(sMatch[1]);
    } else if (sMatch) {
      secs += parseInt(sMatch[1]);
    }
    return secs;
  } catch (_) {
    return 0;
  }
}

// Ensure base dir exists
if (!fs.existsSync(TAB_JOBS_DIR)) {
  fs.mkdirSync(TAB_JOBS_DIR, { recursive: true });
}

/**
 * Check if yt-dlp and ffmpeg are available
 */
async function checkDependencies() {
  const results = { ytdlp: false, ffmpeg: false };

  try {
    await new Promise((resolve, reject) => {
      execFile('yt-dlp', ['--version'], (err) => err ? reject(err) : resolve());
    });
    results.ytdlp = true;
  } catch (_) {}

  try {
    await new Promise((resolve, reject) => {
      execFile(FFMPEG_PATH, ['-version'], (err) => err ? reject(err) : resolve());
    });
    results.ffmpeg = true;
  } catch (_) {}

  return results;
}

/**
 * Get video title from YouTube URL
 */
async function getVideoTitle(url) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', ['--get-title', '--no-warnings', url], { timeout: 30000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

/**
 * Download video from YouTube (360p max, 10 min max)
 */
async function downloadVideo(url, outputPath, onProgress) {
  const outputDir = path.dirname(outputPath);
  const outputBase = path.basename(outputPath, path.extname(outputPath));

  return new Promise((resolve, reject) => {
    const args = [
      '-f', 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/bestvideo[height<=360]+bestaudio/best',
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', path.dirname(FFMPEG_PATH),
      '-o', outputPath,
      '--newline',
      url,
    ];

    console.log(`[TAB] yt-dlp args: ${args.join(' ')}`);
    const proc = spawn('yt-dlp', args);
    let stderr = '';
    let stdout = '';

    proc.stdout.on('data', (data) => {
      const line = data.toString();
      stdout += line;
      const match = line.match(/(\d+\.?\d*)%/);
      if (match && onProgress) {
        onProgress({ percent: parseFloat(match[1]) });
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      console.log(`[TAB] yt-dlp exit code: ${code}`);
      if (stderr) console.log(`[TAB] yt-dlp stderr: ${stderr.slice(-300)}`);

      // yt-dlp may have saved with different extension, find the actual file
      const files = fs.readdirSync(outputDir).filter(f => f.startsWith(outputBase) || f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm'));
      console.log(`[TAB] Files in job dir: ${files.join(', ')}`);

      if (files.length > 0) {
        const actualFile = path.join(outputDir, files[0]);
        // Rename to expected path if different
        if (actualFile !== outputPath && fs.existsSync(actualFile)) {
          try { fs.renameSync(actualFile, outputPath); } catch (_) {}
        }
      }

      if (!fs.existsSync(outputPath)) {
        // Try any video file in the directory
        const allFiles = fs.readdirSync(outputDir).filter(f => /\.(mp4|mkv|webm|m4a)$/i.test(f));
        if (allFiles.length > 0) {
          fs.renameSync(path.join(outputDir, allFiles[0]), outputPath);
        }
      }

      if (code !== 0 && !fs.existsSync(outputPath)) {
        return reject(new Error(`yt-dlp failed (code ${code}): ${stderr.slice(-200)}`));
      }

      if (!fs.existsSync(outputPath)) {
        return reject(new Error('yt-dlp completed but video file not found'));
      }

      console.log(`[TAB] Video saved: ${outputPath} (${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)} MB)`);
      resolve(outputPath);
    });

    proc.on('error', reject);
  });
}

/**
 * Extract frames from video using ffmpeg (1 frame per second)
 */
async function extractFrames(videoPath, framesDir, onProgress, startTime = 0) {
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }

  // First get video duration
  const duration = await getVideoDuration(videoPath);

  return new Promise((resolve, reject) => {
    const outputPattern = path.join(framesDir, 'frame_%04d.jpg');
    const args = [];

    // Skip intro: seek to start time
    if (startTime > 0) {
      const h = Math.floor(startTime / 3600);
      const m = Math.floor((startTime % 3600) / 60);
      const s = startTime % 60;
      args.push('-ss', `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      console.log(`[TAB] Skipping first ${startTime}s of video`);
    }

    args.push(
      '-i', videoPath,
      '-vf', 'fps=1,scale=640:-2',
      '-q:v', '3',
      '-y',
      outputPattern,
    );

    console.log(`[TAB] ffmpeg cmd: ${FFMPEG_PATH} ${args.join(' ')}`);
    const proc = spawn(FFMPEG_PATH, args);
    let stderrBuf = '';

    proc.stderr.on('data', (data) => {
      const line = data.toString();
      stderrBuf += line;
      const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})/);
      if (timeMatch) {
        const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
        if (onProgress) {
          onProgress({ current: secs, total: Math.ceil(duration) });
        }
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`[TAB] ffmpeg failed (code ${code}). stderr tail:\n${stderrBuf.slice(-500)}`);
        return reject(new Error(`ffmpeg frame extraction failed (code ${code})`));
      }
      const frames = fs.readdirSync(framesDir).filter(f => f.startsWith('frame_') && f.endsWith('.jpg'));
      console.log(`[TAB] Extracted ${frames.length} frames`);
      resolve(frames.sort());
    });

    proc.on('error', reject);
  });
}

/**
 * Extract frames at specific timestamps (seconds)
 * Much faster than full scan - only captures the exact moments
 */
async function extractFramesAtTimestamps(videoPath, framesDir, timestamps, onProgress) {
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }

  const frames = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const outputFile = `frame_${String(i + 1).padStart(4, '0')}.jpg`;
    const outputPath = path.join(framesDir, outputFile);

    // Format timestamp as HH:MM:SS
    const h = Math.floor(ts / 3600);
    const m = Math.floor((ts % 3600) / 60);
    const s = ts % 60;
    const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    await new Promise((resolve, reject) => {
      const args = [
        '-ss', timeStr,
        '-i', videoPath,
        '-vframes', '1',
        '-vf', 'scale=640:-2',
        '-q:v', '3',
        '-y',
        outputPath,
      ];

      const proc = spawn(FFMPEG_PATH, args);
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          frames.push(outputFile);
        }
        resolve();
      });
      proc.on('error', () => resolve());
    });

    if (onProgress) {
      onProgress({ current: i + 1, total: timestamps.length });
    }
  }

  console.log(`[TAB] Extracted ${frames.length}/${timestamps.length} frames at specific timestamps`);
  return frames.sort();
}

/**
 * Get video duration in seconds
 */
function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ];
    execFile(FFPROBE_PATH, args, (err, stdout) => {
      if (err) return resolve(300); // default 5 min
      resolve(parseFloat(stdout.trim()) || 300);
    });
  });
}

/**
 * Detect tablature region in a frame.
 *
 * Tablature characteristics (vs guitar strings in video):
 * - Tab overlay has a BRIGHT/WHITE background (mean brightness > 180)
 * - Tab lines span most of the frame width (>50%)
 * - Tab lines are thin, dark, on light background
 * - Guitar strings are on complex/dark background
 *
 * Algorithm:
 * 1. Grayscale, find horizontal bands where background is bright
 * 2. Within bright bands, detect thin horizontal lines
 * 3. Find 4-6 equally-spaced lines -> tab staff
 */
async function detectTabInFrame(framePath) {
  try {
    const ANALYSIS_WIDTH = 640;
    const image = sharp(framePath);
    const metadata = await image.metadata();

    const scale = ANALYSIS_WIDTH / metadata.width;
    const analysisHeight = Math.round(metadata.height * scale);

    const { data, info } = await sharp(framePath)
      .resize(ANALYSIS_WIDTH, analysisHeight)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;

    // Step 1: Compute row brightness (mean pixel value) and
    // horizontal line score (how many pixels are dark on a bright row)
    const rowBrightness = new Float32Array(height);
    const rowLineScore = new Float32Array(height);

    for (let y = 0; y < height; y++) {
      let sum = 0;
      let darkPixels = 0;
      for (let x = 0; x < width; x++) {
        const val = data[y * width + x];
        sum += val;
        if (val < 100) darkPixels++;
      }
      rowBrightness[y] = sum / width;

      // A "tab line row" = mostly bright but with a continuous dark line
      // Check: is this row within a bright region AND has a thin horizontal dark stripe?
      // We look for rows where: background is bright (>160) but this specific row
      // has many dark-ish pixels forming a line
      rowLineScore[y] = 0;
    }

    // Step 2: For each row, check if it could be a tab staff line:
    // A tab line = dark thin line on bright background
    // Check: the row itself is relatively dark compared to rows above/below
    for (let y = 2; y < height - 2; y++) {
      const above = (rowBrightness[y - 2] + rowBrightness[y - 1]) / 2;
      const below = (rowBrightness[y + 1] + rowBrightness[y + 2]) / 2;
      const current = rowBrightness[y];

      // Background (above & below) must be bright (tab overlay = white/light)
      if (above < 160 || below < 160) continue;

      // Current row should be darker than surroundings (it's a line)
      const dip = ((above + below) / 2) - current;
      if (dip < 15) continue;

      // Check the line spans most of the width
      // Count how many pixels in this row are significantly darker than their column's local background
      let linePixels = 0;
      for (let x = 10; x < width - 10; x++) {
        const bg = (data[(y - 2) * width + x] + data[(y + 2) * width + x]) / 2;
        const px = data[y * width + x];
        if (bg - px > 20 && bg > 140) {
          linePixels++;
        }
      }

      const lineRatio = linePixels / (width - 20);
      if (lineRatio > 0.4) {
        rowLineScore[y] = lineRatio * dip;
      }
    }

    // Step 3: Find rows with positive line scores
    const lineRows = [];
    for (let y = 0; y < height; y++) {
      if (rowLineScore[y] > 0) lineRows.push(y);
    }

    if (lineRows.length < 4) return null;

    // Step 4: Group nearby line rows into bands (within 3px)
    const lineBands = [];
    let bandStart = lineRows[0];
    let bandEnd = lineRows[0];

    for (let i = 1; i < lineRows.length; i++) {
      if (lineRows[i] - bandEnd <= 3) {
        bandEnd = lineRows[i];
      } else {
        lineBands.push({
          y: Math.round((bandStart + bandEnd) / 2),
          score: Math.max(...Array.from({ length: bandEnd - bandStart + 1 }, (_, k) => rowLineScore[bandStart + k] || 0)),
        });
        bandStart = lineRows[i];
        bandEnd = lineRows[i];
      }
    }
    lineBands.push({
      y: Math.round((bandStart + bandEnd) / 2),
      score: Math.max(...Array.from({ length: bandEnd - bandStart + 1 }, (_, k) => rowLineScore[bandStart + k] || 0)),
    });

    if (lineBands.length < 4) return null;

    // Step 5: Find groups of 4-6 equally-spaced lines
    let bestGroup = null;
    let bestScore = 0;

    for (let i = 0; i < lineBands.length - 3; i++) {
      for (let groupSize = 4; groupSize <= 6 && i + groupSize - 1 < lineBands.length; groupSize++) {
        const group = lineBands.slice(i, i + groupSize);
        const spacing = group[1].y - group[0].y;

        if (spacing < 6 || spacing > 35) continue;

        let isEquidistant = true;
        let totalDeviation = 0;
        for (let j = 1; j < group.length - 1; j++) {
          const gap = group[j + 1].y - group[j].y;
          const deviation = Math.abs(gap - spacing) / spacing;
          totalDeviation += deviation;
          if (deviation > 0.2) {
            isEquidistant = false;
            break;
          }
        }

        if (!isEquidistant) continue;

        // Verify the entire region between lines has bright background
        const regionTop = group[0].y;
        const regionBot = group[group.length - 1].y;
        let regionBrightness = 0;
        let count = 0;
        for (let y = regionTop; y <= regionBot; y++) {
          if (rowLineScore[y] === 0) { // non-line rows should be bright
            regionBrightness += rowBrightness[y];
            count++;
          }
        }
        const avgRegionBright = count > 0 ? regionBrightness / count : 0;
        if (avgRegionBright < 170) continue; // not bright enough = not a tab overlay

        const lineScoreSum = group.reduce((s, g) => s + g.score, 0);
        const score = groupSize * 10 + lineScoreSum - totalDeviation * 50 + avgRegionBright * 0.1;

        if (score > bestScore) {
          bestScore = score;
          bestGroup = group;
        }
      }
    }

    if (!bestGroup) return null;

    // Calculate bounding box
    // Tab with standard notation: notes are ABOVE the tab lines on bright background
    // Scan upward from the top tab line to find the full bright region (notation + tab)
    const staffSpacing = bestGroup[1].y - bestGroup[0].y;
    const tabTop = bestGroup[0].y;
    const tabBottom = bestGroup[bestGroup.length - 1].y;

    // Scan UP from tab top: find where the bright background starts (notation area)
    let brightTop = tabTop;
    for (let y = tabTop - 1; y >= 0; y--) {
      if (rowBrightness[y] > 140) {
        brightTop = y;
      } else {
        // Allow small dark gaps (note stems, etc) up to 4px
        if (y >= 4 && rowBrightness[y - 1] < 140 && rowBrightness[y - 2] < 140) {
          break;
        }
      }
    }

    // Scan DOWN from tab bottom: find where bright background ends
    let brightBottom = tabBottom;
    for (let y = tabBottom + 1; y < height; y++) {
      if (rowBrightness[y] > 140) {
        brightBottom = y;
      } else {
        if (y + 2 < height && rowBrightness[y + 1] < 140 && rowBrightness[y + 2] < 140) {
          break;
        }
      }
    }

    // Add small padding for safety
    const padTop = Math.max(0, brightTop - 4);
    const padBottom = Math.min(height, brightBottom + 4);

    return {
      top: Math.round(padTop / scale),
      bottom: Math.round(padBottom / scale),
      left: 0,
      right: metadata.width,
      lineCount: bestGroup.length,
      confidence: bestScore,
    };
  } catch (err) {
    console.error(`[TAB-DETECT] Error processing ${framePath}:`, err.message);
    return null;
  }
}

/**
 * Crop the tab region from a frame
 */
async function cropTabRegion(framePath, region) {
  const cropped = await sharp(framePath)
    .extract({
      left: region.left,
      top: region.top,
      width: region.right - region.left,
      height: region.bottom - region.top,
    })
    .jpeg({ quality: 90 })
    .toBuffer();
  return cropped;
}

/**
 * Compare two image buffers for similarity (pixel mean difference)
 * Returns similarity score 0-1 (1 = identical)
 */
async function imageSimilarity(bufA, bufB) {
  try {
    // Resize to same width (320px) keeping aspect ratio, then compare
    const WIDTH = 320;
    const [metaA, metaB] = await Promise.all([
      sharp(bufA).metadata(),
      sharp(bufB).metadata(),
    ]);

    // Use consistent height based on average
    const hA = Math.round(metaA.height * (WIDTH / metaA.width));
    const hB = Math.round(metaB.height * (WIDTH / metaB.width));
    const targetH = Math.min(hA, hB);

    const [a, b] = await Promise.all([
      sharp(bufA).resize(WIDTH, targetH, { fit: 'fill' }).grayscale().raw().toBuffer(),
      sharp(bufB).resize(WIDTH, targetH, { fit: 'fill' }).grayscale().raw().toBuffer(),
    ]);

    let diff = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      diff += Math.abs(a[i] - b[i]);
    }
    const avgDiff = diff / len / 255;
    return 1 - avgDiff;
  } catch (_) {
    return 0;
  }
}

/**
 * Deduplicate tab images - keep only unique tabs
 * threshold: similarity threshold (default 0.85, lower = keep more unique tabs)
 */
async function deduplicateTabs(tabImages, threshold = 0.85) {
  if (tabImages.length <= 1) return tabImages;

  // Compare each frame with the ANCHOR frame (first frame of current group).
  // When similarity drops below threshold, the tab has changed enough
  // → save the middle frame of the completed group and start a new group.
  // This handles gradual scrolling tabs where consecutive frames are 0.999 similar
  // but the tab content actually changes over 10-15 frames.
  const unique = [];
  let groupStart = 0;
  let anchorBuffer = tabImages[0].buffer;

  for (let i = 1; i <= tabImages.length; i++) {
    let changed = (i === tabImages.length);
    if (!changed) {
      const sim = await imageSimilarity(anchorBuffer, tabImages[i].buffer);
      changed = (sim < threshold);
    }

    if (changed) {
      // Group complete: groupStart..i-1, keep middle frame
      const mid = Math.floor((groupStart + (i - 1)) / 2);
      unique.push(tabImages[mid]);

      // Start new group
      if (i < tabImages.length) {
        groupStart = i;
        anchorBuffer = tabImages[i].buffer;
      }
    }
  }

  console.log(`[TAB] Deduplicate: ${tabImages.length} → ${unique.length} (threshold ${threshold})`);
  return unique;
}

/**
 * Stitch tab images vertically into one image
 */
async function stitchTabs(tabImages, outputPath) {
  if (tabImages.length === 0) throw new Error('Không tìm thấy tab nào trong video');

  const GAP = 6;

  // Get dimensions of each tab image
  const metas = await Promise.all(
    tabImages.map(t => sharp(t.buffer).metadata())
  );

  // Use max width, sum heights + gaps
  const maxWidth = Math.max(...metas.map(m => m.width));
  const totalHeight = metas.reduce((sum, m) => sum + m.height, 0) + GAP * (tabImages.length - 1);

  // Create blank white canvas
  const composites = [];
  let currentY = 0;

  for (let i = 0; i < tabImages.length; i++) {
    // Resize to max width if needed
    let buf = tabImages[i].buffer;
    if (metas[i].width < maxWidth) {
      buf = await sharp(buf)
        .extend({
          right: maxWidth - metas[i].width,
          background: { r: 255, g: 255, b: 255 },
        })
        .toBuffer();
    }

    composites.push({ input: buf, top: currentY, left: 0 });
    currentY += metas[i].height + GAP;
  }

  await sharp({
    create: {
      width: maxWidth,
      height: totalHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toFile(outputPath);

  return outputPath;
}

/**
 * Full pipeline: extract tabs from a YouTube video
 */
async function extractTabsFromVideo(youtubeUrl, jobId, onStatus, opts = {}) {
  const jobDir = path.join(TAB_JOBS_DIR, jobId);
  const videoPath = path.join(jobDir, 'video.mp4');
  const framesDir = path.join(jobDir, 'frames');
  const tabsDir = path.join(jobDir, 'tabs');
  const resultPath = path.join(jobDir, 'result.jpg');

  fs.mkdirSync(jobDir, { recursive: true });
  fs.mkdirSync(tabsDir, { recursive: true });

  // Step 1: Get video title
  onStatus({ status: 'downloading', progress: { step: 'Lấy thông tin video...', percent: 0 } });
  let videoTitle = 'Unknown';
  try {
    videoTitle = await getVideoTitle(youtubeUrl);
  } catch (_) {}

  // Step 2: Download video
  onStatus({ status: 'downloading', progress: { step: 'Đang tải video...', percent: 0 }, videoTitle });
  await downloadVideo(youtubeUrl, videoPath, (p) => {
    onStatus({ status: 'downloading', progress: { step: `Đang tải video... ${p.percent.toFixed(0)}%`, percent: p.percent }, videoTitle });
  });

  // Parse start time from URL (e.g. ?t=91s)
  const startTime = parseStartTime(youtubeUrl);
  if (startTime > 0) {
    console.log(`[TAB] URL has start time: ${startTime}s`);
  }

  // Step 3: Extract frames
  let frames;
  if (opts.timestamps && opts.timestamps.length > 0) {
    // Extract frames at specific timestamps only
    onStatus({ status: 'extracting', progress: { step: `Đang chụp ${opts.timestamps.length} thời điểm...`, current: 0, total: opts.timestamps.length }, videoTitle });
    frames = await extractFramesAtTimestamps(videoPath, framesDir, opts.timestamps, (p) => {
      onStatus({ status: 'extracting', progress: { step: `Đang chụp frame ${p.current}/${p.total}...`, current: p.current, total: p.total }, videoTitle });
    });
  } else {
    // Full scan: 1 frame per second (skip intro if t= param present)
    const skipMsg = startTime > 0 ? ` (bỏ qua ${startTime}s đầu)` : '';
    onStatus({ status: 'extracting', progress: { step: `Đang trích xuất frames...${skipMsg}`, current: 0, total: 0 }, videoTitle });
    frames = await extractFrames(videoPath, framesDir, (p) => {
      onStatus({ status: 'extracting', progress: { step: `Đang trích xuất frames... (${p.current}/${p.total}s)${skipMsg}`, current: p.current, total: p.total }, videoTitle });
    }, startTime);
  }

  // Delete video to save space
  try { fs.unlinkSync(videoPath); } catch (_) {}

  // Step 4: Detect tabs in each frame
  const tabImages = [];
  for (let i = 0; i < frames.length; i++) {
    onStatus({
      status: 'detecting',
      progress: { step: `Đang phân tích frame ${i + 1}/${frames.length}...`, current: i + 1, total: frames.length },
      videoTitle,
    });

    const framePath = path.join(framesDir, frames[i]);
    const region = await detectTabInFrame(framePath);

    if (region) {
      const buffer = await cropTabRegion(framePath, region);
      const tabPath = path.join(tabsDir, `tab_${String(tabImages.length + 1).padStart(3, '0')}.jpg`);
      fs.writeFileSync(tabPath, buffer);
      tabImages.push({ buffer, path: tabPath, frameIndex: i, region });
    }
  }

  // Delete frames to save space
  try {
    const frameFiles = fs.readdirSync(framesDir);
    frameFiles.forEach(f => fs.unlinkSync(path.join(framesDir, f)));
    fs.rmdirSync(framesDir);
  } catch (_) {}

  if (tabImages.length === 0) {
    throw new Error('Không tìm thấy khuôn nhạc/tab nào trong video. Thử video có tablature hiển thị rõ trên màn hình.');
  }

  // Step 5: Deduplicate
  onStatus({
    status: 'stitching',
    progress: { step: `Đang loại bỏ tab trùng... (${tabImages.length} tabs phát hiện)` },
    videoTitle,
  });
  const dedupThreshold = opts.sensitivity === 'high' ? 0.95 : opts.sensitivity === 'low' ? 0.88 : 0.92;
  const uniqueTabs = await deduplicateTabs(tabImages, dedupThreshold);

  // Step 6: Stitch into one image
  onStatus({
    status: 'stitching',
    progress: { step: `Đang ghép ${uniqueTabs.length} tabs thành ảnh...` },
    videoTitle,
  });
  await stitchTabs(uniqueTabs, resultPath);

  // Save individual tab images for reference, cleanup tab buffers
  const tabPaths = uniqueTabs.map(t => t.path);

  return {
    resultPath,
    videoTitle,
    tabCount: uniqueTabs.length,
    totalFrames: frames.length,
    detectedFrames: tabImages.length,
    tabPaths,
  };
}

/**
 * Cleanup a job's temp files
 */
function cleanupJob(jobId) {
  const jobDir = path.join(TAB_JOBS_DIR, jobId);
  if (fs.existsSync(jobDir)) {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

/**
 * Auto-cleanup old jobs (older than 1 hour)
 */
function startAutoCleanup() {
  setInterval(() => {
    if (!fs.existsSync(TAB_JOBS_DIR)) return;
    const dirs = fs.readdirSync(TAB_JOBS_DIR);
    const now = Date.now();
    dirs.forEach(dir => {
      const dirPath = path.join(TAB_JOBS_DIR, dir);
      try {
        const stat = fs.statSync(dirPath);
        if (now - stat.mtimeMs > 3600000) {
          fs.rmSync(dirPath, { recursive: true, force: true });
          console.log(`[TAB] Auto-cleaned job: ${dir}`);
        }
      } catch (_) {}
    });
  }, 600000); // check every 10 minutes
}

/**
 * Extract a single preview frame from the middle of the video
 * Used for manual region selection UI
 */
async function extractPreviewFrame(youtubeUrl, jobId, onStatus) {
  const jobDir = path.join(TAB_JOBS_DIR, jobId);
  const videoPath = path.join(jobDir, 'video.mp4');
  const previewPath = path.join(jobDir, 'preview.jpg');

  fs.mkdirSync(jobDir, { recursive: true });

  // Step 1: Get video title
  onStatus({ status: 'downloading', progress: { step: 'Lấy thông tin video...' } });
  let videoTitle = 'Unknown';
  try {
    videoTitle = await getVideoTitle(youtubeUrl);
  } catch (_) {}

  // Step 2: Download video
  onStatus({ status: 'downloading', progress: { step: 'Đang tải video...', percent: 0 }, videoTitle });
  await downloadVideo(youtubeUrl, videoPath, (p) => {
    onStatus({ status: 'downloading', progress: { step: `Đang tải video... ${p.percent.toFixed(0)}%`, percent: p.percent }, videoTitle });
  });

  // Step 3: Get duration and extract preview frame
  // If URL has t= param, use that time; otherwise use middle of video
  const duration = await getVideoDuration(videoPath);
  const urlStartTime = parseStartTime(youtubeUrl);
  const middleTime = urlStartTime > 0 ? urlStartTime : Math.floor(duration / 2);
  const h = Math.floor(middleTime / 3600);
  const m = Math.floor((middleTime % 3600) / 60);
  const s = middleTime % 60;
  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  onStatus({ status: 'extracting', progress: { step: 'Đang chụp frame mẫu...' }, videoTitle });

  await new Promise((resolve, reject) => {
    const args = ['-ss', timeStr, '-i', videoPath, '-vframes', '1', '-q:v', '2', '-y', previewPath];
    const proc = spawn(FFMPEG_PATH, args);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(previewPath)) resolve();
      else reject(new Error('Không thể trích xuất frame mẫu'));
    });
    proc.on('error', reject);
  });

  // Get preview image dimensions
  const meta = await sharp(previewPath).metadata();

  return { videoTitle, previewPath, duration, width: meta.width, height: meta.height };
}

/**
 * Extract tabs using manual region (no auto-detection)
 * Region is applied to all frames, then deduplicate + stitch
 */
async function extractTabsWithRegion(youtubeUrl, jobId, region, onStatus, opts = {}) {
  const jobDir = path.join(TAB_JOBS_DIR, jobId);
  const videoPath = path.join(jobDir, 'video.mp4');
  const framesDir = path.join(jobDir, 'frames');
  const tabsDir = path.join(jobDir, 'tabs');
  const resultPath = path.join(jobDir, 'result.jpg');

  fs.mkdirSync(tabsDir, { recursive: true });

  // Video should already exist from preview step
  // If not, download again
  if (!fs.existsSync(videoPath)) {
    onStatus({ status: 'downloading', progress: { step: 'Đang tải video...' } });
    let videoTitle = 'Unknown';
    try { videoTitle = await getVideoTitle(youtubeUrl); } catch (_) {}
    await downloadVideo(youtubeUrl, videoPath, (p) => {
      onStatus({ status: 'downloading', progress: { step: `Đang tải video... ${p.percent.toFixed(0)}%`, percent: p.percent }, videoTitle });
    });
  }

  // Get video title from job data
  let videoTitle = opts.videoTitle || 'Unknown';

  // Parse start time from URL
  const startTime = parseStartTime(youtubeUrl);
  if (startTime > 0) console.log(`[TAB] URL has start time: ${startTime}s`);

  // Step 1: Extract frames
  let frames;
  if (opts.timestamps && opts.timestamps.length > 0) {
    onStatus({ status: 'extracting', progress: { step: `Đang chụp ${opts.timestamps.length} thời điểm...`, current: 0, total: opts.timestamps.length }, videoTitle });
    frames = await extractFramesAtTimestamps(videoPath, framesDir, opts.timestamps, (p) => {
      onStatus({ status: 'extracting', progress: { step: `Đang chụp frame ${p.current}/${p.total}...`, current: p.current, total: p.total }, videoTitle });
    });
  } else {
    const skipMsg = startTime > 0 ? ` (bỏ qua ${startTime}s đầu)` : '';
    onStatus({ status: 'extracting', progress: { step: `Đang trích xuất frames...${skipMsg}`, current: 0, total: 0 }, videoTitle });
    frames = await extractFrames(videoPath, framesDir, (p) => {
      onStatus({ status: 'extracting', progress: { step: `Đang trích xuất frames... (${p.current}/${p.total}s)${skipMsg}`, current: p.current, total: p.total }, videoTitle });
    }, startTime);
  }

  // Delete video to save space
  try { fs.unlinkSync(videoPath); } catch (_) {}
  // Also delete preview if exists
  try { fs.unlinkSync(path.join(jobDir, 'preview.jpg')); } catch (_) {}

  // Step 2: Crop all frames using the manual region
  const tabImages = [];
  for (let i = 0; i < frames.length; i++) {
    onStatus({
      status: 'detecting',
      progress: { step: `Đang crop frame ${i + 1}/${frames.length}...`, current: i + 1, total: frames.length },
      videoTitle,
    });

    const framePath = path.join(framesDir, frames[i]);
    try {
      // Get frame dimensions to scale region correctly
      const frameMeta = await sharp(framePath).metadata();
      const scaleX = frameMeta.width / region.sourceWidth;
      const scaleY = frameMeta.height / region.sourceHeight;

      const cropRegion = {
        left: Math.max(0, Math.round(region.left * scaleX)),
        top: Math.max(0, Math.round(region.top * scaleY)),
        width: Math.round(region.width * scaleX),
        height: Math.round(region.height * scaleY),
      };

      // Clamp to frame bounds
      cropRegion.width = Math.min(cropRegion.width, frameMeta.width - cropRegion.left);
      cropRegion.height = Math.min(cropRegion.height, frameMeta.height - cropRegion.top);

      if (cropRegion.width > 10 && cropRegion.height > 10) {
        const buffer = await sharp(framePath)
          .extract(cropRegion)
          .jpeg({ quality: 90 })
          .toBuffer();

        const tabPath = path.join(tabsDir, `tab_${String(tabImages.length + 1).padStart(3, '0')}.jpg`);
        fs.writeFileSync(tabPath, buffer);
        tabImages.push({ buffer, path: tabPath, frameIndex: i });
      }
    } catch (err) {
      console.error(`[TAB] Crop error frame ${i}:`, err.message);
    }
  }

  // Cleanup frames
  try {
    const frameFiles = fs.readdirSync(framesDir);
    frameFiles.forEach(f => fs.unlinkSync(path.join(framesDir, f)));
    fs.rmdirSync(framesDir);
  } catch (_) {}

  if (tabImages.length === 0) {
    throw new Error('Không crop được frame nào. Vui lòng thử lại với vùng chọn khác.');
  }

  // Step 3: Deduplicate
  onStatus({
    status: 'stitching',
    progress: { step: `Đang loại bỏ tab trùng... (${tabImages.length} crops)` },
    videoTitle,
  });
  const dedupThreshold = opts.sensitivity === 'high' ? 0.95 : opts.sensitivity === 'low' ? 0.88 : 0.92;
  const uniqueTabs = await deduplicateTabs(tabImages, dedupThreshold);

  // Step 4: Stitch
  onStatus({
    status: 'stitching',
    progress: { step: `Đang ghép ${uniqueTabs.length} tabs thành ảnh...` },
    videoTitle,
  });
  await stitchTabs(uniqueTabs, resultPath);

  return {
    resultPath,
    videoTitle,
    tabCount: uniqueTabs.length,
    totalFrames: frames.length,
    detectedFrames: tabImages.length,
  };
}

module.exports = {
  checkDependencies,
  extractTabsFromVideo,
  extractPreviewFrame,
  extractTabsWithRegion,
  cleanupJob,
  startAutoCleanup,
  TAB_JOBS_DIR,
};

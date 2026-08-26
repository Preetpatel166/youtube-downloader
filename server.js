const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = process.env.PORT || 3000;

// Dynamic tool path resolution: prefer local bundled tools if present, otherwise system binary
function resolveTool(toolName, winExeName) {
  const localWinPath = path.join(__dirname, 'tools', winExeName);
  if (fs.existsSync(localWinPath)) return localWinPath;

  const localLinuxPath = path.join(__dirname, 'tools', toolName);
  if (fs.existsSync(localLinuxPath)) return localLinuxPath;

  return toolName; // In system PATH (e.g. Linux on Render / Docker)
}

const YTDLP_PATH = resolveTool('yt-dlp', 'yt-dlp.exe');
const FFMPEG_PATH = resolveTool('ffmpeg', 'ffmpeg.exe');

// Cross-platform downloads directory
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || (
  process.platform === 'win32'
    ? path.join(os.homedir(), 'Downloads')
    : path.join(__dirname, 'downloads')
);

if (!fs.existsSync(DOWNLOADS_DIR)) {
  try { fs.mkdirSync(DOWNLOADS_DIR, { recursive: true }); } catch (_) {}
}

const COOKIES_PATH = path.join(__dirname, 'cookies.txt');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: get cookies args if cookies.txt exists
function getCookiesArgs() {
  if (fs.existsSync(COOKIES_PATH)) {
    return ['--cookies', COOKIES_PATH];
  }
  return [];
}

// Global active jobs store
const jobs = {};

// ─────────────────────────────────────────────
// POST /api/upload-cookies
// ─────────────────────────────────────────────
app.post('/api/upload-cookies', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'No content provided' });
  try {
    fs.writeFileSync(COOKIES_PATH, content, 'utf8');
    res.json({ status: 'saved', path: COOKIES_PATH });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save cookies: ' + e.message });
  }
});

// GET /api/cookies-status
app.get('/api/cookies-status', (req, res) => {
  const exists = fs.existsSync(COOKIES_PATH);
  let size = 0;
  if (exists) {
    try { size = fs.statSync(COOKIES_PATH).size; } catch (_) {}
  }
  res.json({ exists, size });
});

// DELETE /api/cookies
app.delete('/api/cookies', (req, res) => {
  try {
    if (fs.existsSync(COOKIES_PATH)) fs.unlinkSync(COOKIES_PATH);
    res.json({ status: 'deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/playlist-info?url=... & /api/info?url=...
// ─────────────────────────────────────────────
function handleFetchInfo(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const isPlaylistUrl = url.includes('list=') || url.includes('/playlist') || url.includes('/channel/') || url.includes('/c/');

  const args = [
    ...(isPlaylistUrl ? ['--flat-playlist'] : ['--no-playlist']),
    '--dump-single-json',
    '--no-warnings',
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=android,web',
    ...getCookiesArgs(),
    url
  ];

  const proc = spawn(YTDLP_PATH, args);
  let output = '';
  let errOutput = '';

  proc.stdout.on('data', (d) => { output += d.toString(); });
  proc.stderr.on('data', (d) => { errOutput += d.toString(); });

  proc.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: 'Failed to fetch video or playlist info', details: errOutput });
    }
    try {
      const data = JSON.parse(output);
      const isPlaylist = data._type === 'playlist' || (Array.isArray(data.entries) && data.entries.length > 0);

      if (isPlaylist) {
        const videos = (data.entries || []).map((v, i) => ({
          index: i + 1,
          id: v.id,
          title: v.title || `Video ${i + 1}`,
          duration: v.duration,
          thumbnail: v.thumbnails?.[0]?.url || (v.id ? `https://img.youtube.com/vi/${v.id}/mqdefault.jpg` : ''),
          url: v.url || (v.id ? `https://www.youtube.com/watch?v=${v.id}` : url)
        }));
        res.json({
          isPlaylist: true,
          title: data.title || 'YouTube Playlist',
          id: data.id,
          count: videos.length,
          videos
        });
      } else {
        const videoId = data.id || '';
        const videoTitle = data.title || 'YouTube Video';
        const thumb = data.thumbnail || (data.thumbnails && data.thumbnails.length ? data.thumbnails[data.thumbnails.length - 1].url : '') || (videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : '');
        res.json({
          isPlaylist: false,
          title: videoTitle,
          id: videoId,
          uploader: data.uploader || data.channel || '',
          duration: data.duration || 0,
          thumbnail: thumb,
          count: 1,
          videos: [{
            index: 1,
            id: videoId,
            title: videoTitle,
            duration: data.duration || 0,
            thumbnail: thumb,
            url: data.webpage_url || data.url || url
          }]
        });
      }
    } catch (e) {
      res.status(500).json({ error: 'Failed to parse data', details: e.message });
    }
  });
}

app.get('/api/playlist-info', handleFetchInfo);
app.get('/api/info', handleFetchInfo);

// ─────────────────────────────────────────────
// POST /api/download
// ─────────────────────────────────────────────
app.post('/api/download', (req, res) => {
  const { url, quality, playlistTitle, jobId, isSingleVideo } = req.body;
  if (!url || !jobId) return res.status(400).json({ error: 'URL and jobId are required' });

  const safeJobId = (jobId || 'job').replace(/[<>:"/\\|?*]/g, '');
  let outputDir;
  let outputTemplate;

  if (isSingleVideo) {
    outputDir = path.resolve(DOWNLOADS_DIR, 'YouTube Downloads');
    outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');
  } else {
    // Create clean folder name for this specific playlist
    const safeName = (playlistTitle || 'YouTube Playlist')
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 60) || 'YouTube Playlist';

    outputDir = path.resolve(DOWNLOADS_DIR, safeName);
    outputTemplate = path.join(outputDir, '%(playlist_index|autonumber)02d - %(title)s.%(ext)s');
  }

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Format selectors with resilient fallbacks prioritizing H.264 + AAC for 100% Windows playback compatibility
  let formatArg;
  switch (quality) {
    case '4k':
      formatArg = 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best';
      break;
    case '1440p':
      formatArg = 'bestvideo[height<=1440]+bestaudio/best[height<=1440]/best';
      break;
    case '1080p':
      formatArg = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
      break;
    case '720p':
      formatArg = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
      break;
    case '480p':
      formatArg = 'bestvideo[height<=480]+bestaudio/best[height<=480]/best';
      break;
    case '360p':
      formatArg = 'bestvideo[height<=360]+bestaudio/best[height<=360]/best';
      break;
    case 'audio':
      formatArg = 'bestaudio[ext=m4a]/bestaudio/best';
      break;
    default:
      formatArg = 'bestvideo+bestaudio/best';
  }

  const args = [
    '--ffmpeg-location', FFMPEG_PATH,
    '--format', formatArg,
    '--output', outputTemplate,
    '--newline',
    '--progress',
    '--no-warnings',
    '--ignore-errors',
    '--no-abort-on-error',
    '--windows-filenames',
    isSingleVideo ? '--no-playlist' : '--yes-playlist',
    '--merge-output-format', 'mp4',
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=android,web',
    '--js-runtimes', 'node',
    ...getCookiesArgs(),
    url
  ];

  console.log(`\n[${jobId}] Starting concurrent download job for "${playlistTitle}"`);
  console.log(`[${jobId}] Target directory: ${outputDir}`);
  console.log(`[${jobId}] Quality: ${quality}, Format: ${formatArg}`);

  const proc = spawn(YTDLP_PATH, args, {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });

  // Job object to keep SSE state and broadcast
  const job = {
    jobId,
    proc,
    outputDir,
    clients: new Set(),
    history: [],
    currentIndex: 0,
    currentVideo: '',
    totalVideos: 0,
    completedVideos: new Set(),
    isDone: false,
    createdAt: Date.now()
  };

  jobs[jobId] = job;

  function broadcast(event) {
    job.history.push(event);
    if (job.history.length > 500) job.history.shift();
    const dataStr = `data: ${JSON.stringify(event)}\n\n`;
    job.clients.forEach(client => {
      try { client.write(dataStr); } catch (_) {}
    });
  }

  proc.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    lines.forEach(line => {
      line = line.trim();
      if (!line) return;

      // Item counter: [download] Downloading item 3 of 69
      const itemMatch = line.match(/Downloading (?:item|video) (\d+) of (\d+)/i);
      if (itemMatch) {
        job.currentIndex = parseInt(itemMatch[1]);
        job.totalVideos = parseInt(itemMatch[2]);
        broadcast({ type: 'item_start', index: job.currentIndex, total: job.totalVideos });
        return;
      }

      // Destination: [download] Destination: ...\01 - Lec-1.f398.mp4 or Destination: ...\VideoTitle.f398.mp4
      const destMatch = line.match(/Destination: .*[\\\/](\d+)\s*-\s*(.+?)(?:\.[a-zA-Z0-9_-]+)*\.[a-zA-Z0-9]+$/i);
      if (destMatch) {
        job.currentIndex = parseInt(destMatch[1]) || job.currentIndex;
        job.currentVideo = `${destMatch[1]} - ${destMatch[2]}`;
        broadcast({ type: 'video_start', index: job.currentIndex, title: job.currentVideo });
        return;
      }

      const singleDestMatch = line.match(/Destination: .*[\\\/](.+?)(?:\.[a-zA-Z0-9_-]+)*\.[a-zA-Z0-9]+$/i);
      if (singleDestMatch) {
        job.currentIndex = job.currentIndex || 1;
        job.currentVideo = singleDestMatch[1];
        broadcast({ type: 'video_start', index: job.currentIndex, title: job.currentVideo });
        return;
      }

      // Progress line: [download]  45.3% of  123.45MiB at  2.50MiB/s ETA 00:30
      const progMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)/);
      if (progMatch) {
        broadcast({
          type: 'progress',
          percent: parseFloat(progMatch[1]),
          size: progMatch[2],
          speed: progMatch[3],
          eta: progMatch[4],
          index: job.currentIndex,
          title: job.currentVideo
        });
        return;
      }

      // 100% finished
      if (line.includes('100% of') || line.includes('100.0% of')) {
        if (job.currentIndex > 0) {
          job.completedVideos.add(job.currentIndex);
          broadcast({ type: 'video_done', index: job.currentIndex, title: job.currentVideo });
        }
        return;
      }

      // Merger
      if (line.includes('[Merger]') || line.includes('Merging formats')) {
        broadcast({ type: 'merging', index: job.currentIndex, title: job.currentVideo });
        return;
      }

      // Already downloaded
      if (line.includes('has already been downloaded')) {
        const alreadyMatch = line.match(/(\d+)\s*-\s*(.+?) has already been downloaded/i);
        const idx = alreadyMatch ? parseInt(alreadyMatch[1]) : job.currentIndex;
        if (idx > 0) {
          job.completedVideos.add(idx);
          broadcast({ type: 'already_downloaded', index: idx, title: job.currentVideo });
        }
        return;
      }
    });
  });

  proc.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line) {
      console.error(`[${jobId}] STDERR: ${line}`);
      broadcast({ type: 'log', message: line });
    }
  });

  proc.on('close', (code) => {
    job.isDone = true;
    console.log(`[${jobId}] Download process finished with exit code ${code}`);

    // Auto cleanup leftover temp files (.part, .temp.mp4, .f*.mp4, .f*.m4a)
    cleanupTempFiles(outputDir);

    broadcast({
      type: code === 0 ? 'done' : 'done',
      message: code === 0 ? 'All downloads complete!' : 'Download finished'
    });
    // Close clients
    job.clients.forEach(c => {
      try { c.end(); } catch (_) {}
    });
    job.clients.clear();
  });

  res.json({ status: 'started', outputDir });
});

// Helper: cleanup temp leftover files
function cleanupTempFiles(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const fullPath = path.join(dir, file);
      if (
        file.endsWith('.part') ||
        file.endsWith('.temp.mp4') ||
        file.endsWith('.ytdl') ||
        /\.f\d+\.(mp4|m4a|webm)$/i.test(file)
      ) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`[Cleanup] Removed leftover temp file: ${file}`);
        } catch (_) {}
      }
    });
  } catch (err) {
    console.error('[Cleanup Error]', err.message);
  }
}

// ─────────────────────────────────────────────
// GET /api/progress/:jobId  — SSE stream
// ─────────────────────────────────────────────
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!job) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Job not found' })}\n\n`);
    return res.end();
  }

  job.clients.add(res);

  // Send history events to catch up
  job.history.forEach(evt => {
    try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch (_) {}
  });

  if (job.isDone) {
    res.write(`data: ${JSON.stringify({ type: 'done', message: 'Completed' })}\n\n`);
    return res.end();
  }

  req.on('close', () => {
    job.clients.delete(res);
  });
});

// ─────────────────────────────────────────────
// POST /api/cancel
// ─────────────────────────────────────────────
app.post('/api/cancel', (req, res) => {
  const { jobId } = req.body;
  const job = jobs[jobId];
  if (job && job.proc) {
    try { job.proc.kill('SIGTERM'); } catch (_) {}
    job.isDone = true;
    res.json({ status: 'cancelled' });
  } else {
    res.status(404).json({ error: 'No active job found' });
  }
});

// ─────────────────────────────────────────────
// GET /api/open-folder
// ─────────────────────────────────────────────
app.get('/api/open-folder', (req, res) => {
  const { folderPath } = req.query;
  const targetDir = folderPath ? path.resolve(folderPath) : DOWNLOADS_DIR;

  if (!fs.existsSync(targetDir)) {
    try { fs.mkdirSync(targetDir, { recursive: true }); } catch (_) {}
  }

  if (process.platform === 'win32') {
    spawn('explorer.exe', [targetDir], { detached: true, stdio: 'ignore' }).unref();
    return res.json({ status: 'opened', path: targetDir });
  }
  res.json({ status: 'unsupported_platform', message: 'Local folder open is only supported on Windows client' });
});

// ─────────────────────────────────────────────
// Cloud download support: list completed files & download directly to browser
// ─────────────────────────────────────────────
app.get('/api/files/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];
  if (!job || !job.outputDir || !fs.existsSync(job.outputDir)) {
    return res.json({ files: [] });
  }
  try {
    const files = fs.readdirSync(job.outputDir).filter(f => {
      return !f.endsWith('.part') &&
             !f.endsWith('.temp.mp4') &&
             !f.endsWith('.ytdl') &&
             !/\.f\d+\.(mp4|m4a|webm)$/i.test(f);
    });
    res.json({ files, outputDir: job.outputDir });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/download-file', (req, res) => {
  const { jobId, filename } = req.query;
  const job = jobs[jobId];
  if (!job || !job.outputDir) {
    return res.status(404).json({ error: 'Job not found' });
  }
  const safeFilename = path.basename(filename);
  const filePath = path.join(job.outputDir, safeFilename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(filePath, safeFilename);
});

// Health check for Render
app.get('/healthz', (req, res) => {
  res.send('OK');
});

// Periodic cleanup of completed job data older than 2 hours for multi-user optimization
setInterval(() => {
  const now = Date.now();
  Object.keys(jobs).forEach(id => {
    const job = jobs[id];
    if (job && job.isDone && job.createdAt && (now - job.createdAt > 7200000)) {
      console.log(`[Job Manager] Cleaning up expired job record: ${id}`);
      delete jobs[id];
    }
  });
}, 300000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 YouTube Playlist Downloader running at http://localhost:${PORT}\n`);
  console.log(`📁 Downloads directory: ${DOWNLOADS_DIR}\n`);
});

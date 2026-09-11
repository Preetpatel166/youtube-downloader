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

  return toolName; // In system PATH
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
const AUTH_STATE_PATH = path.join(__dirname, 'auth_state.json');

// ─────────────────────────────────────────────
// Auth State Management
// ─────────────────────────────────────────────
function loadAuthState() {
  try {
    if (fs.existsSync(AUTH_STATE_PATH)) {
      const saved = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
      if (saved.connected) return saved;
    }
  } catch (_) {}

  // Auto-detect existing cookies.txt in workspace
  if (fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 100) {
    return {
      connected: true,
      mode: 'manual',
      browser: 'cookies.txt',
      updatedAt: new Date().toISOString()
    };
  }
  return { connected: false, mode: 'guest', browser: null, updatedAt: null };
}

function saveAuthState(state) {
  try {
    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    console.error('[Auth State Error]', e.message);
  }
}

let authState = loadAuthState();

// Helper: build yt-dlp cookie arguments dynamically
function getCookiesArgs() {
  if (authState.connected && authState.mode === 'browser' && authState.browser) {
    return ['--cookies-from-browser', authState.browser];
  }
  if (fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 100) {
    return ['--cookies', COOKIES_PATH];
  }
  return [];
}

// Global active jobs store
const jobs = {};

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// Auth Endpoints
// ─────────────────────────────────────────────

// GET /api/auth/status
app.get('/api/auth/status', (req, res) => {
  res.json({
    connected: !!authState.connected,
    mode: authState.mode || 'guest',
    browser: authState.browser || null,
    updatedAt: authState.updatedAt || null
  });
});

// POST /api/auth/select-browser
// Body: { browser: 'chrome' | 'edge' | 'firefox' | 'brave' | 'opera' | 'cookies_file' | 'none' }
app.post('/api/auth/select-browser', (req, res) => {
  const { browser } = req.body;
  const allowed = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'cookies_file', 'none'];
  
  if (!browser || !allowed.includes(browser.toLowerCase())) {
    return res.status(400).json({ error: `Invalid browser. Supported: ${allowed.join(', ')}` });
  }

  const selected = browser.toLowerCase();

  // If user chooses 'cookies_file'
  if (selected === 'cookies_file') {
    if (fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 100) {
      authState = { connected: true, mode: 'manual', browser: 'cookies.txt', updatedAt: new Date().toISOString() };
      saveAuthState(authState);
      return res.json({ success: true, message: 'Switched to Active Session (cookies.txt)', ...authState });
    } else {
      return res.status(400).json({ error: 'No saved cookies.txt found in project directory.' });
    }
  }

  // If user chooses 'none', switch back to guest mode
  if (selected === 'none') {
    authState = { connected: false, mode: 'guest', browser: null, updatedAt: new Date().toISOString() };
    saveAuthState(authState);
    return res.json({ success: true, message: 'Switched to Guest Mode (Anonymous)', ...authState });
  }

  // Guard for cloud / server environments (Render / Linux Docker)
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return res.status(400).json({
      error: `Browser profile extraction is only supported when running locally on Windows/Mac. On Render/Cloud, please use the "cookies.txt" upload or Guest Mode.`
    });
  }

  // Probe yt-dlp with --cookies-from-browser to test if cookies can be read
  console.log(`[Auth] Testing cookie extraction for browser: "${selected}"`);
  const probe = spawn(YTDLP_PATH, ['--cookies-from-browser', selected, '--dump-user-agent']);
  let probeErr = '';
  let isDone = false;

  const timeout = setTimeout(() => {
    if (!isDone) {
      isDone = true;
      try { probe.kill('SIGKILL'); } catch (_) {}
      return res.status(504).json({ error: 'Browser probe timed out. Make sure the browser is responsive.' });
    }
  }, 10000);

  probe.stderr.on('data', (d) => { probeErr += d.toString(); });

  probe.on('close', (code) => {
    if (isDone) return;
    isDone = true;
    clearTimeout(timeout);

    if (code !== 0) {
      let friendlyError = `Could not extract cookies from ${selected}.`;
      if (probeErr.includes('Could not copy Chrome cookie database') || probeErr.includes('database is locked') || probeErr.includes('Permission denied')) {
        friendlyError = `${selected.toUpperCase()} is currently open in the background and locking its cookie file. Please close all ${selected.toUpperCase()} windows and try again, OR use the active cookies.txt session.`;
      } else if (probeErr.includes('Failed to decrypt with DPAPI')) {
        friendlyError = `${selected.toUpperCase()} uses Windows App-Bound encryption. Please close Edge and connect, or use the active cookies.txt session.`;
      } else if (probeErr.includes('could not find')) {
        friendlyError = `No installation or profile found for ${selected}.`;
      }

      console.warn(`[Auth Warning] Browser probe failed for ${selected}: ${friendlyError}`);
      return res.status(400).json({
        error: friendlyError,
        raw: probeErr
      });
    }

    authState = {
      connected: true,
      mode: 'browser',
      browser: selected,
      updatedAt: new Date().toISOString()
    };
    saveAuthState(authState);
    console.log(`[Auth Success] Connected via browser: ${selected}`);
    res.json({ success: true, message: `Successfully connected via ${selected.toUpperCase()}`, ...authState });
  });
});

// POST /api/auth/upload-cookies (Fallback manual upload)
app.post('/api/auth/upload-cookies', (req, res) => {
  const { cookieContent } = req.body;

  if (!cookieContent || typeof cookieContent !== 'string') {
    return res.status(400).json({ error: 'No cookie content provided.' });
  }

  // Basic validation: Netscape cookie format check
  const firstLine = cookieContent.trim().split('\n')[0];
  if (!firstLine.includes('Netscape') && !firstLine.startsWith('#') && !cookieContent.includes('\t')) {
    return res.status(400).json({ error: 'Invalid cookies.txt format. Please provide a standard Netscape cookie file.' });
  }

  try {
    fs.writeFileSync(COOKIES_PATH, cookieContent, { encoding: 'utf8', mode: 0o600 });
    console.log(`[Auth] Fallback cookies.txt saved (${cookieContent.length} bytes)`);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to write cookies file: ' + e.message });
  }

  authState = {
    connected: true,
    mode: 'manual',
    browser: 'cookies.txt',
    updatedAt: new Date().toISOString()
  };
  saveAuthState(authState);

  res.json({ success: true, message: 'Connected via uploaded cookies.txt', ...authState });
});

// DELETE /api/auth/signout
app.delete('/api/auth/signout', (req, res) => {
  try {
    if (fs.existsSync(COOKIES_PATH)) fs.unlinkSync(COOKIES_PATH);
  } catch (_) {}

  authState = { connected: false, mode: 'guest', browser: null, updatedAt: null };
  saveAuthState(authState);
  console.log('[Auth] Disconnected session, switched to Guest mode.');
  res.json({ success: true, message: 'Disconnected successfully.' });
});

// ─────────────────────────────────────────────
// URL Parsing Helper
// ─────────────────────────────────────────────
function parseYouTubeUrl(rawUrl) {
  try {
    const trimmed = (rawUrl || '').trim();
    const u = new URL(trimmed);
    const hostname = u.hostname.replace(/^www\./, '');

    // Handle youtu.be/<videoId>
    if (hostname === 'youtu.be') {
      const videoId = u.pathname.replace(/^\/+/, '').split('/')[0].split('?')[0];
      if (videoId) {
        return {
          url: `https://www.youtube.com/watch?v=${videoId}`,
          isPlaylist: false
        };
      }
    }

    // Handle youtube.com/shorts/<videoId>
    if (u.pathname.startsWith('/shorts/')) {
      const videoId = u.pathname.split('/')[2];
      if (videoId) {
        return {
          url: `https://www.youtube.com/watch?v=${videoId}`,
          isPlaylist: false
        };
      }
    }

    // Handle youtube.com/watch?v=<videoId>
    if (u.pathname.includes('/watch')) {
      const videoId = u.searchParams.get('v');
      const listId = u.searchParams.get('list') || '';

      // Non-standard or radio mix lists attached to a video link: treat as single video
      if (videoId && (listId.startsWith('RD') || u.searchParams.has('start_radio') || !listId.startsWith('PL'))) {
        return {
          url: `https://www.youtube.com/watch?v=${videoId}`,
          isPlaylist: false
        };
      }
      if (videoId && !listId) {
        return {
          url: `https://www.youtube.com/watch?v=${videoId}`,
          isPlaylist: false
        };
      }
    }

    const listId = u.searchParams.get('list') || '';
    const isPlaylist = u.pathname.includes('/playlist') || (listId.startsWith('PL'));
    return { url: trimmed, isPlaylist };
  } catch (_) {
    return { url: (rawUrl || '').trim(), isPlaylist: false };
  }
}

// ─────────────────────────────────────────────
// GET /api/info — Fetch Video / Playlist Info
// ─────────────────────────────────────────────
function handleFetchInfo(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const parsed = parseYouTubeUrl(url);

  const args = [
    ...(parsed.isPlaylist ? ['--flat-playlist', '--playlist-end', '100'] : ['--no-playlist']),
    '--dump-single-json',
    '--no-warnings',
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=android,web',
    '--js-runtimes', 'node:node',
    ...getCookiesArgs(),
    parsed.url
  ];

  console.log(`[Fetch Info] URL: "${url}" -> Parsed: "${parsed.url}" (Playlist: ${parsed.isPlaylist})`);

  const proc = spawn(YTDLP_PATH, args);
  let output = '';
  let errOutput = '';
  let isDone = false;

  const timeout = setTimeout(() => {
    if (!isDone) {
      isDone = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
      res.status(504).json({ error: 'Request timed out while contacting YouTube. Please try again.' });
    }
  }, 60000);

  proc.stdout.on('data', (d) => { output += d.toString(); });
  proc.stderr.on('data', (d) => { errOutput += d.toString(); });

  proc.on('close', (code) => {
    if (isDone) return;
    isDone = true;
    clearTimeout(timeout);

    if (code !== 0) {
      let cleanError = 'Failed to fetch details from YouTube.';
      if (errOutput.includes('This video is unavailable')) {
        cleanError = 'This video is unavailable or has been removed from YouTube.';
      } else if (errOutput.includes('Private video')) {
        cleanError = 'This video or playlist is private. Connect a signed-in session to access it.';
      } else if (errOutput.includes('not a bot') || errOutput.includes('bot')) {
        cleanError = 'YouTube bot check triggered on cloud server. Please upload YouTube cookies in the web dashboard or use your local PC server.';
      } else if (errOutput.includes('Sign in to confirm') || errOutput.includes('age-restricted')) {
        cleanError = 'YouTube requires sign-in for this age-restricted video.';
      } else if (errOutput.trim()) {
        const match = errOutput.match(/ERROR:\s*(?:\[youtube\]\s*)?([^\n\r]+)/i);
        if (match) cleanError = match[1].trim();
      }
      return res.status(400).json({ error: cleanError, details: errOutput });
    }

    try {
      const data = JSON.parse(output);
      const isPlaylist = data._type === 'playlist' || (Array.isArray(data.entries) && data.entries.length > 0);

      if (isPlaylist) {
        const videos = (data.entries || []).map((v, i) => ({
          index: i + 1,
          id: v.id,
          title: v.title || `Video ${i + 1}`,
          duration: v.duration || 0,
          thumbnail: v.thumbnails?.[0]?.url || (v.id ? `https://img.youtube.com/vi/${v.id}/mqdefault.jpg` : ''),
          url: v.url || (v.id ? `https://www.youtube.com/watch?v=${v.id}` : parsed.url)
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
            url: data.webpage_url || data.url || parsed.url
          }]
        });
      }
    } catch (e) {
      res.status(500).json({ error: 'Failed to parse YouTube metadata', details: e.message });
    }
  });
}

app.get('/api/info', handleFetchInfo);
app.get('/api/playlist-info', handleFetchInfo);

// ─────────────────────────────────────────────
// POST /api/download — Concurrent Download Engine
// ─────────────────────────────────────────────
app.post('/api/download', (req, res) => {
  const { url, quality, playlistTitle, jobId, isSingleVideo, selectedIndices } = req.body;
  if (!url || !jobId) return res.status(400).json({ error: 'URL and jobId are required' });

  const parsed = parseYouTubeUrl(url);
  const targetUrl = parsed.url;
  const isSingle = isSingleVideo || !parsed.isPlaylist;

  const safeJobId = (jobId || 'job').replace(/[<>:"/\\|?*]/g, '');
  let outputDir;
  let outputTemplate;

  if (isSingle) {
    outputDir = path.resolve(DOWNLOADS_DIR, 'YouTube Downloads');
    outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');
  } else {
    const safeName = (playlistTitle || 'YouTube Playlist')
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 60) || 'YouTube Playlist';

    outputDir = path.resolve(DOWNLOADS_DIR, safeName);
    outputTemplate = path.join(outputDir, '%(playlist_index|autonumber)02d - %(title)s.%(ext)s');
  }

  if (!fs.existsSync(outputDir)) {
    try { fs.mkdirSync(outputDir, { recursive: true }); } catch (_) {}
  }

  // Format selectors
  let formatArg;
  let isAudioOnly = false;
  let audioFormat = 'mp3';

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
    case 'audio_mp3':
      isAudioOnly = true;
      audioFormat = 'mp3';
      formatArg = 'bestaudio/best';
      break;
    case 'audio_m4a':
      isAudioOnly = true;
      audioFormat = 'm4a';
      formatArg = 'bestaudio[ext=m4a]/bestaudio/best';
      break;
    default:
      formatArg = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
  }

  const args = [
    '--ffmpeg-location', FFMPEG_PATH,
    '--format', formatArg,
    '--format-sort', 'res,fps',
    '--output', outputTemplate,
    '--newline',
    '--progress',
    '--no-warnings',
    '--ignore-errors',
    '--no-abort-on-error',
    '--windows-filenames',
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=android,web',
    '--js-runtimes', 'node:node',
    ...getCookiesArgs()
  ];

  if (isAudioOnly) {
    args.push('-x');
    args.push('--audio-format', audioFormat);
    args.push('--audio-quality', '0');
  } else {
    args.push('--merge-output-format', 'mp4');
  }

  if (isSingle) {
    args.push('--no-playlist');
  } else {
    args.push('--yes-playlist');
    if (Array.isArray(selectedIndices) && selectedIndices.length > 0) {
      args.push('--playlist-items', selectedIndices.join(','));
    }
  }

  args.push(targetUrl);

  console.log(`\n[${jobId}] Starting download job for "${playlistTitle || 'YouTube'}"`);
  console.log(`[${jobId}] Destination: ${outputDir}`);
  console.log(`[${jobId}] Format: ${formatArg}`);

  const proc = spawn(YTDLP_PATH, args, {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });

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

      // Item counter: [download] Downloading item 2 of 10
      const itemMatch = line.match(/Downloading (?:item|video) (\d+) of (\d+)/i);
      if (itemMatch) {
        job.currentIndex = parseInt(itemMatch[1]);
        job.totalVideos = parseInt(itemMatch[2]);
        broadcast({ type: 'item_start', index: job.currentIndex, total: job.totalVideos });
        return;
      }

      // Destination: [download] Destination: ...\01 - Title.f137.mp4
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

      // Progress line: [download]  56.2% of  120.00MiB at  4.50MiB/s ETA 00:15
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

      // Merger or Audio Extraction
      if (line.includes('[Merger]') || line.includes('Merging formats') || line.includes('[ExtractAudio]')) {
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
    console.log(`[${jobId}] Job finished with code ${code}`);

    cleanupTempFiles(outputDir);

    let completedFiles = [];
    try {
      if (fs.existsSync(outputDir)) {
        completedFiles = fs.readdirSync(outputDir).filter(f => {
          return !f.endsWith('.part') &&
                 !f.endsWith('.temp.mp4') &&
                 !f.endsWith('.ytdl') &&
                 !/\.f\d+\.(mp4|m4a|webm)$/i.test(f);
        });
      }
    } catch (_) {}

    broadcast({
      type: 'done',
      code,
      message: code === 0 ? 'All downloads complete!' : 'Download process finished',
      outputDir,
      files: completedFiles
    });

    job.clients.forEach(c => {
      try { c.end(); } catch (_) {}
    });
    job.clients.clear();
  });

  res.json({ status: 'started', outputDir });
});

// Helper: cleanup leftover temporary files (.part, .temp.mp4, etc.)
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
// GET /api/progress/:jobId — SSE Stream
// ─────────────────────────────────────────────
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!job) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Job record not found' })}\n\n`);
    return res.end();
  }

  job.clients.add(res);

  // Send history events
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
  res.json({ status: 'unsupported_platform', message: 'Explorer launch is supported on Windows' });
});

// ─────────────────────────────────────────────
// GET /api/files/:jobId — List downloaded files
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

// ─────────────────────────────────────────────
// GET /api/download-file
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// GET /healthz
// ─────────────────────────────────────────────
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', ytdlp: YTDLP_PATH, ffmpeg: FFMPEG_PATH, downloadsDir: DOWNLOADS_DIR });
});

// Periodic cleanup of completed job data older than 2 hours
setInterval(() => {
  const now = Date.now();
  Object.keys(jobs).forEach(id => {
    const job = jobs[id];
    if (job && job.isDone && job.createdAt && (now - job.createdAt > 7200000)) {
      delete jobs[id];
    }
  });
}, 300000);

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Global Error]', err.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 MediaDL YouTube Downloader running at http://localhost:${PORT}`);
  console.log(`📁 Target Downloads directory: ${DOWNLOADS_DIR}\n`);
});

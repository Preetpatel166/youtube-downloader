/* ──────────────────────────────────────────────
   app.js — YouTube Playlist Downloader Frontend
────────────────────────────────────────────── */

const API = '/api';

// DOM references — Main
const playlistUrlInput  = document.getElementById('playlist-url');
const fetchBtn          = document.getElementById('fetch-btn');
const fetchBtnText      = document.getElementById('fetch-btn-text');
const fetchLoader       = document.getElementById('fetch-loader');
const urlError          = document.getElementById('url-error');

const playlistSection   = document.getElementById('playlist-section');
const sectionStepTitle  = document.getElementById('section-step-title');

// Single Video Hero view references
const singleVideoHero   = document.getElementById('single-video-hero');
const singleThumbImg    = document.getElementById('single-thumb-img');
const singleDurationBadge = document.getElementById('single-duration-badge');
const singleVideoTitle  = document.getElementById('single-video-title');
const singleVideoUploader = document.getElementById('single-video-uploader');

// Playlist view references
const playlistHero      = document.getElementById('playlist-hero');
const playlistTitle     = document.getElementById('playlist-title');
const playlistMeta      = document.getElementById('playlist-meta');
const videoGrid         = document.getElementById('video-grid');

const qualitySelect     = document.getElementById('quality-select');
const downloadBtn       = document.getElementById('download-btn');
const downloadBtnText   = document.getElementById('download-btn-text');

const progressSection   = document.getElementById('progress-section');
const overallLabel      = document.getElementById('overall-label');
const overallCount      = document.getElementById('overall-count');
const overallBar        = document.getElementById('overall-bar');
const videoDownloadList = document.getElementById('video-download-list');

const cancelBtn         = document.getElementById('cancel-btn');
const openFolderBtn     = document.getElementById('open-folder-btn');
const doneBanner        = document.getElementById('done-banner');
const doneDesc          = document.getElementById('done-desc');

// State
let currentMedia     = null;
let currentJobId     = null;
let currentOutputDir = null;
let sseSource        = null;
let completedCount   = 0;
let totalCount       = 0;
const videoRowMap    = {};  // index → dl-row element




function formatDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function showError(msg) {
  urlError.textContent = msg;
  urlError.classList.remove('hidden');
}

function clearError() {
  urlError.textContent = '';
  urlError.classList.add('hidden');
}

function setFetchLoading(loading) {
  if (loading) {
    fetchBtnText.classList.add('hidden');
    fetchLoader.classList.remove('hidden');
    fetchBtn.disabled = true;
  } else {
    fetchBtnText.classList.remove('hidden');
    fetchLoader.classList.add('hidden');
    fetchBtn.disabled = false;
  }
}

// ──────────────────────────────────────────────
// STEP 1 — FETCH VIDEO OR PLAYLIST INFO
// ──────────────────────────────────────────────

fetchBtn.addEventListener('click', fetchMedia);
playlistUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchMedia(); });

function isValidYouTubeUrl(url) {
  return url.includes('youtube.com/') || url.includes('youtu.be/');
}

async function fetchMedia() {
  clearError();
  const rawUrl = playlistUrlInput.value.trim();

  if (!rawUrl) { showError('Please paste a YouTube video or playlist URL.'); return; }
  if (!isValidYouTubeUrl(rawUrl)) { showError('This doesn\'t look like a valid YouTube link. Please enter a YouTube video or playlist URL.'); return; }

  setFetchLoading(true);
  playlistSection.classList.add('hidden');
  progressSection.classList.add('hidden');

  try {
    const resp = await fetch(`${API}/info?url=${encodeURIComponent(rawUrl)}`);
    const data = await resp.json();

    if (!resp.ok) throw new Error(data.error || 'Failed to fetch video/playlist info');

    currentMedia = data;
    currentMedia.url = rawUrl;

    if (data.isPlaylist) {
      if (sectionStepTitle) sectionStepTitle.textContent = 'Playlist Details';
      singleVideoHero.classList.add('hidden');
      playlistHero.classList.remove('hidden');
      videoGrid.classList.remove('hidden');
      downloadBtnText.textContent = 'Download All';

      playlistTitle.textContent = data.title;
      playlistMeta.textContent = `${data.count} video${data.count !== 1 ? 's' : ''} · Folder: Downloads\\${sanitizeFolderName(data.title)}`;

      renderVideoGrid(data.videos);
    } else {
      if (sectionStepTitle) sectionStepTitle.textContent = 'Video Details';
      playlistHero.classList.add('hidden');
      videoGrid.classList.add('hidden');
      singleVideoHero.classList.remove('hidden');
      downloadBtnText.textContent = 'Download Video';

      singleVideoTitle.textContent = data.title;
      singleVideoUploader.textContent = `${data.uploader ? data.uploader + ' · ' : ''}Folder: Downloads\\YouTube Downloads`;
      singleThumbImg.src = data.thumbnail || `https://img.youtube.com/vi/${data.id}/mqdefault.jpg`;
      singleDurationBadge.textContent = formatDuration(data.duration);
    }

    playlistSection.classList.remove('hidden');
    playlistSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    showError(err.message || 'Something went wrong. Is the URL correct?');
  } finally {
    setFetchLoading(false);
  }
}

function sanitizeFolderName(name) {
  return (name || 'YouTube Playlist')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 60);
}

function renderVideoGrid(videos) {
  videoGrid.innerHTML = '';
  videos.forEach((v, i) => {
    const card = document.createElement('div');
    card.className = 'video-thumb-card';
    card.style.animationDelay = `${i * 0.04}s`;
    card.innerHTML = `
      <div class="thumb-img-wrap">
        <img src="${v.thumbnail}" alt="${escapeHtml(v.title)}" loading="lazy" onerror="this.src='https://img.youtube.com/vi/${v.id}/mqdefault.jpg'" />
        <span class="thumb-index">#${v.index}</span>
        ${v.duration ? `<span class="thumb-duration">${formatDuration(v.duration)}</span>` : ''}
      </div>
      <div class="thumb-info">
        <p class="thumb-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</p>
        <button class="btn-card-dl" data-url="${v.url}" data-title="${escapeHtml(v.title)}" title="Download this video">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download
        </button>
      </div>
    `;
    const cardDlBtn = card.querySelector('.btn-card-dl');
    cardDlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startSingleVideoDownload(v.url, v.title);
    });
    videoGrid.appendChild(card);
  });
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ──────────────────────────────────────────────
// STEP 2 — START DOWNLOAD
// ──────────────────────────────────────────────

downloadBtn.addEventListener('click', startDownload);

async function startDownload() {
  if (!currentMedia) return;

  if (!currentMedia.isPlaylist) {
    return startSingleVideoDownload(currentMedia.url || playlistUrlInput.value.trim(), currentMedia.title);
  }

  const quality = qualitySelect.value;
  currentJobId = generateJobId();
  completedCount = 0;
  totalCount = currentMedia.count;

  // Reset progress UI
  videoDownloadList.innerHTML = '';
  Object.keys(videoRowMap).forEach(k => delete videoRowMap[k]);
  overallBar.style.width = '0%';
  overallLabel.textContent = 'Starting download…';
  overallCount.textContent = `0 / ${totalCount}`;
  doneBanner.classList.add('hidden');
  openFolderBtn.classList.add('hidden');
  cancelBtn.classList.remove('hidden');

  // Pre-create rows for all videos
  currentMedia.videos.forEach(v => {
    createVideoRow(v.index, v.title, 'queued');
  });

  progressSection.classList.remove('hidden');
  progressSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Start download on backend
  try {
    const resp = await fetch(`${API}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentMedia.url,
        quality,
        playlistTitle: currentMedia.title,
        jobId: currentJobId,
        isSingleVideo: false
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Failed to start download');

    currentOutputDir = data.outputDir;
    openFolderBtn.classList.remove('hidden');

    // Open SSE stream
    connectSSE(currentJobId);
  } catch (err) {
    overallLabel.textContent = `Error: ${err.message}`;
    overallLabel.style.color = 'var(--red)';
  }
}

async function startSingleVideoDownload(videoUrl, videoTitle) {
  const quality = qualitySelect.value;
  currentJobId = generateJobId();
  completedCount = 0;
  totalCount = 1;

  // Reset progress UI
  videoDownloadList.innerHTML = '';
  Object.keys(videoRowMap).forEach(k => delete videoRowMap[k]);
  overallBar.style.width = '0%';
  overallLabel.textContent = 'Starting video download…';
  overallCount.textContent = `0 / 1`;
  doneBanner.classList.add('hidden');
  openFolderBtn.classList.add('hidden');
  cancelBtn.classList.remove('hidden');

  createVideoRow(1, videoTitle || 'YouTube Video', 'queued');

  progressSection.classList.remove('hidden');
  progressSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const resp = await fetch(`${API}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: videoUrl,
        quality,
        playlistTitle: videoTitle || 'YouTube Video',
        jobId: currentJobId,
        isSingleVideo: true
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Failed to start download');

    currentOutputDir = data.outputDir;
    openFolderBtn.classList.remove('hidden');

    connectSSE(currentJobId);
  } catch (err) {
    overallLabel.textContent = `Error: ${err.message}`;
    overallLabel.style.color = 'var(--red)';
  }
}

// ──────────────────────────────────────────────
// SSE PROGRESS LISTENER
// ──────────────────────────────────────────────

function connectSSE(jobId) {
  if (sseSource) sseSource.close();
  sseSource = new EventSource(`${API}/progress/${jobId}`);

  sseSource.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleProgressEvent(msg);
  };

  sseSource.onerror = () => {
    sseSource.close();
  };
}

function handleProgressEvent(msg) {
  switch (msg.type) {

    case 'total':
    case 'item_start':
      if (msg.total) totalCount = msg.total;
      overallCount.textContent = `${completedCount} / ${totalCount}`;
      if (msg.index) {
        setRowStatus(msg.index, 'downloading');
        scrollRowIntoView(msg.index);
      }
      break;

    case 'video_start': {
      const idx = msg.index;
      overallLabel.textContent = `Downloading: ${msg.title || 'Video ' + idx}`;
      setRowStatus(idx, 'downloading', msg.title);
      scrollRowIntoView(idx);
      break;
    }

    case 'progress': {
      const idx = msg.index;
      if (idx) {
        updateRowProgress(idx, msg.percent, msg.speed, msg.eta);
      }
      break;
    }

    case 'merging': {
      if (msg.index) setRowStatus(msg.index, 'merging', msg.title);
      break;
    }

    case 'video_done': {
      if (msg.index) {
        const row = videoRowMap[msg.index];
        if (row && !row.classList.contains('done')) {
          markRowDone(msg.index);
          completedCount++;
          updateOverall();
        }
      }
      break;
    }

    case 'already_downloaded': {
      if (msg.index) {
        const row = videoRowMap[msg.index];
        if (row && !row.classList.contains('done')) {
          markRowDone(msg.index);
          completedCount++;
          updateOverall();
        }
      }
      break;
    }

    case 'done':
      onAllDone();
      break;

    case 'error':
      overallLabel.textContent = `Error: ${msg.message}`;
      break;

    case 'log':
      break;
  }
}

// ──────────────────────────────────────────────
// VIDEO ROW MANAGEMENT
// ──────────────────────────────────────────────

function createVideoRow(index, title, status) {
  const row = document.createElement('div');
  row.className = `dl-row ${status}`;
  row.id = `dl-row-${index}`;
  row.innerHTML = `
    <div class="dl-row-header">
      <div class="dl-index-badge">${index}</div>
      <span class="dl-title">${escapeHtml(title)}</span>
      <span class="dl-status-chip ${status}">${statusLabel(status)}</span>
    </div>
    <div class="dl-bar-track">
      <div class="dl-bar-fill" id="dl-bar-${index}"></div>
    </div>
    <div class="dl-meta">
      <span id="dl-speed-${index}">—</span>
      <span id="dl-eta-${index}">—</span>
    </div>
  `;
  videoDownloadList.appendChild(row);
  videoRowMap[index] = row;
  return row;
}

function setRowStatus(index, status, title) {
  let row = videoRowMap[index];
  if (!row) row = createVideoRow(index, title || `Video ${index}`, status);

  row.className = `dl-row ${status}`;
  const chip = row.querySelector('.dl-status-chip');
  if (chip) { chip.className = `dl-status-chip ${status}`; chip.textContent = statusLabel(status); }
  if (title) {
    const titleEl = row.querySelector('.dl-title');
    if (titleEl) titleEl.textContent = title;
  }
}

function updateRowProgress(index, percent, speed, eta) {
  const bar = document.getElementById(`dl-bar-${index}`);
  const speedEl = document.getElementById(`dl-speed-${index}`);
  const etaEl = document.getElementById(`dl-eta-${index}`);
  if (bar) bar.style.width = `${percent}%`;
  if (speedEl) speedEl.textContent = speed || '—';
  if (etaEl) etaEl.textContent = eta ? `ETA ${eta}` : '—';

  // Mark as done when 100%
  if (percent >= 100) {
    markRowDone(index);
    completedCount++;
    updateOverall();
  }
}

function markRowDone(index) {
  const row = videoRowMap[index];
  if (!row) return;
  row.className = 'dl-row done';
  const chip = row.querySelector('.dl-status-chip');
  if (chip) { chip.className = 'dl-status-chip done'; chip.textContent = '✓ Done'; }
  const bar = document.getElementById(`dl-bar-${index}`);
  if (bar) bar.style.width = '100%';
  const etaEl = document.getElementById(`dl-eta-${index}`);
  if (etaEl) etaEl.textContent = '';
  const speedEl = document.getElementById(`dl-speed-${index}`);
  if (speedEl) speedEl.textContent = 'Complete';
}

function scrollRowIntoView(index) {
  const row = videoRowMap[index];
  if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateOverall() {
  const pct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  overallBar.style.width = `${pct}%`;
  overallCount.textContent = `${completedCount} / ${totalCount}`;
  overallLabel.textContent = `${completedCount} of ${totalCount} videos downloaded`;
}

function statusLabel(status) {
  const labels = {
    queued:      'Queued',
    downloading: 'Downloading…',
    merging:     'Merging…',
    done:        '✓ Done',
    error:       '✗ Error'
  };
  return labels[status] || status;
}

// ──────────────────────────────────────────────
// ALL DONE
// ──────────────────────────────────────────────

async function onAllDone() {
  if (sseSource) { sseSource.close(); sseSource = null; }

  updateOverall();
  cancelBtn.classList.add('hidden');
  doneDesc.innerHTML = `Files saved.<br><div id="direct-downloads-wrap" style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px;"></div>`;
  
  // Fetch files and offer direct browser download links
  try {
    const filesResp = await fetch(`${API}/files/${currentJobId}`);
    const filesData = await filesResp.json();
    const directWrap = document.getElementById('direct-downloads-wrap');
    if (filesData.files && filesData.files.length > 0 && directWrap) {
      filesData.files.forEach(f => {
        const link = document.createElement('a');
        link.href = `${API}/download-file?jobId=${encodeURIComponent(currentJobId)}&filename=${encodeURIComponent(f)}`;
        link.className = 'btn btn-ghost';
        link.style.cssText = 'font-size: 0.85rem; padding: 6px 12px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;';
        link.download = f;
        link.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Save ${escapeHtml(f)}`;
        directWrap.appendChild(link);
      });
      overallLabel.textContent = totalCount === 1 ? 'Video downloaded successfully! 🎉' : `Download complete! (${filesData.files.length} files saved) 🎉`;
    } else {
      overallLabel.textContent = 'Download finished.';
    }
  } catch (_) {
    overallLabel.textContent = 'Download finished.';
  }

  doneBanner.classList.remove('hidden');
  doneBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ──────────────────────────────────────────────
// CANCEL
// ──────────────────────────────────────────────

cancelBtn.addEventListener('click', async () => {
  if (!currentJobId) return;
  if (!confirm('Cancel the download? Videos already downloaded will be kept.')) return;

  try {
    await fetch(`${API}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: currentJobId })
    });
  } catch (_) {}

  if (sseSource) { sseSource.close(); sseSource = null; }
  overallLabel.textContent = 'Download cancelled.';
  cancelBtn.classList.add('hidden');
});

// ──────────────────────────────────────────────
// OPEN FOLDER
// ──────────────────────────────────────────────

openFolderBtn.addEventListener('click', async () => {
  if (!currentOutputDir) return;
  try {
    await fetch(`${API}/open-folder?folderPath=${encodeURIComponent(currentOutputDir)}`);
  } catch (_) {}
});

// ──────────────────────────────────────────────
// AUTO-PASTE from clipboard on focus
// ──────────────────────────────────────────────
playlistUrlInput.addEventListener('focus', async () => {
  if (playlistUrlInput.value) return;
  try {
    const text = await navigator.clipboard.readText();
    if (text && (text.includes('youtube.com') || text.includes('youtu.be'))) {
      playlistUrlInput.value = text;
    }
  } catch (_) {}
});

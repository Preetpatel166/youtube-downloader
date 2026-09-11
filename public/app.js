/**
 * MediaDL — Modern YouTube Video & Playlist Downloader Client
 */

document.addEventListener('DOMContentLoaded', () => {
  // ── State ──
  const state = {
    auth: { connected: false, mode: 'guest', browser: null },
    currentMedia: null,
    selectedQuality: '1080p',
    activeJobId: null,
    activeEventSource: null,
    selectedPlaylistIndices: new Set(),
    history: JSON.parse(localStorage.getItem('mediadl_history') || '[]')
  };

  // ── DOM References ──
  // Auth
  const browserSelect = document.getElementById('browser-select');
  const btnConnectBrowser = document.getElementById('btn-connect-browser');
  const btnDisconnectAuth = document.getElementById('btn-disconnect-auth');
  const authStatusBadge = document.getElementById('auth-status-badge');
  const authStatusText = document.getElementById('auth-status-text');
  const toggleManualCookies = document.getElementById('toggle-manual-cookies');
  const manualCookiesPanel = document.getElementById('manual-cookies-panel');
  const cookieFileInput = document.getElementById('cookie-file-input');
  const cookieFileName = document.getElementById('cookie-file-name');

  // URL input
  const urlForm = document.getElementById('url-form');
  const urlInput = document.getElementById('url-input');
  const btnPaste = document.getElementById('btn-paste');
  const btnClear = document.getElementById('btn-clear');
  const btnFetch = document.getElementById('btn-fetch');
  const fetchSpinner = document.getElementById('fetch-spinner');

  // Media Details
  const mediaCard = document.getElementById('media-card');
  const mediaThumb = document.getElementById('media-thumb');
  const mediaDuration = document.getElementById('media-duration');
  const mediaTypeBadge = document.getElementById('media-type-badge');
  const mediaTitle = document.getElementById('media-title');
  const mediaChannel = document.getElementById('media-channel');
  const mediaItemCount = document.getElementById('media-item-count');
  const qualityPills = document.getElementById('quality-pills');
  const playlistManager = document.getElementById('playlist-manager');
  const playlistItemsContainer = document.getElementById('playlist-items-container');
  const playlistSelectedCount = document.getElementById('playlist-selected-count');
  const btnSelectAll = document.getElementById('btn-select-all');
  const btnDeselectAll = document.getElementById('btn-deselect-all');
  const btnStartDownload = document.getElementById('btn-start-download');
  const btnDownloadText = document.getElementById('btn-download-text');

  // HUD
  const hudCard = document.getElementById('hud-card');
  const hudStatusTitle = document.getElementById('hud-status-title');
  const hudItemBadge = document.getElementById('hud-item-badge');
  const hudItemName = document.getElementById('hud-item-name');
  const hudProgressFill = document.getElementById('hud-progress-fill');
  const hudPercent = document.getElementById('hud-percent');
  const hudDetail = document.getElementById('hud-detail');
  const hudSpeed = document.getElementById('hud-speed');
  const hudEta = document.getElementById('hud-eta');
  const hudSize = document.getElementById('hud-size');
  const hudPhase = document.getElementById('hud-phase');
  const btnCancelDownload = document.getElementById('btn-cancel-download');
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const btnQuickOpenFolder = document.getElementById('btn-quick-open-folder');

  // History
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');
  const btnClearHistory = document.getElementById('btn-clear-history');

  // Toast
  const toastContainer = document.getElementById('toast-container');

  // ─────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${escapeHtml(message)}</span>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // ─────────────────────────────────────────────
  // Auth & Browser Selection
  // ─────────────────────────────────────────────
  async function fetchAuthStatus() {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      state.auth = data;
      renderAuthUI();
    } catch (e) {
      console.warn('Could not fetch auth status', e);
      authStatusText.textContent = 'Guest Mode';
    }
  }

  function renderAuthUI() {
    if (state.auth.connected) {
      authStatusBadge.classList.add('connected');
      if (state.auth.mode === 'browser') {
        const bName = state.auth.browser.toUpperCase();
        authStatusText.textContent = `Connected via ${bName}`;
        browserSelect.value = state.auth.browser;
      } else {
        authStatusText.textContent = 'Connected (Active Session)';
        browserSelect.value = 'cookies_file';
      }
      btnDisconnectAuth.classList.remove('hidden');
    } else {
      authStatusBadge.classList.remove('connected');
      authStatusText.textContent = 'Guest Mode (Public only)';
      btnDisconnectAuth.classList.add('hidden');
    }
  }

  btnConnectBrowser.addEventListener('click', async () => {
    const selected = browserSelect.value;
    btnConnectBrowser.disabled = true;
    btnConnectBrowser.innerHTML = `<div class="spinner" style="width:14px;height:14px;"></div><span>Connecting…</span>`;

    try {
      const res = await fetch('/api/auth/select-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ browser: selected })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to connect browser profile.');
      }

      state.auth = data;
      renderAuthUI();
      showToast(data.message || 'Browser connected successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnConnectBrowser.disabled = false;
      btnConnectBrowser.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
        <span>Connect Profile</span>
      `;
    }
  });

  btnDisconnectAuth.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/signout', { method: 'DELETE' });
      state.auth = { connected: false, mode: 'guest', browser: null };
      browserSelect.value = 'none';
      renderAuthUI();
      showToast('Switched to Guest Mode', 'info');
    } catch (err) {
      showToast('Failed to disconnect: ' + err.message, 'error');
    }
  });

  // Manual cookies accordion
  toggleManualCookies.addEventListener('click', () => {
    const isExpanded = toggleManualCookies.getAttribute('aria-expanded') === 'true';
    toggleManualCookies.setAttribute('aria-expanded', !isExpanded);
    manualCookiesPanel.classList.toggle('hidden', isExpanded);
  });

  // File dropzone
  cookieFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    cookieFileName.textContent = `Uploading ${file.name}…`;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const content = evt.target.result;
        const res = await fetch('/api/auth/upload-cookies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookieContent: content })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to upload cookies.');

        state.auth = data;
        renderAuthUI();
        cookieFileName.textContent = `✅ Saved ${file.name}`;
        showToast('Cookies file uploaded and verified!', 'success');
      } catch (err) {
        cookieFileName.textContent = '❌ Failed to upload';
        showToast(err.message, 'error');
      }
    };
    reader.readAsText(file);
  });

  // ─────────────────────────────────────────────
  // URL Input Controls
  // ─────────────────────────────────────────────
  urlInput.addEventListener('input', () => {
    btnClear.classList.toggle('hidden', !urlInput.value);
  });

  btnClear.addEventListener('click', () => {
    urlInput.value = '';
    btnClear.classList.add('hidden');
    urlInput.focus();
  });

  btnPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        urlInput.value = text.trim();
        btnClear.classList.remove('hidden');
        fetchMediaInfo();
      }
    } catch (_) {
      urlInput.focus();
      showToast('Please paste the URL manually (Ctrl+V)', 'info');
    }
  });

  urlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    fetchMediaInfo();
  });

  // ─────────────────────────────────────────────
  // Fetch Media Information
  // ─────────────────────────────────────────────
  async function fetchMediaInfo() {
    const rawUrl = urlInput.value.trim();
    if (!rawUrl) {
      showToast('Please enter a YouTube video or playlist link.', 'error');
      return;
    }

    setFetchLoading(true);
    mediaCard.classList.add('hidden');

    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(rawUrl)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch details from YouTube.');
      }

      state.currentMedia = data;
      renderMediaCard(data);
      showToast(`Loaded "${data.title}"`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setFetchLoading(false);
    }
  }

  function setFetchLoading(loading) {
    btnFetch.disabled = loading;
    fetchSpinner.classList.toggle('hidden', !loading);
    btnFetch.querySelector('.btn-text').textContent = loading ? 'Analyzing…' : 'Analyze Link';
  }

  function renderMediaCard(data) {
    mediaCard.classList.remove('hidden');

    mediaTitle.textContent = data.title;
    mediaChannel.textContent = data.uploader || 'YouTube';
    mediaThumb.src = data.thumbnail || (data.id ? `https://img.youtube.com/vi/${data.id}/mqdefault.jpg` : '');

    if (data.isPlaylist) {
      mediaTypeBadge.textContent = 'Playlist';
      mediaDuration.textContent = `${data.count} items`;
      mediaItemCount.classList.remove('hidden');
      mediaItemCount.textContent = `${data.count} Videos`;
      playlistManager.classList.remove('hidden');

      // Initialize all items selected
      state.selectedPlaylistIndices.clear();
      data.videos.forEach(v => state.selectedPlaylistIndices.add(v.index));
      renderPlaylistItems(data.videos);
      updatePlaylistCounter();
      btnDownloadText.textContent = `Download Selected (${state.selectedPlaylistIndices.size})`;
    } else {
      mediaTypeBadge.textContent = 'Video';
      mediaDuration.textContent = formatDuration(data.duration);
      mediaItemCount.classList.add('hidden');
      playlistManager.classList.add('hidden');
      btnDownloadText.textContent = 'Download Video';
    }

    // Scroll gently to the card
    mediaCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderPlaylistItems(videos) {
    playlistItemsContainer.innerHTML = '';
    videos.forEach(video => {
      const row = document.createElement('div');
      row.className = 'playlist-item-row';
      row.dataset.index = video.index;

      const isChecked = state.selectedPlaylistIndices.has(video.index);

      row.innerHTML = `
        <input type="checkbox" class="item-checkbox" ${isChecked ? 'checked' : ''} data-index="${video.index}">
        <span class="item-index">${video.index}</span>
        <img class="item-thumb-sm" src="${escapeHtml(video.thumbnail)}" alt="" loading="lazy">
        <span class="item-title-text" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</span>
        <span class="item-duration-text">${formatDuration(video.duration)}</span>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          const cb = row.querySelector('.item-checkbox');
          cb.checked = !cb.checked;
          togglePlaylistItem(video.index, cb.checked);
        }
      });

      const cb = row.querySelector('.item-checkbox');
      cb.addEventListener('change', (e) => {
        togglePlaylistItem(video.index, e.target.checked);
      });

      playlistItemsContainer.appendChild(row);
    });
  }

  function togglePlaylistItem(index, checked) {
    if (checked) {
      state.selectedPlaylistIndices.add(index);
    } else {
      state.selectedPlaylistIndices.delete(index);
    }
    updatePlaylistCounter();
  }

  function updatePlaylistCounter() {
    const count = state.selectedPlaylistIndices.size;
    const total = state.currentMedia?.videos?.length || 0;
    playlistSelectedCount.textContent = `Selected ${count} of ${total}`;
    btnDownloadText.textContent = `Download Selected (${count})`;
    btnStartDownload.disabled = count === 0;
  }

  btnSelectAll.addEventListener('click', () => {
    if (!state.currentMedia?.videos) return;
    state.currentMedia.videos.forEach(v => state.selectedPlaylistIndices.add(v.index));
    playlistItemsContainer.querySelectorAll('.item-checkbox').forEach(cb => cb.checked = true);
    updatePlaylistCounter();
  });

  btnDeselectAll.addEventListener('click', () => {
    state.selectedPlaylistIndices.clear();
    playlistItemsContainer.querySelectorAll('.item-checkbox').forEach(cb => cb.checked = false);
    updatePlaylistCounter();
  });

  // Quality pills
  qualityPills.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;

    qualityPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.selectedQuality = pill.dataset.quality;
  });

  // ─────────────────────────────────────────────
  // Download Engine & Real-Time SSE
  // ─────────────────────────────────────────────
  btnStartDownload.addEventListener('click', async () => {
    if (!state.currentMedia) return;

    const isPlaylist = state.currentMedia.isPlaylist;
    const selectedIndices = isPlaylist ? Array.from(state.selectedPlaylistIndices) : null;

    if (isPlaylist && (!selectedIndices || selectedIndices.length === 0)) {
      showToast('Please select at least one video to download.', 'error');
      return;
    }

    const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    state.activeJobId = jobId;

    initHUD(state.currentMedia.title, isPlaylist ? selectedIndices.length : 1);

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urlInput.value.trim(),
          quality: state.selectedQuality,
          playlistTitle: state.currentMedia.title,
          jobId,
          isSingleVideo: !isPlaylist,
          selectedIndices
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start download.');

      connectSSE(jobId);
    } catch (err) {
      showToast(err.message, 'error');
      hudStatusTitle.textContent = 'Failed to start';
      hudPhase.textContent = 'Error';
    }
  });

  function initHUD(title, totalItems) {
    hudCard.classList.remove('hidden');
    hudStatusTitle.textContent = 'Starting Download…';
    hudItemBadge.textContent = `Item 1 / ${totalItems}`;
    hudItemName.textContent = title;
    hudProgressFill.style.width = '0%';
    hudPercent.textContent = '0%';
    hudDetail.textContent = 'Initializing yt-dlp process…';
    hudSpeed.textContent = '-- MB/s';
    hudEta.textContent = '--:--';
    hudSize.textContent = '-- MB';
    hudPhase.textContent = 'Starting';
    btnCancelDownload.classList.remove('hidden');
    btnOpenFolder.classList.add('hidden');

    hudCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function connectSSE(jobId) {
    if (state.activeEventSource) {
      state.activeEventSource.close();
    }

    const es = new EventSource(`/api/progress/${jobId}`);
    state.activeEventSource = es;

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        handleSSEEvent(evt);
      } catch (err) {
        console.error('Failed to parse SSE payload', err);
      }
    };

    es.onerror = () => {
      console.warn('SSE connection interrupted.');
    };
  }

  function handleSSEEvent(evt) {
    switch (evt.type) {
      case 'item_start':
        hudItemBadge.textContent = `Item ${evt.index} / ${evt.total}`;
        hudStatusTitle.textContent = `Downloading Item ${evt.index} of ${evt.total}`;
        hudPhase.textContent = 'Downloading';
        break;

      case 'video_start':
        if (evt.title) hudItemName.textContent = evt.title;
        break;

      case 'progress':
        const pct = Math.min(100, Math.max(0, evt.percent || 0));
        hudProgressFill.style.width = `${pct}%`;
        hudPercent.textContent = `${pct.toFixed(1)}%`;
        hudSpeed.textContent = evt.speed || '-- MB/s';
        hudEta.textContent = evt.eta || '--:--';
        hudSize.textContent = evt.size || '-- MB';
        hudDetail.textContent = `Downloading at ${evt.speed || 'high speed'} (ETA: ${evt.eta || 'calc…'})`;
        hudPhase.textContent = 'Downloading';
        break;

      case 'merging':
        hudPhase.textContent = 'Merging';
        hudDetail.textContent = 'Merging video and audio streams with FFmpeg…';
        break;

      case 'video_done':
        hudProgressFill.style.width = '100%';
        hudPercent.textContent = '100%';
        hudPhase.textContent = 'Item Complete';
        break;

      case 'already_downloaded':
        hudProgressFill.style.width = '100%';
        hudPercent.textContent = '100%';
        hudPhase.textContent = 'Already Cached';
        hudDetail.textContent = 'File already exists in target folder.';
        break;

      case 'done':
        if (state.activeEventSource) {
          state.activeEventSource.close();
          state.activeEventSource = null;
        }
        hudStatusTitle.textContent = '🎉 All Downloads Complete!';
        hudProgressFill.style.width = '100%';
        hudPercent.textContent = '100%';
        hudPhase.textContent = 'Finished';
        hudDetail.textContent = evt.message || 'Media successfully downloaded.';
        btnCancelDownload.classList.add('hidden');
        btnOpenFolder.classList.remove('hidden');

        // Render direct download link(s) for browser / cloud deployment
        const existingActions = document.getElementById('hud-file-actions');
        if (existingActions) existingActions.remove();

        if (evt.files && evt.files.length > 0) {
          const actionContainer = document.createElement('div');
          actionContainer.id = 'hud-file-actions';
          actionContainer.style.marginTop = '16px';
          actionContainer.style.display = 'flex';
          actionContainer.style.flexDirection = 'column';
          actionContainer.style.gap = '8px';

          const heading = document.createElement('div');
          heading.style.fontSize = '0.85rem';
          heading.style.color = 'var(--text-muted)';
          heading.style.fontWeight = '600';
          heading.textContent = 'Save directly to your device:';
          actionContainer.appendChild(heading);

          evt.files.forEach(fileName => {
            const dlBtn = document.createElement('a');
            dlBtn.className = 'btn btn-primary btn-sm';
            dlBtn.style.textDecoration = 'none';
            dlBtn.style.display = 'inline-flex';
            dlBtn.style.alignItems = 'center';
            dlBtn.style.justifyContent = 'center';
            dlBtn.style.gap = '8px';
            dlBtn.style.width = 'fit-content';
            dlBtn.href = `/api/download-file?jobId=${state.activeJobId}&filename=${encodeURIComponent(fileName)}`;
            dlBtn.download = fileName;
            dlBtn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Download: ${escapeHtml(fileName.length > 40 ? fileName.substring(0, 37) + '…' : fileName)}</span>
            `;
            actionContainer.appendChild(dlBtn);
          });

          hudDetail.insertAdjacentElement('afterend', actionContainer);

          // If single file, auto trigger download after slight delay
          if (evt.files.length === 1) {
            setTimeout(() => {
              const a = document.createElement('a');
              a.href = `/api/download-file?jobId=${state.activeJobId}&filename=${encodeURIComponent(evt.files[0])}`;
              a.download = evt.files[0];
              document.body.appendChild(a);
              a.click();
              a.remove();
            }, 500);
          }
        }

        // Add to history
        addHistoryItem({
          title: state.currentMedia?.title || 'YouTube Download',
          format: state.selectedQuality,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          outputDir: evt.outputDir
        });

        showToast('Download complete!', 'success');
        break;

      case 'error':
        hudStatusTitle.textContent = 'Download Error';
        hudPhase.textContent = 'Failed';
        hudDetail.textContent = evt.message || 'Error during download.';
        showToast(evt.message || 'Download failed', 'error');
        break;
    }
  }

  // Cancel
  btnCancelDownload.addEventListener('click', async () => {
    if (!state.activeJobId) return;
    try {
      await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: state.activeJobId })
      });
      if (state.activeEventSource) {
        state.activeEventSource.close();
        state.activeEventSource = null;
      }
      hudStatusTitle.textContent = 'Download Cancelled';
      hudPhase.textContent = 'Cancelled';
      hudDetail.textContent = 'Operation aborted by user.';
      btnCancelDownload.classList.add('hidden');
      showToast('Download cancelled', 'info');
    } catch (err) {
      showToast('Could not cancel download: ' + err.message, 'error');
    }
  });

  // Open folder
  btnOpenFolder.addEventListener('click', () => openDownloadsFolder());
  btnQuickOpenFolder.addEventListener('click', () => openDownloadsFolder());

  async function openDownloadsFolder() {
    try {
      const res = await fetch('/api/open-folder');
      const data = await res.json();
      if (data.status === 'opened') {
        showToast('Opening downloads folder…', 'info');
      } else {
        showToast(data.message || 'Could not open folder.', 'info');
      }
    } catch (err) {
      showToast('Failed to open folder: ' + err.message, 'error');
    }
  }

  // ─────────────────────────────────────────────
  // Download History
  // ─────────────────────────────────────────────
  function addHistoryItem(item) {
    state.history.unshift(item);
    if (state.history.length > 20) state.history.pop();
    localStorage.setItem('mediadl_history', JSON.stringify(state.history));
    renderHistory();
  }

  function renderHistory() {
    historyList.innerHTML = '';
    if (state.history.length === 0) {
      historyEmpty.classList.remove('hidden');
      historyList.appendChild(historyEmpty);
      return;
    }

    historyEmpty.classList.add('hidden');
    state.history.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.innerHTML = `
        <span class="history-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:0.75rem;color:var(--text-dim);">${escapeHtml(item.format.toUpperCase())} • ${escapeHtml(item.time)}</span>
          <button type="button" class="btn-tool btn-open-history" title="Open folder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </button>
        </div>
      `;
      el.querySelector('.btn-open-history').addEventListener('click', () => openDownloadsFolder());
      historyList.appendChild(el);
    });
  }

  btnClearHistory.addEventListener('click', () => {
    state.history = [];
    localStorage.removeItem('mediadl_history');
    renderHistory();
  });

  // ── Initialize ──
  fetchAuthStatus();
  renderHistory();
});

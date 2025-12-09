/* =========================================================
   [1] RIFERIMENTI DOM
   ========================================================= */
const APP_VERSION = "3.3.15";

const audio = document.getElementById("audioPlayer");
const listContainer = document.getElementById("trackList");
const currentTitle = document.getElementById("currentTitle");
const currentCover = document.getElementById("currentCover");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const statusText = document.getElementById("statusText");
const spinner = document.getElementById("spinner");

const showDraftsChk = document.getElementById("showDraftsChk");
const onlyFavsChk = document.getElementById("onlyFavsChk");

const prevLyricEl = document.getElementById("prevLyric") || { textContent: "" };
const currentLyricEl = document.getElementById("currentLyric") || { textContent: "" };
const nextLyricEl = document.getElementById("nextLyric") || { textContent: "" };

/* =========================================================
   [2] STATO APPLICAZIONE
   ========================================================= */
let allTracks = [];
let visibleTracks = [];
let currentIndex = 0;

let currentLyrics = [];
let currentLyricIndex = -1;

// Tracking percentuali ascoltate
let progressMilestones = {
  p25: false,
  p50: false,
  p75: false,
  p100: false
};

// Liked songs (stored in cookies)
let likedSongs = new Set();

// Secret mode state
let secretModeActive = false;
let secretModeClickCount = 0;
let secretModeClickTimer = null;

/* =========================================================
   [2.1] COOKIE HELPERS
   ========================================================= */
function loadLikedSongs() {
  const cookie = document.cookie.split('; ').find(row => row.startsWith('likedSongs='));
  if (cookie) {
    try {
      const data = JSON.parse(decodeURIComponent(cookie.split('=')[1]));
      likedSongs = new Set(data);
    } catch (e) {
      likedSongs = new Set();
    }
  }
}

function saveLikedSongs() {
  const data = JSON.stringify([...likedSongs]);
  // Cookie expires in 1 year
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);
  document.cookie = `likedSongs=${encodeURIComponent(data)}; expires=${expires.toUTCString()}; path=/`;
}

function toggleLike(trackTitle) {
  if (likedSongs.has(trackTitle)) {
    likedSongs.delete(trackTitle);
  } else {
    likedSongs.add(trackTitle);
  }
  saveLikedSongs();
  
  // Track in GA
  try {
    gtag('event', likedSongs.has(trackTitle) ? 'song_liked' : 'song_unliked', {
      song_title: trackTitle
    });
  } catch (e) {}
  
  // Refresh list if favorites filter is active
  if (onlyFavsChk.checked) {
    applyFilterAndRender();
  }
}

/* =========================================================
   [2.2] SHARE FUNCTIONALITY
   ========================================================= */
async function shareTrack(track) {
  // Extract filename from audio path (e.g., "./mp3/sancarlo.mp3" -> "sancarlo")
  const audioPath = track.audio;
  const filename = audioPath.split('/').pop().replace(/\.[^/.]+$/, "");
  
  // Build share URL
  const baseUrl = window.location.origin + window.location.pathname;
  const shareUrl = `${baseUrl}?song=${encodeURIComponent(filename)}`;
  
  const shareData = {
    title: track.title,
    text: `Listen to "${track.title}" by niko.fanta`,
    url: shareUrl
  };
  
  // Try native share API first (mobile)
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      
      // Track in GA
      try {
        gtag('event', 'song_shared', {
          song_title: track.title,
          share_method: 'native'
        });
      } catch (e) {}
      
      return;
    }
  } catch (err) {
    // If user cancels, do nothing
    if (err.name === 'AbortError') {
      return;
    }
    // Fall through to clipboard for other errors
  }
  
  // Fallback: copy to clipboard (desktop or if share fails)
  try {
    await navigator.clipboard.writeText(shareUrl);
    
    setStatus("Link copiato negli appunti!", "ok", false);
    
    // Track in GA
    try {
      gtag('event', 'song_shared', {
        song_title: track.title,
        share_method: 'clipboard'
      });
    } catch (e) {}
  } catch (clipErr) {
    // Last resort: show alert with URL (happens on HTTP or insecure contexts)
    alert(`Copia questo link:\n\n${shareUrl}`);
    
    // Track in GA
    try {
      gtag('event', 'song_shared', {
        song_title: track.title,
        share_method: 'manual'
      });
    } catch (e) {}
  }
}

/* =========================================================
   [3] STATUS HELPERS
   ========================================================= */
function setStatus(msg, mode = "ok", spinning = false) {
  const statusOverlay = document.getElementById("statusOverlay");
  statusText.textContent = msg;
  statusOverlay.className = `status-overlay ${mode}`;
  spinner.classList.toggle("show", spinning);
  
  // Always show the status first
  statusOverlay.classList.remove("hidden");
  
  // Auto-hide status after 6 seconds if ok and not spinning
  if (mode === "ok" && !spinning) {
    setTimeout(() => {
      statusOverlay.classList.add("hidden");
    }, 6000);
  }
}

/* =========================================================
   [4] LOAD TRACKS JSON
   ========================================================= */
async function loadTracks() {
  setStatus("Caricamento playlist...", "loading", true);

  const response = await fetch("tracks.json");
  allTracks = await response.json();
  
  // Resolve relative paths to full URLs
  allTracks = allTracks.map(track => ({
    ...track,
    audio: resolveAssetPath(track.audio, 'mp3'),
    cover: resolveAssetPath(track.cover, 'covers'),
    lrc: track.lrc ? resolveAssetPath(track.lrc, 'lrc') : undefined
  }));

  // First apply filter to populate visibleTracks
  applyFilterAndRender();
  
  // Check if URL has song parameter and auto-play it
  checkUrlParameters();

  setStatus("Seleziona un brano per iniziare", "ok", false);
}

/* =========================================================
   [4.1] RESOLVE ASSET PATHS
   ========================================================= */
function resolveAssetPath(path, folder) {
  // If already a full URL, return as is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  
  // Otherwise, prepend the folder path
  return `./${folder}/${path}`;
}

/* =========================================================
   [4.2] CHECK URL PARAMETERS FOR SONG SELECTION
   ========================================================= */
function checkUrlParameters() {
  const params = new URLSearchParams(window.location.search);
  
  // Check for ?song=filename parameter (without .mp3 extension)
  const songParam = params.get('song');
  if (songParam) {
    // Search in allTracks first to handle draft/secret songs
    const trackIndex = allTracks.findIndex(t => {
      // Extract filename from audio path without extension
      const audioFilename = t.audio.split('/').pop().replace('.mp3', '');
      return audioFilename.toLowerCase() === songParam.toLowerCase();
    });
    
    if (trackIndex !== -1) {
      const track = allTracks[trackIndex];
      
      // Auto-enable filters if needed
      if (track.isDraft && !showDraftsChk.checked) {
        showDraftsChk.checked = true;
      }
      if (track.isSecret && !secretModeActive) {
        toggleSecretMode();
      }
      
      // Re-apply filters with new settings
      applyFilterAndRender();
      
      // Find index in visible tracks and load it
      const visibleIndex = visibleTracks.findIndex(t => t.audio === track.audio);
      if (visibleIndex !== -1) {
        loadTrack(visibleIndex, true);
      }
      return true;
    }
  }
  
  return false;
}

/* =========================================================
   [5] FILTRO DRAFT + RENDER + SECRET MODE + FAVORITES
   ========================================================= */
function applyFilterAndRender() {
  const showDrafts = showDraftsChk.checked;
  const onlyFavs = onlyFavsChk.checked;
  
  // Check if favorites filter is active but no favorites exist
  if (onlyFavs && likedSongs.size === 0) {
    visibleTracks = [];
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    currentTitle.textContent = "";
    currentCover.src = "./icons/icon-512.png";
    currentIndex = -1;
    clearLyrics("");
    setStatus("Seleziona almeno una canzone come favorita per abilitare questo filtro", "warning", false);
    renderList();
    return;
  }
  
  visibleTracks = allTracks.filter(t => {
    // Secret songs always require secret mode
    if (t.isSecret === true && !secretModeActive) return false;
    
    // If favorites filter is active, show all favorites (including drafts)
    if (onlyFavs) {
      return likedSongs.has(t.title);
    }
    
    // Otherwise, apply draft filter normally
    if (t.isDraft === true && !showDrafts) return false;
    return true;
  });

  // Clear selection when filter changes
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  currentTitle.textContent = "";
  currentCover.src = "./icons/icon-512.png";
  currentIndex = -1;
  clearLyrics("");
  
  // Render the list
  renderList();
  
  if (visibleTracks.length === 0) {
    setStatus("Nessun brano disponibile", "ok", false);
  } else {
    setStatus("Seleziona un brano per iniziare", "ok", false);
  }
}

/* =========================================================
   [5.1] SECRET MODE ACTIVATION
   ========================================================= */
function handleSecretModeClick() {
  secretModeClickCount++;
  
  // Clear previous timer
  if (secretModeClickTimer) {
    clearTimeout(secretModeClickTimer);
  }
  
  // Reset counter after 2 seconds of no clicks
  secretModeClickTimer = setTimeout(() => {
    secretModeClickCount = 0;
  }, 2000);
  
  // Activate secret mode after 8 clicks
  if (secretModeClickCount >= 8) {
    secretModeClickCount = 0;
    toggleSecretMode();
  }
}

function toggleSecretMode() {
  secretModeActive = !secretModeActive;
  
  // Store in sessionStorage (cleared on browser close)
  sessionStorage.setItem('secretMode', secretModeActive ? 'true' : 'false');
  
  // Show indicator
  const indicator = document.getElementById('secretModeIndicator');
  indicator.classList.toggle('hidden', !secretModeActive);
  
  // Show popup notification
  showSecretModePopup();
  
  // Re-render with new filter
  applyFilterAndRender();
}

function showSecretModePopup() {
  const popup = document.getElementById('secretModePopup');
  const content = popup.querySelector('.secret-popup-content');
  
  if (secretModeActive) {
    content.querySelector('h3').textContent = '🔓 Secret Mode Activated!';
    content.querySelector('p').textContent = 'Hidden tracks are now visible';
  } else {
    content.querySelector('h3').textContent = '🔒 Secret Mode Deactivated';
    content.querySelector('p').textContent = 'Hidden tracks are now hidden';
  }
  
  popup.classList.remove('hidden');
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    popup.classList.add('hidden');
  }, 3000);
}

function loadSecretMode() {
  const stored = sessionStorage.getItem('secretMode');
  if (stored === 'true') {
    secretModeActive = true;
    const indicator = document.getElementById('secretModeIndicator');
    indicator.classList.remove('hidden');
  }
}

/* =========================================================
   [6] RENDER LISTA BRANI
   ========================================================= */
function renderList() {
  listContainer.innerHTML = "";

  visibleTracks.forEach((track, index) => {
    const li = document.createElement("li");
    if (track.isDraft === true) li.classList.add("draft");
    if (track.isSecret === true) li.classList.add("secret");
    
    // Check if this is the currently playing track by comparing audio source
    // Only mark as active if audio has a valid src attribute and it matches the track
    const hasValidSrc = audio.hasAttribute('src') && audio.getAttribute('src') !== '';
    if (hasValidSrc && audio.src === track.audio) {
      li.classList.add("active");
    }

    const isLiked = likedSongs.has(track.title);

    li.innerHTML = `
      <div class="thumb">
        <img src="${track.cover}" alt="cover">
        ${track.isDraft ? '<div class="draft-mask"></div>' : ""}
        ${track.isSecret ? '<div class="secret-mask"></div>' : ""}
      </div>
      <span class="track-title">${track.title}</span>
      <button class="share-btn" data-index="${index}" aria-label="Share ${track.title}">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>
        </svg>
      </button>
      <button class="heart-btn ${isLiked ? 'liked' : ''}" data-index="${index}" aria-label="${isLiked ? 'Unlike' : 'Like'} ${track.title}">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
        </svg>
      </button>
    `;

    li.querySelector('.track-title').addEventListener("click", () => loadTrack(index, true));
    li.querySelector('.thumb').addEventListener("click", () => loadTrack(index, true));
    
    // Share button click handler
    const shareBtn = li.querySelector('.share-btn');
    shareBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      shareTrack(track);
    });
    
    // Heart button click handler
    const heartBtn = li.querySelector('.heart-btn');
    heartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLike(track.title);
      heartBtn.classList.toggle('liked');
      heartBtn.setAttribute('aria-label', heartBtn.classList.contains('liked') ? `Unlike ${track.title}` : `Like ${track.title}`);
    });

    listContainer.appendChild(li);
  });
}

/* =========================================================
   [7] LOAD BRANO + UI + MEDIA SESSION + LRC
   ========================================================= */
function loadTrack(index, autoplay = true) {
  currentIndex = index;

  // reset tracking percentuali
  progressMilestones = { p25: false, p50: false, p75: false, p100: false };

  const track = visibleTracks[index];

  audio.src = track.audio;
  currentTitle.textContent = track.title;
  currentCover.src = track.cover;

  [...listContainer.children].forEach((li, i) => {
    li.classList.toggle("active", i === index);
  });

  setStatus("Caricamento brano...", "loading", true);

  setupMediaSession(track);

  if (track.lrc) loadLrc(track.lrc);
  else clearLyrics("Testo non disponibile");

  if (autoplay) audio.play().catch(() => {});
}

/* =========================================================
   [7.1] MEDIA SESSION API
   ========================================================= */
function setupMediaSession(track) {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: "Dome",
    album: "Playlist",
    artwork: [
      { src: track.cover, sizes: "512x512", type: "image/png" },
      { src: track.cover, sizes: "256x256", type: "image/png" },
      { src: track.cover, sizes: "128x128", type: "image/png" }
    ]
  });

  navigator.mediaSession.setActionHandler("play", () => audio.play());
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", playPrev);
  navigator.mediaSession.setActionHandler("nexttrack", playNext);
}

/* =========================================================
   [8] NAVIGAZIONE PREV/NEXT
   ========================================================= */
function playPrev() {
  let prev = currentIndex - 1;
  if (prev < 0) prev = visibleTracks.length - 1;
  loadTrack(prev, true);
}

function playNext() {
  let next = currentIndex + 1;
  if (next >= visibleTracks.length) next = 0;
  loadTrack(next, true);
}

prevBtn.addEventListener("click", playPrev);
nextBtn.addEventListener("click", playNext);

/* =========================================================
   [9] AUTOPLAY NEXT
   ========================================================= */
audio.addEventListener("ended", () => {
  playNext();
});

/* =========================================================
   [10] EVENTI AUDIO + TRACKING PLAY
   ========================================================= */
audio.addEventListener("playing", () => {
  setStatus("In riproduzione", "ok", false);

  // Event GA: inizio riproduzione
  try {
    const track = visibleTracks[currentIndex];
    gtag('event', 'play_song', {
      song_title: track.title,
      is_draft: track.isDraft || false,
      device_type: /mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop'
    });
  } catch (e) { console.warn("GA error", e); }

  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
});

/* =========================================================
   [11] LRC: CARICAMENTO E PARSING
   ========================================================= */
async function loadLrc(url) {
  try {
    clearLyrics("Caricamento testo...");
    const resp = await fetch(url);
    if (!resp.ok) return clearLyrics("Impossibile caricare il testo");

    const text = await resp.text();
    parseLrc(text);

    if (currentLyrics.length === 0) {
      clearLyrics("Nessun testo valido nel file LRC");
    } else {
      prevLyricEl.textContent = "";
      nextLyricEl.textContent = "";
      currentLyricEl.textContent = "";
    }
  } catch {
    clearLyrics("Errore nel caricamento del testo");
  }
}

function clearLyrics(msg = "Testo non disponibile") {
  currentLyrics = [];
  currentLyricIndex = -1;
  prevLyricEl.textContent = "";
  nextLyricEl.textContent = "";
  currentLyricEl.textContent = msg;
}

function parseLrc(text) {
  currentLyrics = [];
  currentLyricIndex = -1;

  const lines = text.split(/\r?\n/);
  const regex = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/;

  for (const line of lines) {
    const m = line.match(regex);
    if (!m) continue;

    const min = parseInt(m[1], 10);
    const sec = parseInt(m[2], 10);
    const frac = parseInt(m[3] || "0", 10);

    const t = min * 60 + sec + (m[3] ? frac / (m[3].length === 2 ? 100 : 1000) : 0);
    const text = m[4].trim();

    if (text) currentLyrics.push({ time: t, text });
  }

  currentLyrics.sort((a, b) => a.time - b.time);
}

/* =========================================================
   [12] LRC: SYNC + TRACKING PERCENTUALI
   ========================================================= */
audio.addEventListener("timeupdate", () => {
  if (currentLyrics.length) {
    const t = audio.currentTime;
    let idx = -1;

    for (let i = 0; i < currentLyrics.length; i++) {
      if (currentLyrics[i].time <= t) idx = i;
      else break;
    }

    if (idx !== currentLyricIndex) {
      currentLyricIndex = idx;

      prevLyricEl.textContent = currentLyrics[idx - 1]?.text || "";
      currentLyricEl.textContent = currentLyrics[idx]?.text || "";
      nextLyricEl.textContent = currentLyrics[idx + 1]?.text || "";
    }
  }

  // ========== TRACKING PERCENTUALI ==========
  if (audio.duration && !isNaN(audio.duration)) {
    const pct = (audio.currentTime / audio.duration) * 100;
    const track = visibleTracks[currentIndex];

    if (pct >= 25 && !progressMilestones.p25) {
      progressMilestones.p25 = true;
      gtag('event', 'song_progress_25', { song_title: track.title });
    }

    if (pct >= 50 && !progressMilestones.p50) {
      progressMilestones.p50 = true;
      gtag('event', 'song_progress_50', { song_title: track.title });
    }

    if (pct >= 75 && !progressMilestones.p75) {
      progressMilestones.p75 = true;
      gtag('event', 'song_progress_75', { song_title: track.title });
    }

    if (pct >= 99 && !progressMilestones.p100) {
      progressMilestones.p100 = true;
      gtag('event', 'song_complete', { song_title: track.title });
    }
  }
});

/* =========================================================
   [13] TOGGLE DRAFTS + SECRET MODE TRIGGER + FAVORITES
   ========================================================= */
showDraftsChk.addEventListener("change", applyFilterAndRender);
showDraftsChk.addEventListener("click", handleSecretModeClick);
onlyFavsChk.addEventListener("change", applyFilterAndRender);

/* =========================================================
   [13.5] PWA INSTALL PROMPT
   ========================================================= */
let deferredPrompt;
const installBanner = document.getElementById('installBanner');
const installBtn = document.getElementById('installBtn');
const dismissInstallBtn = document.getElementById('dismissInstallBtn');

// Check if already dismissed or installed
if (!localStorage.getItem('installDismissed') && !window.matchMedia('(display-mode: standalone)').matches) {
  
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBanner.classList.remove('hidden');
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        installBanner.classList.add('hidden');
      }
      deferredPrompt = null;
    });
  }

  if (dismissInstallBtn) {
    dismissInstallBtn.addEventListener('click', () => {
      installBanner.classList.add('hidden');
      localStorage.setItem('installDismissed', 'true');
    });
  }
}

/* =========================================================
   [14] SERVICE WORKER + UPDATE DETECTION
   ========================================================= */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(registration => {
    console.log('Service Worker registered');

    // Check for updates immediately on load
    registration.update().catch(() => {});

    // Check for updates periodically
    setInterval(() => {
      registration.update().catch(() => {});
    }, 10000); // Check every 10 seconds (more aggressive for testing)

    // Listen for new service worker
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New service worker available
          showUpdateBanner();
        }
      });
    });
  }).catch(err => {
    console.warn('Service Worker registration failed:', err);
  });

  // Handle controller change (when new SW takes over)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
  
  // Suppress message channel errors
  window.addEventListener('unhandledrejection', event => {
    if (event.reason?.message?.includes('message channel closed')) {
      event.preventDefault();
    }
  });
}

function showUpdateBanner() {
  const banner = document.getElementById('updateBanner');
  const updateBtn = document.getElementById('updateBtn');
  
  if (banner) {
    banner.classList.remove('hidden');
    
    updateBtn.onclick = () => {
      // Skip waiting and activate new service worker
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    };
  }
}

/* =========================================================
   [15] AVVIO
   ========================================================= */
loadLikedSongs();
loadSecretMode();
loadTracks();




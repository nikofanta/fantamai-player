/* =========================================================
   [1] RIFERIMENTI DOM
   ========================================================= */
const APP_VERSION = "5.3.16";

// Configuration for tracks.json source
const CONFIG = {
  tracksSource: "local", // "local" or "remote"
  remoteAPI: "https://www.fantamai.com/API/api/tracks" // Used only when tracksSource is "remote"
};

const audio = document.getElementById("audioPlayer");
const listContainer = document.getElementById("trackList");
const currentTitle = document.getElementById("currentTitle");
const currentCover = document.getElementById("currentCover");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const lyricsToggleBtn = document.getElementById("lyricsToggleBtn");

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

/* =========================================================
   [2.1.5] ACTIVE CODES MANAGEMENT
   ========================================================= */
let activeCodes = [];

function loadActiveCodes() {
  const stored = localStorage.getItem('activeCodes');
  if (stored) {
    try {
      activeCodes = JSON.parse(stored);
    } catch (e) {
      activeCodes = [];
    }
  }
}

function saveActiveCodes() {
  localStorage.setItem('activeCodes', JSON.stringify(activeCodes));
}

function addActiveCode(code) {
  const upperCode = code.toUpperCase();
  if (!activeCodes.includes(upperCode)) {
    activeCodes.push(upperCode);
    saveActiveCodes();
    
    // Reload tracks from API with new code
    loadTracks();
    
    // Enable secret mode when codes are active
    if (!secretModeActive) {
      secretModeActive = true;
    }
    
    return true;
  }
  return false;
}

function clearActiveCodes() {
  activeCodes = [];
  saveActiveCodes();
  
  // Reload tracks from API without codes
  loadTracks();
  
  // Optionally disable secret mode when codes are cleared
  if (secretModeActive) {
    secretModeActive = false;
  }
}

/* =========================================================
   [2.2] SESSION ID MANAGEMENT
   ========================================================= */
function getSessionId() {
  let sessionId = localStorage.getItem('sessionId');
  if (!sessionId) {
    // Generate random number between 1000 and 9999
    sessionId = Math.floor(Math.random() * 9000) + 1000;
    localStorage.setItem('sessionId', sessionId.toString());
  }
  return sessionId;
}

/* =========================================================
   [2.3] API PARAMETERS COMPUTATION
   ========================================================= */
function getAPIParameters() {
  return {
    SessionId: getSessionId(),
    FAV: likedSongs.size,
    LIS: getTotalPlayCount(),
    ActiveCodes: activeCodes.join(','),
    APP: window.matchMedia('(display-mode: standalone)').matches ? 1 : 0
  };
}

/* =========================================================
   [2.4] SEND EVENT TO API
   ========================================================= */
function sendEventToAPI(eventType, value) {
  try {
    const sessionId = getSessionId();
    const url = `https://www.fantamai.com/API/api/events?sessionId=${sessionId}&eventType=${eventType}&value=${encodeURIComponent(value)}`;
    fetch(url, { method: 'POST' }).catch(err => {
      console.log('Event tracking failed:', err);
    });
  } catch (e) {
    console.log('Event tracking error:', e);
  }
}

function toggleLike(trackTitle) {
  const wasLiked = likedSongs.has(trackTitle);
  
  if (wasLiked) {
    likedSongs.delete(trackTitle);
  } else {
    likedSongs.add(trackTitle);
  }
  saveLikedSongs();
  
  // Find track and get audio filename without extension
  const track = allTracks.find(t => t.title === trackTitle);
  if (track && track.audio) {
    const audioFilename = track.audio.replace(/\.mp3$/i, '');
    sendEventToAPI(wasLiked ? 'FavOff' : 'FavOn', audioFilename);
  }
  
  // Refresh list if favorites filter is active
  if (onlyFavsChk.classList.contains('active')) {
    applyFilterAndRender();
  }
}

/* =========================================================
   [2.4] SHARE FUNCTIONALITY (SIMPLIFIED)
   ========================================================= */
async function shareTrack(track) {
  // Don't share if app is hidden (prevents Chrome notification issue)
  if (document.hidden) {
    return;
  }
  
  // Extract filename from audio path (e.g., "./mp3/sancarlo.mp3" -> "sancarlo")
  const audioPath = track.audio;
  const filename = audioPath.split('/').pop().replace(/\.[^/.]+$/, "");
  
  // Build share URL
  const baseUrl = window.location.origin + window.location.pathname;
  const shareUrl = `${baseUrl}?song=${encodeURIComponent(filename)}`;
  
  // Always use clipboard (simpler, more reliable)
  try {
    if (!navigator.clipboard) {
      throw new Error('Clipboard API not available');
    }
    await navigator.clipboard.writeText(shareUrl);
    setStatus("Link copiato negli appunti!", "ok", false);
    
    // Send share event to API
    sendEventToAPI('SharedSong', filename);
  } catch (err) {
    console.error('Clipboard failed:', err);
    // Last resort: show alert with URL
    alert(`Copia questo link:\n\n${shareUrl}`);
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

  try {
    // Determine URL based on configuration
    let tracksUrl = CONFIG.tracksSource === "remote" 
      ? CONFIG.remoteAPI 
      : "tracks.json?v=" + APP_VERSION;
    
    // Append API parameters if using remote source
    if (CONFIG.tracksSource === "remote") {
      const params = getAPIParameters();
      const queryString = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      tracksUrl += (tracksUrl.includes('?') ? '&' : '?') + queryString;
      console.log('API Request URL:', tracksUrl);
      console.log('API Parameters:', params);
    }
    
    const response = await fetch(tracksUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
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
  } catch (error) {
    const source = CONFIG.tracksSource === "remote" ? "remote API" : "local tracks.json";
    setStatus(`Errore caricamento playlist da ${source}: ${error.message}`, "error", false);
    console.error(`Failed to load tracks from ${source}:`, error);
  }
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
      if (track.isDraft && !showDraftsChk.classList.contains('active')) {
        showDraftsChk.classList.add('active');
      }
      if (track.isSecret && !secretModeActive) {
        toggleSecretMode();
      }
      
      // Re-apply filters with new settings
      applyFilterAndRender();
      
      // Force enable lyrics for URL-selected songs
      localStorage.setItem('lyricsVisible', 'true');
      if (lyricsToggleBtn) {
        lyricsToggleBtn.classList.add('active');
        const lyricsContainer = document.querySelector('.lyrics-nav-container');
        if (lyricsContainer) lyricsContainer.classList.remove('hidden');
      }
      
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
  const showDrafts = showDraftsChk.classList.contains('active');
  const onlyFavs = onlyFavsChk.classList.contains('active');
  
  // Check if favorites filter is active but no favorites exist
  if (onlyFavs && likedSongs.size === 0) {
    visibleTracks = [];
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    currentTitle.textContent = "";
    currentCover.src = "./covers/nosong.png";
    
    // Clear blurred background
    const trackContainer = document.getElementById('currentTrackContainer');
    trackContainer.style.setProperty('--cover-image', 'none');
    
    // Hide lyrics container
    const lyricsContainer = document.querySelector('.lyrics-nav-container');
    if (lyricsContainer) {
      lyricsContainer.classList.add('hidden');
      // Update button state to match container visibility
      if (lyricsToggleBtn) lyricsToggleBtn.classList.remove('active');
    }
    
    currentIndex = -1;
    clearLyrics("");
    setStatus("Seleziona almeno una canzone come favorita per abilitare questo filtro", "warning", false);
    renderList();
    return;
  }
  
  // Remember currently playing track (if any)
  const currentlyPlayingTrack = currentIndex >= 0 ? visibleTracks[currentIndex] : null;
  const wasPlaying = !audio.paused;
  
  visibleTracks = allTracks.filter(t => {
    // Secret songs are visible if secret mode is active OR if there are active codes
    if (t.isSecret === true && !secretModeActive && activeCodes.length === 0) return false;
    
    // If favorites filter is active, show all favorites (including drafts)
    if (onlyFavs) {
      return likedSongs.has(t.title);
    }
    
    // Otherwise, apply draft filter normally
    if (t.isDraft === true && !showDrafts) return false;
    return true;
  });

  // Check if currently playing track is still in filtered list
  let newIndex = -1;
  if (currentlyPlayingTrack) {
    newIndex = visibleTracks.findIndex(t => t.audio === currentlyPlayingTrack.audio);
  }
  
  if (newIndex >= 0) {
    // Current track is still visible, keep playing and update index
    currentIndex = newIndex;
  } else if (currentlyPlayingTrack && wasPlaying) {
    // Current track was filtered out, but let it finish playing
    currentIndex = -1; // Will start from beginning when this song ends
    // Don't stop the audio - let it play to completion
  } else {
    // No song was playing, clear everything
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    currentTitle.textContent = "";
    currentCover.src = "./covers/nosong.png";
    
    // Clear blurred background
    const trackContainer = document.getElementById('currentTrackContainer');
    trackContainer.style.setProperty('--cover-image', 'none');
    
    // Hide lyrics container
    const lyricsContainer = document.querySelector('.lyrics-nav-container');
    if (lyricsContainer) {
      lyricsContainer.classList.add('hidden');
      // Update button state to match container visibility
      if (lyricsToggleBtn) lyricsToggleBtn.classList.remove('active');
    }
    
    currentIndex = -1;
    clearLyrics("");
  }
  
  // Render the list
  renderList();
  
  if (visibleTracks.length === 0) {
    setStatus("Nessun brano disponibile", "ok", false);
  } else if (currentIndex === -1 && !wasPlaying) {
    setStatus("Seleziona un brano per iniziare", "ok", false);
  }
}

/* =========================================================
   [5.1] CODE PANEL FUNCTIONALITY
   ========================================================= */
function showCodePanel() {
  const panel = document.getElementById('codePanel');
  const input = document.getElementById('codeInput');
  const error = document.getElementById('codeError');
  const success = document.getElementById('codeSuccess');
  
  // Reset panel state
  input.value = '';
  error.textContent = '';
  error.classList.add('hidden');
  success.textContent = '';
  success.classList.add('hidden');
  
  panel.classList.remove('hidden');
  
  // Focus input
  setTimeout(() => input.focus(), 100);
}

function validateCode(code) {
  // Must be exactly 4 characters
  if (code.length !== 4) {
    return { valid: false, message: 'Il codice deve essere di 4 caratteri' };
  }
  
  // Must be alphanumeric (letters and numbers only)
  if (!/^[A-Z0-9]+$/i.test(code)) {
    return { valid: false, message: 'Il codice deve contenere solo lettere e numeri' };
  }
  
  return { valid: true };
}

function submitCode() {
  const input = document.getElementById('codeInput');
  const error = document.getElementById('codeError');
  const success = document.getElementById('codeSuccess');
  const code = input.value.trim();
  
  // Validate
  const validation = validateCode(code);
  if (!validation.valid) {
    error.textContent = validation.message;
    error.classList.remove('hidden');
    success.classList.add('hidden');
    return;
  }
  
  // Add code
  const added = addActiveCode(code);
  
  error.classList.add('hidden');
  
  if (added) {
    success.textContent = `✓ Codice "${code.toUpperCase()}" aggiunto con successo!`;
    success.classList.remove('hidden');
    
    // Clear input and auto-close after 2 seconds
    input.value = '';
    setTimeout(() => {
      document.getElementById('codePanel').classList.add('hidden');
    }, 2000);
  } else {
    success.textContent = `ℹ️ Codice "${code.toUpperCase()}" già presente`;
    success.classList.remove('hidden');
    input.value = '';
  }
}

function toggleSecretMode() {
  secretModeActive = !secretModeActive;
  
  // Re-render with new filter
  applyFilterAndRender();
}

function loadSecretMode() {
  // Auto-enable secret mode if there are active codes
  if (activeCodes.length > 0) {
    secretModeActive = true;
  }
}

/* =========================================================
   [6] RENDER LISTA BRANI
   ========================================================= */
function renderList() {
  listContainer.innerHTML = "";
  
  // Update track counter
  const trackCounter = document.getElementById('trackCounter');
  if (trackCounter) {
    trackCounter.textContent = `(${visibleTracks.length})`;
  }

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
  
  // Set blurred background image on container
  const trackContainer = document.getElementById('currentTrackContainer');
  trackContainer.style.setProperty('--cover-image', `url('${track.cover}')`);

  // Sync lyrics container visibility with button state
  const lyricsContainer = document.querySelector('.lyrics-nav-container');
  if (lyricsContainer && lyricsToggleBtn) {
    // Button state is the source of truth
    const buttonIsActive = lyricsToggleBtn.classList.contains('active');
    if (buttonIsActive) {
      lyricsContainer.classList.remove('hidden');
    } else {
      lyricsContainer.classList.add('hidden');
    }
  }

  [...listContainer.children].forEach((li, i) => {
    li.classList.toggle("active", i === index);
  });

  setStatus("Caricamento brano...", "loading", true);

  setupMediaSession(track);

  if (track.lrc) loadLrc(track.lrc);
  else clearLyrics("Testo non disponibile");

  if (autoplay) {
    audio.play().catch(() => {
      // Autoplay blocked by browser - show play button overlay
      const playOverlay = document.getElementById('playButtonOverlay');
      if (playOverlay) playOverlay.classList.remove('hidden');
      setStatus("Premi il bottone Play per ascoltare il brano", "ok", false);
    });
  }
}

/* =========================================================
   [7.1] MEDIA SESSION API
   ========================================================= */
function setupMediaSession(track) {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: "fantaMai",
    album: "PRJ fantaMai",
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
  // If currentIndex is -1 (song was filtered out), start from end
  if (currentIndex === -1 || currentIndex <= 0) {
    loadTrack(visibleTracks.length - 1, true);
  } else {
    loadTrack(currentIndex - 1, true);
  }
}

function playNext() {
  // If currentIndex is -1 (song was filtered out), start from beginning
  if (currentIndex === -1 || currentIndex >= visibleTracks.length - 1) {
    loadTrack(0, true);
  } else {
    loadTrack(currentIndex + 1, true);
  }
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
      device_type: /mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
      listen_count: getTotalPlayCount(),
      secret_mode_enabled: secretModeActive
    });
  } catch (e) { console.warn("GA error", e); }

  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  
  // Hide play button overlay when playback starts
  const playOverlay = document.getElementById('playButtonOverlay');
  if (playOverlay) playOverlay.classList.add('hidden');
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
      
      // Increment total play count
      incrementPlayCount();
      updateMedalBadge();
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
// Draft cruet button toggle
showDraftsChk.addEventListener("click", (e) => {
  showDraftsChk.classList.toggle('active');
  applyFilterAndRender();
});

// Secret code button
const secretCodeBtn = document.getElementById('secretCodeBtn');
const codePanel = document.getElementById('codePanel');
const closeCodeBtn = document.getElementById('closeCodeBtn');
const confirmCodeBtn = document.getElementById('confirmCodeBtn');
const clearCodesBtn = document.getElementById('clearCodesBtn');
const codeInput = document.getElementById('codeInput');

if (secretCodeBtn && codePanel) {
  secretCodeBtn.addEventListener('click', showCodePanel);
  
  // Close button
  closeCodeBtn.addEventListener('click', () => {
    codePanel.classList.add('hidden');
  });
  
  // Click outside to close
  codePanel.addEventListener('click', (e) => {
    if (e.target === codePanel) {
      codePanel.classList.add('hidden');
    }
  });
  
  // Confirm button
  confirmCodeBtn.addEventListener('click', submitCode);
  
  // Enter key to submit
  codeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      submitCode();
    }
  });
  
  // Clear codes button
  clearCodesBtn.addEventListener('click', () => {
    if (confirm('Sei sicuro di voler cancellare tutti i codici attivi?')) {
      clearActiveCodes();
      
      const success = document.getElementById('codeSuccess');
      success.textContent = '✓ Tutti i codici sono stati cancellati';
      success.classList.remove('hidden');
      
      setTimeout(() => {
        codePanel.classList.add('hidden');
      }, 2000);
    }
  });
}

// Favorites heart button toggle
onlyFavsChk.addEventListener("click", () => {
  onlyFavsChk.classList.toggle('active');
  applyFilterAndRender();
});

// Lyrics toggle button
if (lyricsToggleBtn) {
  const lyricsContainer = document.querySelector('.lyrics-nav-container');
  
  // Initialize from localStorage (default to visible)
  const lyricsVisible = localStorage.getItem('lyricsVisible');
  if (lyricsVisible === null) {
    localStorage.setItem('lyricsVisible', 'true');
  }
  if (lyricsVisible === 'false') {
    lyricsContainer.classList.add('hidden');
    lyricsToggleBtn.classList.remove('active');
  } else {
    lyricsToggleBtn.classList.add('active');
  }
  
  // Handle button click
  lyricsToggleBtn.addEventListener('click', () => {
    lyricsContainer.classList.toggle('hidden');
    const isVisible = !lyricsContainer.classList.contains('hidden');
    
    // Update button state
    if (isVisible) {
      lyricsToggleBtn.classList.add('active');
    } else {
      lyricsToggleBtn.classList.remove('active');
    }
    
    localStorage.setItem('lyricsVisible', isVisible);
    
    gtag('event', 'lyrics_toggle', {
      visibility: isVisible ? 'shown' : 'hidden'
    });
  });
}

/* =========================================================
   [13.6] PLAY COUNT TRACKING & STATS
   ========================================================= */
function getTotalPlayCount() {
  const count = localStorage.getItem('totalPlayCount');
  return count ? parseInt(count, 10) : 0;
}

function incrementPlayCount() {
  const current = getTotalPlayCount();
  const newCount = current + 1;
  localStorage.setItem('totalPlayCount', newCount.toString());
  console.log(`Total play count: ${newCount}`);
  return newCount;
}

function updateMedalBadge() {
  const badge = document.getElementById('medalBadge');
  if (badge) {
    badge.textContent = getTotalPlayCount();
  }
}

// Badge levels system
const BADGE_LEVELS = [
  { name: 'LISTENER', icon: '🎵', threshold: 0 },
  { name: 'SUPPORTER', icon: '🌟', threshold: 50 },
  { name: 'CONTRIBUTOR', icon: '💪', threshold: 200 },
  { name: 'AMBASSADOR', icon: '🏆', threshold: 300 }
];

function getCurrentBadge(playCount) {
  // Find the highest badge the user has earned
  for (let i = BADGE_LEVELS.length - 1; i >= 0; i--) {
    if (playCount >= BADGE_LEVELS[i].threshold) {
      return BADGE_LEVELS[i];
    }
  }
  return BADGE_LEVELS[0]; // Default to LISTENER
}

function getNextBadge(playCount) {
  // Find the next badge to unlock
  for (let i = 0; i < BADGE_LEVELS.length; i++) {
    if (playCount < BADGE_LEVELS[i].threshold) {
      return BADGE_LEVELS[i];
    }
  }
  return null; // Max level reached
}

function updateStatsPopup(playCount) {
  const statsCount = document.getElementById('statsCount');
  const badgeIcon = document.getElementById('badgeIcon');
  const badgeName = document.getElementById('badgeName');
  const statsProgress = document.getElementById('statsProgress');
  
  // Update play count
  statsCount.textContent = playCount;
  
  // Update current badge
  const currentBadge = getCurrentBadge(playCount);
  badgeIcon.textContent = currentBadge.icon;
  badgeName.textContent = currentBadge.name;
  
  // Update progress message
  const nextBadge = getNextBadge(playCount);
  if (nextBadge) {
    const songsNeeded = nextBadge.threshold - playCount;
    statsProgress.textContent = `Ti mancano ${songsNeeded} canzoni per diventare ${nextBadge.name}!`;
    statsProgress.style.display = 'block';
  } else {
    // Max level reached
    statsProgress.textContent = 'Hai raggiunto il livello massimo! Sei un vero AMBASSADOR!';
    statsProgress.style.display = 'block';
  }
}

// Initialize medal badge on page load
const medalBtn = document.getElementById('medalBtn');
const statsPopup = document.getElementById('statsPopup');
const closeStatsBtn = document.getElementById('closeStatsBtn');

if (medalBtn && statsPopup) {
  // Update badge on load
  updateMedalBadge();
  
  medalBtn.addEventListener('click', () => {
    const total = getTotalPlayCount();
    updateStatsPopup(total);
    statsPopup.classList.remove('hidden');
    
    gtag('event', 'view_stats', {
      total_plays: total,
      current_badge: getCurrentBadge(total).name
    });
  });
  
  closeStatsBtn.addEventListener('click', () => {
    statsPopup.classList.add('hidden');
  });
  
  // Close on background click
  statsPopup.addEventListener('click', (e) => {
    if (e.target === statsPopup) {
      statsPopup.classList.add('hidden');
    }
  });
}

// Initialize info button
const infoBtn = document.getElementById('infoBtn');
const infoPopup = document.getElementById('infoPopup');
const closeInfoBtn = document.getElementById('closeInfoBtn');
const closeInfoBtnBottom = document.getElementById('closeInfoBtnBottom');

if (infoBtn && infoPopup) {
  infoBtn.addEventListener('click', () => {
    infoPopup.classList.remove('hidden');
    
    gtag('event', 'view_info', {
      section: 'project_info'
    });
  });
  
  closeInfoBtn.addEventListener('click', () => {
    infoPopup.classList.add('hidden');
  });
  
  if (closeInfoBtnBottom) {
    closeInfoBtnBottom.addEventListener('click', () => {
      infoPopup.classList.add('hidden');
    });
  }
  
  // Close on background click
  infoPopup.addEventListener('click', (e) => {
    if (e.target === infoPopup) {
      infoPopup.classList.add('hidden');
    }
  });
}

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

    // Check for updates periodically (reduced frequency)
    setInterval(() => {
      registration.update().catch(() => {});
    }, 60000); // Check every 60 seconds

    // Listen for new service worker
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New service worker available - show banner
          showUpdateBanner();
        }
      });
    });
  }).catch(err => {
    console.warn('Service Worker registration failed:', err);
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
      banner.classList.add('hidden');
      
      // Listen for controllerchange ONLY after user clicks
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      }, { once: true });
      
      // Tell waiting SW to activate
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          // No waiting worker, clear cache and reload
          if ('caches' in window) {
            caches.keys().then(names => {
              names.forEach(name => caches.delete(name));
            }).then(() => {
              window.location.reload(true);
            });
          } else {
            window.location.reload(true);
          }
        }
      });
    };
  }
}

/* =========================================================
   [15] APP WAKE-UP RECOVERY
   ========================================================= */
function checkAndRecoverUI() {
  const container = document.querySelector('.container');
  const trackList = document.getElementById('trackList');
  
  // Check if UI is broken (black screen)
  if (!container || !trackList || trackList.children.length === 0) {
    console.warn('UI broken detected, reloading...');
    window.location.reload();
    return;
  }
  
  // Update Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg) reg.update();
    });
  }
}

// Listen for app coming back from background
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    setTimeout(checkAndRecoverUI, 500); // Small delay to let UI render
  }
});

window.addEventListener('focus', () => {
  setTimeout(checkAndRecoverUI, 500);
});

/* =========================================================
   [16] BLANK PAGE DETECTION AND RECOVERY
   ========================================================= */
window.addEventListener('load', () => {
  // Detect blank page after 5 seconds and force recovery
  setTimeout(() => {
    const container = document.querySelector('.container');
    const trackList = document.getElementById('trackList');
    
    // Check if page is stuck or blank
    if (!container || (!trackList && !document.body.textContent.includes('Caricamento'))) {
      console.warn('Blank page detected, clearing cache and reloading...');
      
      if ('caches' in window) {
        caches.keys().then(names => {
          return Promise.all(names.map(name => caches.delete(name)));
        }).then(() => {
          window.location.reload(true);
        }).catch(() => {
          window.location.reload(true);
        });
      } else {
        window.location.reload(true);
      }
    }
  }, 5000);
});
// Play button overlay handler
const playOverlayBtn = document.getElementById('playOverlayBtn');
if (playOverlayBtn) {
  playOverlayBtn.addEventListener('click', () => {
    audio.play();
    const playOverlay = document.getElementById('playButtonOverlay');
    if (playOverlay) playOverlay.classList.add('hidden');
  });
}


/* =========================================================
   [16] AVVIO
   ========================================================= */
loadLikedSongs();
loadActiveCodes();
loadSecretMode();
loadTracks();




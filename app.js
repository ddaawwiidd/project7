(function () {
  // ===== DOM refs =====
  const cameraView    = document.getElementById('cameraView');
  const mapView       = document.getElementById('mapView');
  const notesView     = document.getElementById('notesView');

  const cameraStream  = document.getElementById('cameraStream');
  const cameraNotesOverlay = document.getElementById('cameraNotesOverlay');

  const notesList     = document.getElementById('notesList');

  const headingLabel  = document.getElementById('headingLabel');
  const gpsLabel      = document.getElementById('gpsLabel');

  const addNoteBtn    = document.getElementById('addNoteBtn');
  const noteModal     = document.getElementById('noteModal');
  const noteTextInput = document.getElementById('noteTextInput');
  const modalLat      = document.getElementById('modalLat');
  const modalLon      = document.getElementById('modalLon');
  const modalHeading  = document.getElementById('modalHeading');
  const cancelNoteBtn = document.getElementById('cancelNoteBtn');
  const saveNoteBtn   = document.getElementById('saveNoteBtn');

  const tabButtons    = document.querySelectorAll('.nav-pill-btn');

  const installBtn    = document.getElementById('installBtn');

  // ===== State =====
  let notes = loadNotes();
  let currentLat  = null;
  let currentLon  = null;
  let currentHeading = null;

  let deferredPrompt = null; // PWA install prompt

  // Shared note state (someone opened via shared link)
  let sharedNote = null;

  // Map state
  let map = null;
  let markersLayer = null;
  let userHasMovedMap = false;

  // Live user marker on map
  let youMarker = null;
  let youHalo = null;

  // Stability map to avoid flicker in overlay
  const visibleStability = new Map(); // Map<noteId, lastQualifiedMs>

  // ===== Shared note bootstrap from URL =====
  (function loadSharedFromHash() {
    const match = window.location.hash.match(/#share=([^&]+)/);
    if (!match || !match[1]) return;

    try {
      const decoded = atob(match[1]);
      const data = JSON.parse(decoded);

      sharedNote = {
        id: 'shared-' + (data.createdAt || Date.now()),
        text: data.text,
        lat: data.lat,
        lon: data.lon,
        heading: data.heading,
        createdAt: data.createdAt || Date.now(),
        _sharedRadius: data.radius || 10,
        _sharedTolerance: data.tolerance || 35
      };
    } catch (err) {
      console.warn('Failed to parse shared note from URL', err);
    }
  })();

  // ===== Init =====
  initCamera();
  initHeading();
  initGPS();
  renderAll();
  initTabs();
  initNoteFlow();
  initInstallPrompt();
  registerServiceWorker();

  // ===== Camera (rear camera feed) =====
  function initCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('Camera API not available');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        cameraStream.srcObject = stream;
      })
      .catch((err) => {
        console.error('Camera access denied or failed:', err);
      });
  }

  // ===== Heading / compass =====
  function initHeading() {
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);

    function handleOrientation(e) {
      let heading = e.alpha;
      if (typeof heading === 'number') {
        currentHeading = Math.round(heading);
        headingLabel.textContent = `Heading: ${currentHeading}°`;

        // re-check overlay visibility based on heading
        renderCameraOverlay();
      }
    }
  }

  // ===== GPS / geolocation =====
  function initGPS() {
    if (!navigator.geolocation) {
      console.warn('Geolocation not supported.');
      return;
    }

    navigator.geolocation.watchPosition(
      (pos) => {
        currentLat = pos.coords.latitude;
        currentLon = pos.coords.longitude;
        gpsLabel.textContent = `GPS: ${currentLat.toFixed(5)}, ${currentLon.toFixed(5)}`;

        // update overlay because position affects which notes qualify
        renderCameraOverlay();

        // If map already exists, keep user marker updated
        if (map) {
          const hereLatLng = [currentLat, currentLon];

          // halo
          if (!youHalo) {
            youHalo = L.circle(hereLatLng, {
              radius: 8, // meters, small visual halo
              color: 'rgba(0,122,255,0.3)',
              fillColor: 'rgba(0,122,255,0.3)',
              fillOpacity: 0.5,
              weight: 2
            }).addTo(map);
          } else {
            youHalo.setLatLng(hereLatLng);
          }

          // solid dot
          if (!youMarker) {
            youMarker = L.circleMarker(hereLatLng, {
              radius: 6,
              color: 'rgba(0,122,255,1)',
              fillColor: 'rgba(0,122,255,1)',
              fillOpacity: 1,
              weight: 2
            }).addTo(map);
          } else {
            youMarker.setLatLng(hereLatLng);
          }

          // if user hasn't moved map manually yet, center on them
          if (!userHasMovedMap) {
            map.setView(hereLatLng, 16);
          }
        }
      },
      (err) => {
        console.warn('GPS error:', err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      }
    );
  }

  // ===== Notes persistence (local only) =====
  function loadNotes() {
    try {
      const raw = localStorage.getItem('project7_notes');
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Failed to load notes', e);
      return [];
    }
  }

  function saveNotes() {
    try {
      localStorage.setItem('project7_notes', JSON.stringify(notes));
    } catch (e) {
      console.warn('Failed to save notes', e);
    }
  }

  // ===== Render all views =====
  function renderAll() {
    renderNotesList();
    renderCameraOverlay();
    renderMapMarkers(); // if map exists
  }

  // ----- Notes list -----
  function renderNotesList() {
    if (!notesList) return;
    notesList.innerHTML = '';

    if (!notes.length) {
      notesList.innerHTML = `<div class="note-card">
        <div>No notes yet.</div>
        <div class="meta">Tap "+ Note here" in Camera.</div>
      </div>`;
      return;
    }

    notes
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .forEach((n) => {
        const card = document.createElement('div');
        card.className = 'note-card';
        const date = new Date(n.createdAt);

        card.innerHTML = `
          <div class="note-main-row">
            <div class="note-text">${escapeHTML(n.text)}</div>
            <div class="note-actions">
              <button class="share-btn" data-id="${n.id}">Share</button>
              <button class="delete-btn" data-id="${n.id}">Delete</button>
            </div>
          </div>
          <div class="meta">
            <span>${date.toLocaleString()}</span>
            <span>📍 ${n.lat.toFixed(5)}, ${n.lon.toFixed(5)}</span>
            <span>↗ ${n.heading ?? '--'}°</span>
          </div>
        `;

        notesList.appendChild(card);
      });

    // hook up delete + share handlers
    notesList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', onDeleteNoteClick);
    });

    notesList.querySelectorAll('.share-btn').forEach(btn => {
      btn.addEventListener('click', onShareNoteClick);
    });
  }

  function onDeleteNoteClick(e) {
    const id = e.currentTarget.getAttribute('data-id');
    if (!id) return;

    notes = notes.filter(n => n.id !== id);
    saveNotes();

    renderNotesList();
    renderCameraOverlay();
    renderMapMarkers();
  }

  function onShareNoteClick(e) {
    const id = e.currentTarget.getAttribute('data-id');
    if (!id) return;

    const n = notes.find(x => x.id === id);
    if (!n) return;

    const payload = {
      text: n.text,
      lat: n.lat,
      lon: n.lon,
      heading: n.heading,
      radius: 10,        // meters needed to unlock
      tolerance: 35,     // heading tolerance
      createdAt: n.createdAt
    };

    const json = JSON.stringify(payload);
    const encoded = btoa(json);

    const url = window.location.origin + window.location.pathname + '#share=' + encoded;

    if (navigator.share) {
      navigator.share({
        title: "I left you a note in the real world",
        text: "Go to this spot and point your phone in the right direction to reveal it.",
        url
      }).catch(() => {
        navigator.clipboard.writeText(url).catch(()=>{});
        alert('Share link copied:\n' + url);
      });
    } else {
      navigator.clipboard.writeText(url).catch(()=>{});
      alert('Share link copied:\n' + url);
    }
  }

  // ===== Utilities: distance + heading match =====
  function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // meters
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  function isHeadingClose(a, b, toleranceDeg) {
    if (a == null || b == null) return false;
    let diff = Math.abs(a - b);
    if (diff > 180) diff = 360 - diff;
    return diff <= toleranceDeg;
  }

  // ===== Camera overlay (spatial gating + flicker smoothing) =====
  function renderCameraOverlay() {
    if (!cameraNotesOverlay) return;
    cameraNotesOverlay.innerHTML = '';

    if (currentLat == null || currentLon == null) {
      return;
    }

    const now = Date.now();

    const DEFAULT_RADIUS_M = 10;
    const DEFAULT_TOLERANCE_DEG = 35;
    const STICKY_MS = 1000;

    function qualifies(note, radius, tolerance) {
      if (note.lat == null || note.lon == null) return false;

      const dist = distanceMeters(currentLat, currentLon, note.lat, note.lon);
      const closeEnough = dist <= radius;

      const lookingSameWay = isHeadingClose(
        currentHeading,
        note.heading,
        tolerance
      );

      return closeEnough && lookingSameWay;
    }

    // Local notes that qualify right now
    const qualifyingLocal = [];
    notes.forEach(n => {
      if (qualifies(n, DEFAULT_RADIUS_M, DEFAULT_TOLERANCE_DEG)) {
        qualifyingLocal.push(n);
        visibleStability.set(n.id, now);
      }
    });

    // Local notes within sticky window
    const stickyLocal = notes.filter(n => {
      const lastOk = visibleStability.get(n.id);
      return lastOk && (now - lastOk <= STICKY_MS);
    });

    // Shared note qualify right now
    const qualifyingShared = [];
    if (sharedNote) {
      const r = sharedNote._sharedRadius || DEFAULT_RADIUS_M;
      const t = sharedNote._sharedTolerance || DEFAULT_TOLERANCE_DEG;
      if (qualifies(sharedNote, r, t)) {
        qualifyingShared.push(sharedNote);
        visibleStability.set(sharedNote.id, now);
      }
    }

    // Shared note sticky
    const stickyShared = [];
    if (sharedNote) {
      const lastOkShared = visibleStability.get(sharedNote.id);
      if (lastOkShared && (now - lastOkShared <= STICKY_MS)) {
        stickyShared.push(sharedNote);
      }
    }

    // Merge and dedupe
    const merged = [];
    const seen = new Set();
    [...qualifyingLocal, ...stickyLocal, ...qualifyingShared, ...stickyShared]
      .sort((a,b)=>b.createdAt - a.createdAt)
      .forEach(n => {
        if (!seen.has(n.id)) {
          seen.add(n.id);
          merged.push(n);
        }
      });

    // Render up to 2 chips
    merged.slice(0,2).forEach(n => {
      const chip = document.createElement('div');
      chip.className = 'note-chip';
      chip.textContent = n.text;
      cameraNotesOverlay.appendChild(chip);
    });
  }

  // ===== Map (Leaflet) =====
  function initMap() {
    if (map) return;

    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    // choose initial view
    let startLat = (currentLat != null) ? currentLat : 41.387; // fallback Barcelona
    let startLon = (currentLon != null) ? currentLon : 2.170;
    let startZoom = (currentLat != null && currentLon != null) ? 16 : 13;

    map = L.map('map', {
      zoomControl: false,
    }).setView([startLat, startLon], startZoom);

    // OSM tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);

    map.on('moveend', () => {
      userHasMovedMap = true;
    });

    renderMapMarkers();

    // If we came from a shared link, auto-zoom to that shared note
    if (sharedNote) {
      map.setView([sharedNote.lat, sharedNote.lon], 18);
    }
  }

  function renderMapMarkers() {
    if (!markersLayer) return;
    markersLayer.clearLayers();

    // 1. Your own saved notes => normal markers
    notes.forEach(n => {
      const date = new Date(n.createdAt).toLocaleString();

      const marker = L.marker([n.lat, n.lon]);
      marker.bindPopup(`
        <div class="popup-note">
          <div class="popup-text">${escapeHTML(n.text)}</div>
          <div class="popup-meta">
            <div>${date}</div>
            <div>↗ ${n.heading ?? '--'}°</div>
            <div>${n.lat.toFixed(5)}, ${n.lon.toFixed(5)}</div>
          </div>
        </div>
      `);
      markersLayer.addLayer(marker);
    });

    // 2. Shared note (if page opened via share link)
    if (sharedNote) {
      const sharedLatLng = [sharedNote.lat, sharedNote.lon];
      const popupDate = new Date(sharedNote.createdAt).toLocaleString();

      const circle = L.circle(sharedLatLng, {
        radius: sharedNote._sharedRadius || 10,
        color: 'rgba(0,122,255,0.8)',
        fillColor: 'rgba(0,122,255,0.2)',
        fillOpacity: 0.4,
        weight: 2
      });

      circle.bindPopup(`
        <div class="popup-note">
          <div class="popup-text">${escapeHTML(sharedNote.text)}</div>
          <div class="popup-meta">
            <div>${popupDate}</div>
            <div>↗ ${sharedNote.heading ?? '--'}°</div>
            <div>${sharedNote.lat.toFixed(5)}, ${sharedNote.lon.toFixed(5)}</div>
            <div>Stand inside the blue circle and face that direction to reveal it in Camera.</div>
          </div>
        </div>
      `);

      markersLayer.addLayer(circle);
    }
  }

  // ===== Nav / view switching =====
  function initTabs() {
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        switchView(targetId);

        // update pill visual
        tabButtons.forEach((b) => b.classList.remove('active-pill'));
        btn.classList.add('active-pill');

        if (targetId === 'mapView') {
          initMap();
          // ensure Leaflet recalculates its layout after being hidden
          setTimeout(() => {
            if (map) {
              map.invalidateSize();
              renderMapMarkers();
            }
          }, 50);
        }
      });
    });
  }

  function switchView(targetId) {
    [cameraView, mapView, notesView].forEach((v) => {
      if (!v) return;
      v.classList.remove('active-view');
      if (v.id === targetId) v.classList.add('active-view');
    });
  }

  // ===== Note creation flow =====
  function initNoteFlow() {
    addNoteBtn.addEventListener('click', openNoteModal);
    cancelNoteBtn.addEventListener('click', closeNoteModal);
    saveNoteBtn.addEventListener('click', saveNoteAndClose);
  }

  function openNoteModal() {
    modalLat.textContent     = currentLat  != null ? currentLat.toFixed(5) : '--';
    modalLon.textContent     = currentLon  != null ? currentLon.toFixed(5) : '--';
    modalHeading.textContent = currentHeading != null ? currentHeading + '°' : '--°';

    noteTextInput.value = '';

    noteModal.classList.remove('hidden');
    noteTextInput.focus();
  }

  function closeNoteModal() {
    noteModal.classList.add('hidden');
  }

  function saveNoteAndClose() {
    const text = noteTextInput.value.trim();
    if (!text) {
      closeNoteModal();
      return;
    }

    const newNote = {
      id: crypto.randomUUID(),
      text,
      lat: currentLat ?? 0,
      lon: currentLon ?? 0,
      heading: currentHeading ?? null,
      createdAt: Date.now(),
    };

    notes.push(newNote);
    saveNotes();

    renderNotesList();
    renderCameraOverlay();
    renderMapMarkers();

    closeNoteModal();
  }

  // ===== PWA install prompt handling =====
  function initInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      installBtn.classList.remove('hidden');
    });

    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt = null;
      installBtn.classList.add('hidden');
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      installBtn.classList.add('hidden');
    });
  }

  // ===== Service worker =====
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('./service-worker.js')
        .catch((err) => console.warn('SW registration failed', err));
    }
  }

  // ===== Escape HTML util =====
  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

})();

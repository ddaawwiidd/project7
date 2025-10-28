(function () {
  // DOM refs
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

  const tabButtons    = document.querySelectorAll('.tab-btn');

  const installBtn    = document.getElementById('installBtn');

  // ===== State =====
  let notes = loadNotes();
  let currentLat  = null;
  let currentLon  = null;
  let currentHeading = null;

  let deferredPrompt = null; // for PWA install prompt

  // Map state
  let map = null;
  let markersLayer = null;
  let userHasMovedMap = false;

  // ===== Init =====
  initCamera();
  initHeading();
  initGPS();
  renderAll();
  initTabs();
  initNoteFlow();
  initInstallPrompt();
  registerServiceWorker();

  // ===== Camera stream =====
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

  // ===== Device heading / compass =====
  function initHeading() {
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);

    function handleOrientation(e) {
      let heading = e.alpha;
      if (typeof heading === 'number') {
        currentHeading = Math.round(heading);
        headingLabel.textContent = `Heading: ${currentHeading}°`;
        // heading change alone doesn't require re-render overlay,
        // overlay is location-based for now, so we skip calling renderCameraOverlay() here
      }
    }
  }

  // ===== GPS =====
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

        // Update overlay based on new position (proximity logic)
        renderCameraOverlay();

        // If map already exists, maybe recenter once until user moves it
        if (map && !userHasMovedMap) {
          map.setView([currentLat, currentLon], 16);
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

  // ===== Notes persistence =====
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

  // ===== Renderers =====
  function renderAll() {
    renderNotesList();
    renderCameraOverlay();
    renderMapMarkers(); // if map already initialized
  }

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

    // newest first
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
            <button class="delete-btn" data-id="${n.id}">Delete</button>
          </div>
          <div class="meta">
            <span>${date.toLocaleString()}</span>
            <span>📍 ${n.lat.toFixed(5)}, ${n.lon.toFixed(5)}</span>
            <span>↗ ${n.heading ?? '--'}°</span>
          </div>
        `;

        notesList.appendChild(card);
      });

    // hook up delete handlers
    notesList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', onDeleteNoteClick);
    });
  }

  function onDeleteNoteClick(e) {
    const id = e.currentTarget.getAttribute('data-id');
    if (!id) return;

    // remove from notes array
    notes = notes.filter(n => n.id !== id);
    saveNotes();

    // re-render everything that depends on notes
    renderNotesList();
    renderCameraOverlay();
    renderMapMarkers();
  }

  // === distance helper (rough haversine in meters)
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

  // ===== Camera overlay (contextual nearby notes only) =====
  function renderCameraOverlay() {
    if (!cameraNotesOverlay) return;
    cameraNotesOverlay.innerHTML = '';

    // if we don't know where we are, don't show stale notes
    if (currentLat == null || currentLon == null) {
      return;
    }

    const NEAR_RADIUS_M = 30; // meters

    const nearbyNotes = notes
      .filter(n => {
        if (n.lat == null || n.lon == null) return false;
        const dist = distanceMeters(currentLat, currentLon, n.lat, n.lon);
        return dist <= NEAR_RADIUS_M;
      })
      .sort((a,b)=>b.createdAt-a.createdAt)
      .slice(0,2);

    nearbyNotes.forEach((n) => {
      const chip = document.createElement('div');
      chip.className = 'note-chip';
      chip.textContent = n.text;
      cameraNotesOverlay.appendChild(chip);
    });
  }

  // ===== Map (Leaflet) =====
  function initMap() {
    if (map) return; // already done

    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    // pick initial view
    let startLat = (currentLat != null) ? currentLat : 41.387; // Barcelona fallback
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

    // track manual movement so we don't keep recentering on user
    map.on('moveend', () => {
      userHasMovedMap = true;
    });

    renderMapMarkers();
  }

  function renderMapMarkers() {
    if (!markersLayer) return;
    markersLayer.clearLayers();

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
  }

  // ===== Tabs =====
  function initTabs() {
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        switchView(targetId);

        tabButtons.forEach((b) => b.classList.remove('active-tab'));
        btn.classList.add('active-tab');

        if (targetId === 'mapView') {
          initMap();
          // fix Leaflet sizing after hidden tab becomes visible
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

    // re-render dependent views
    renderNotesList();
    renderCameraOverlay();
    renderMapMarkers();

    closeNoteModal();
  }

  // ===== PWA Install handling =====
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

  // ===== Utils =====
  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
})();

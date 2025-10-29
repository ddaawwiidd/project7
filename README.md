# 🧠 Project 7 — Memory Layer PWA

**Project 7 (P7)** is an experimental Progressive Web App that turns your camera, compass, and GPS into a **spatial notebook**.  
You can **drop notes in physical space** — bound to a location and direction — and **see them reappear** only when you return to that spot and look the same way.

It’s part AR, part map, part private memory layer — built entirely with web technologies.

---

## 🌍 Live Demo
👉 [https://ddaawwiidd.github.io/Project7](https://ddaawwiidd.github.io/Project7)

*(Runs best on a mobile device with GPS + compass + camera access.)*
1. Open P7 on your phone → Tap “+ Note here” while facing an object.
2. Write something like “Bench with best sunset view.”
3. Walk away and look elsewhere → note disappears.
4. Return to the same spot, point the same way → note reappears ✨.
5. Tap Share → send the link to a friend.
6. Friend opens it → sees the blue circle on the map and must physically go there to unlock your note.
7. 
---

## 🧩 Core Features

### 🗺️ Spatial Notes
- Add a note tied to your **current GPS position** and **facing direction**.  
- Notes only appear in camera view when you’re within **≈10 meters** and facing **the same heading**.

### 📷 Camera View (Reality Layer)
- Live rear camera feed.  
- Notes appear as floating “chips” when you look toward where you left them.  
- Smooth fade-in/out (no flicker thanks to directional hysteresis).

### 🧭 Map View
- See all your saved notes as standard map pins.  
- See your **live position** (blue dot + halo).  
- If opened from a shared link, a **blue 10 m circle** shows where to stand to reveal the shared note.

### 📝 Notes Tab
- Manage your saved notes.
- **Share** or **Delete** each note.
- Share generates a **magic link** (no backend required).

### 🔗 Shareable Notes (Viral Mechanic)
- Each note can be shared as a self-contained link:

- When someone opens that link:
- They see a blue circle on the map.
- They must physically go to that spot and face the same direction to reveal the note in camera view.  
- No login. No server. Pure Web API magic.

### ⚙️ Offline-Ready PWA
- Works offline after first load.
- Installable (“Add to Home Screen”) for standalone mode.

---
## 🧠 Concept

> “What if memory wasn’t in your phone, but *in the world*?”

P7 explores a minimal approach to **spatial computing** without ARKit or WebXR.  
It uses simple signals — **GPS + compass heading** — to simulate *anchored memories* in physical space.

## ⚙️ Tech Stack

| Layer | Technology |
|-------|-------------|
| Frontend | Vanilla HTML, CSS, JS |
| Mapping | [Leaflet.js](https://leafletjs.com/) + OpenStreetMap tiles |
| Sensors | Web Geolocation API + DeviceOrientation API |
| Camera | `getUserMedia()` (rear camera feed) |
| Storage | LocalStorage |
| PWA | Service Worker + Web Manifest |

No frameworks, no backend, no dependencies beyond Leaflet.


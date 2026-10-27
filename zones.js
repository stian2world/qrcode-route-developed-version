// Zones, landmarks, Google Maps import and "my activity".
//
// - Landmarks (landmarks.js + anything imported from Google Maps) become
//   ordinary places: they get a QR code `lm-<id>` and a preset trip from
//   home, so the 🧭 transport code works with them like with SVA.
// - Zones are rings of travel time from home, recomputed live.
// - Imported places and activity (reviews, check-ins) are stored only in
//   this browser (localStorage), never in the repo.

const IMPORT_KEY = 'qrImportedPlaces';
const ACTIVITY_KEY = 'qrActivities';
const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]));

// Rough box around North NJ + NYC; imported places outside it are skipped.
const REGION = { minLat: 40.45, maxLat: 41.0, minLng: -74.35, maxLng: -73.65 };

let importedPlaces = loadJson(IMPORT_KEY, []);
let activities = loadJson(ACTIVITY_KEY, []);

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    showToast('Couldn’t save in this browser (private mode?)');
  }
}

// ---------------------------------------------------------------------------
// Registering landmarks as places

function registerLandmark(lm) {
  PLACES[lm.id] = {
    label: lm.label,
    spoken: lm.spoken,
    sub: lm.kind || lm.list || '',
    icon: lm.icon || '📍',
    color: lm.color || '#ffe08a',
    address: lm.address || lm.label,
    lat: lm.lat,
    lng: lm.lng,
    state: lm.state || guessState(lm.lat, lm.lng),
    parking: 0,
    landmark: true,
    imported: Boolean(lm.imported),
    list: lm.list || '',
  };
  QR_ROLES[`lm-${lm.id}`] = lm.id;
  PRESET_ROUTES[`home->${lm.id}`] = presetFromTrip(lm.trip || estimateTrip(lm), PLACES[lm.id]);
}

function presetFromTrip(trip, place) {
  const preset = {};
  if (trip.walk !== undefined) {
    preset.WALK = { minutes: trip.walk, miles: trip.miles ?? 1, detail: trip.note || '' };
  }
  if (trip.path) {
    const st = PATH_STATIONS[trip.path];
    const minutes = HOME_TO_GROVE_MIN + st.ride + trip.after + (st.timetable ? 0 : AVG_PATH_WAIT_MIN);
    preset.TRANSIT = {
      minutes,
      miles: trip.miles ?? 5,
      fare: 3.0,
      detail: trip.detail || `PATH to ${st.name}`,
      say: trip.say || `Take the PATH from Grove Street to ${st.name}.`,
      schedule: st.timetable, // next train from now; otherwise average wait (est.)
    };
  }
  if (!preset.WALK && !preset.TRANSIT) {
    preset.DRIVE = 'estimate';
  }
  return preset;
}

function guessState(lat, lng) {
  // The Hudson runs at about -74.02 next to Jersey City / Hoboken.
  return lng > -74.022 ? 'NY' : 'NJ';
}

// For imported places: walk if it's close, otherwise PATH to the best
// station and walk or take the subway from there. All estimates.
function estimateTrip(p) {
  const home = PLACES.home;
  const walkMin = (haversineMiles(home, p) * 1.25 / 3) * 60;
  const trip = {};
  if (walkMin <= MAX_MINUTES.WALK) {
    trip.walk = Math.round(walkMin);
    trip.miles = +(haversineMiles(home, p) * 1.25).toFixed(1);
    trip.note = 'est.';
  }
  if (walkMin > 12) {
    let best = null;
    for (const [key, st] of Object.entries(PATH_STATIONS)) {
      const exitWalk = (haversineMiles(st, p) * 1.25 / 3) * 60;
      let after;
      let detail;
      if (exitWalk <= 12) {
        after = exitWalk;
        detail = `PATH to ${st.name}, walk ${Math.round(exitWalk)} min (est.)`;
      } else {
        after = 7 + (haversineMiles(st, p) * 1.3 / 15) * 60 + 5; // transfer + subway + walk
        detail = `PATH to ${st.name} + subway (est.)`;
      }
      const total = st.ride + after;
      if (!best || total < best.total) {
        best = { total, key, after, detail, st };
      }
    }
    trip.path = best.key;
    trip.after = Math.round(best.after);
    trip.detail = best.detail;
    trip.say = `Take the PATH from Grove Street to ${best.st.name}.`;
    trip.miles = +(haversineMiles(home, p) * 1.3).toFixed(1);
  }
  return trip;
}

function allLandmarks() {
  return [...LANDMARKS, ...importedPlaces];
}

LANDMARKS.forEach(registerLandmark);
importedPlaces.forEach(registerLandmark);

// ---------------------------------------------------------------------------
// Live trip time from home → which zone

function tripFromHome(placeId) {
  const preset = PRESET_ROUTES[`home->${placeId}`];
  if (!preset || !PLACES[placeId]) {
    return null;
  }
  const results = presetRoutes(preset, PLACES.home, PLACES[placeId]);
  const best = recommend(results);
  return best ? { best, results } : null;
}

function zoneFor(minutes) {
  return ZONES.find((z) => minutes <= z.max) || ZONES[ZONES.length - 1];
}

// Places shown in zones: every place except home.
function zonePlaces() {
  const list = [];
  for (const [id, place] of Object.entries(PLACES)) {
    if (id === 'home') {
      continue;
    }
    const trip = tripFromHome(id);
    if (!trip) {
      continue;
    }
    list.push({ id, place, trip, zone: zoneFor(trip.best.minutes) });
  }
  return list.sort((a, b) => a.trip.best.minutes - b.trip.best.minutes);
}

// ---------------------------------------------------------------------------
// Activity: reviews from the Google export + "I went here" check-ins

function placeActivities(placeId) {
  return activities
    .filter((a) => a.placeId === placeId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function activityText(a) {
  const when = a.date ? new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  if (a.type === 'review') {
    const stars = a.rating ? '★'.repeat(a.rating) + '☆'.repeat(5 - a.rating) : '';
    return `📝 You reviewed ${stars} ${when}${a.text ? ` — “${a.text}”` : ''}`;
  }
  return `✓ You went here ${when}`;
}

function latestActivityText(placeId) {
  const latest = placeActivities(placeId)[0];
  return latest ? activityText(latest) : '';
}

function checkIn(placeId) {
  activities.push({ placeId, type: 'checkin', date: new Date().toISOString() });
  saveJson(ACTIVITY_KEY, activities);
  showToast(`✓ Saved: you went to ${PLACES[placeId].label}`);
  renderMap();
}

// ---------------------------------------------------------------------------
// Tapping a place (no QR codes needed): show the route from home.

let manualRoute = null; // { to }

function openRoute(placeId) {
  manualRoute = { to: placeId };
  spokenKey = null; // read it out
  popupKey = null;
}

function closeRoute() {
  manualRoute = null;
}

function manualConnection() {
  if (!manualRoute || !PLACES[manualRoute.to]) {
    return null;
  }
  return { from: { role: 'home' }, to: { role: manualRoute.to }, manual: true };
}

// ---------------------------------------------------------------------------
// Google Maps import (Google Takeout: "Maps (your places)" and "Saved")

const importInput = document.getElementById('import-input');
document.getElementById('import-button').addEventListener('click', () => importInput.click());
document.getElementById('clear-import-button').addEventListener('click', () => {
  if (importedPlaces.length === 0) {
    showToast('Nothing imported yet');
    return;
  }
  for (const p of importedPlaces) {
    delete PLACES[p.id];
    delete QR_ROLES[`lm-${p.id}`];
    delete PRESET_ROUTES[`home->${p.id}`];
  }
  const ids = new Set(importedPlaces.map((p) => p.id));
  activities = activities.filter((a) => !ids.has(a.placeId) || a.type === 'checkin');
  importedPlaces = [];
  saveJson(IMPORT_KEY, importedPlaces);
  saveJson(ACTIVITY_KEY, activities);
  showToast('Removed imported places');
  renderMap();
});

importInput.addEventListener('change', async () => {
  const files = [...importInput.files];
  importInput.value = '';
  if (files.length === 0) {
    return;
  }
  try {
    await importFiles(files);
  } catch (error) {
    console.error(error);
    showToast('Couldn’t read that file — is it a Google Takeout export?');
  }
});

async function importFiles(files) {
  showToast('Reading your Google Maps export…', 0);
  const docs = []; // { name, text }
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const JSZip = await loadJSZip();
      const zip = await JSZip.loadAsync(file);
      for (const entry of Object.values(zip.files)) {
        if (!entry.dir && /\.(json|geojson|csv)$/i.test(entry.name)) {
          docs.push({ name: entry.name, text: await entry.async('string') });
        }
      }
    } else {
      docs.push({ name: file.name, text: await file.text() });
    }
  }

  const found = [];
  for (const doc of docs) {
    found.push(...(/\.csv$/i.test(doc.name) ? parseCsvPlaces(doc) : parseJsonPlaces(doc)));
  }

  const stats = { added: 0, merged: 0, outside: 0, notFound: 0, reviews: 0 };
  // Places whose Google link puts them far outside NJ/NY: skip, don't look up.
  for (const p of found) {
    if (p.hint?.far) p.hint = null, p.far = true;
  }
  const needsLocation = found.filter((p) => p.lat === undefined && !p.far);
  for (let i = 0; i < needsLocation.length; i++) {
    showToast(`Finding locations… ${i + 1}/${needsLocation.length}`, 0);
    const hit = await geocode(needsLocation[i]);
    if (hit) {
      Object.assign(needsLocation[i], hit);
    }
  }

  for (const p of found) {
    if (p.far) {
      stats.outside++;
      continue;
    }
    if (p.lat === undefined) {
      stats.notFound++;
      continue;
    }
    if (!inRegion(p)) {
      stats.outside++;
      continue;
    }
    const placeId = addOrMerge(p, stats);
    if (p.review) {
      const exists = activities.some((a) => a.placeId === placeId && a.type === 'review' && a.date === p.review.date);
      if (!exists) {
        activities.push({ placeId, type: 'review', ...p.review });
        stats.reviews++;
      }
    }
  }
  saveJson(IMPORT_KEY, importedPlaces);
  saveJson(ACTIVITY_KEY, activities);

  const parts = [`Imported ${stats.added} new place${stats.added === 1 ? '' : 's'}`];
  if (stats.merged) parts.push(`${stats.merged} already saved`);
  if (stats.reviews) parts.push(`${stats.reviews} review${stats.reviews === 1 ? '' : 's'}`);
  if (stats.outside) parts.push(`${stats.outside} outside NJ/NY skipped`);
  if (stats.notFound) parts.push(`${stats.notFound} couldn’t be located`);
  if (found.length === 0) {
    parts.splice(0, parts.length, 'No saved places in this export — in Google Takeout also tick “Saved”');
  }
  showToast(parts.join(' · '), 8000);
  renderMap();
}

function loadJSZip() {
  if (window.JSZip) {
    return Promise.resolve(window.JSZip);
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload = () => resolve(window.JSZip);
    s.onerror = reject;
    document.head.append(s);
  });
}

function listNameFrom(fileName) {
  const base = fileName.split('/').pop().replace(/\.(json|geojson|csv)$/i, '');
  if (/^saved places$/i.test(base)) return 'Starred';
  if (/^reviews$/i.test(base)) return 'Reviewed';
  if (/labeled places/i.test(base)) return 'Labeled';
  // Takeout writes non-English list names as #Uxxxx (e.g. 美食地图).
  return base.replace(/#U([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

function iconForList(list) {
  if (/want to go/i.test(list)) return '🚩';
  if (/favou?rite/i.test(list)) return '❤️';
  if (/starred/i.test(list)) return '⭐';
  if (/review/i.test(list)) return '📝';
  if (/labeled/i.test(list)) return '🏷️';
  return '📍';
}

// GeoJSON from Takeout: "Saved Places.json", "Reviews.json",
// "Labeled places.json" — all slightly different shapes.
function parseJsonPlaces(doc) {
  let data;
  try {
    data = JSON.parse(doc.text);
  } catch (error) {
    return [];
  }
  if (!data || !Array.isArray(data.features)) {
    return [];
  }
  const list = listNameFrom(doc.name);
  const out = [];
  for (const f of data.features) {
    const p = f.properties || {};
    const loc = p.location || p.Location || {};
    const name = p.name || p.Title || loc.name || loc['Business Name'];
    if (!name) {
      continue;
    }
    // Home / Work labels describe you, not a place to visit.
    if (list === 'Labeled' && /^(home|work)$/i.test(name)) {
      continue;
    }
    const place = {
      name,
      address: p.address || loc.address || loc.Address || '',
      url: p.google_maps_url || p['Google Maps URL'] || '',
      list,
    };
    const [lng, lat] = f.geometry?.coordinates || [];
    if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
      place.lat = lat;
      place.lng = lng;
    } else {
      Object.assign(place, coordsFromUrl(place.url));
    }
    // Your review's "Price per person" answer, e.g. "$20–30".
    const price = (p.questions || []).find((q) => /price per person/i.test(q.question || ''))?.selected_option;
    if (price) place.price = price;
    if (p.five_star_rating_published || p.review_text_published) {
      place.review = {
        date: p.date || '',
        rating: p.five_star_rating_published || 0,
        text: p.review_text_published || '',
      };
    }
    out.push(place);
  }
  return out;
}

// CSV lists from Takeout "Saved" (Title, Note, URL, …) and
// "Your local followed places" (Place, Address, URL).
function parseCsvPlaces(doc) {
  const rows = parseCsv(doc.text);
  if (rows.length < 2) {
    return [];
  }
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const iName = col('title', 'place', 'name');
  const iAddr = col('address');
  const iUrl = col('url');
  const iNote = col('note', 'comment');
  if (iName < 0) {
    return [];
  }
  const list = listNameFrom(doc.name);
  return rows.slice(1)
    .filter((r) => r[iName] && r[iName].trim())
    // Saved images / web pages aren't places.
    .filter((r) => iUrl < 0 || !r[iUrl] || /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(r[iUrl]))
    .map((r) => {
      const place = {
        name: r[iName].trim(),
        address: iAddr >= 0 ? r[iAddr] : '',
        url: iUrl >= 0 ? r[iUrl] : '',
        note: iNote >= 0 ? r[iNote] : '',
        list,
      };
      return { ...place, hint: hintFromUrl(place.url), ...coordsFromUrl(place.url) };
    });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// Google Maps links sometimes carry coordinates (…@40.7,-74.0… or
// …!3d40.7!4d-74.0…).
function coordsFromUrl(url) {
  if (!url) return {};
  let m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
    || url.match(/[?&](?:q|ll|query)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : {};
}

// Google Maps place links carry a feature id like 0x89c259a8e486e29b:0x…;
// the first number is an S2 cell id near the place. Decoding it gives a
// rough location (sometimes a few miles off) — used only as a hint for
// picking the right branch when looking a place up by name.
const S2_LOOKUP_IJ = (() => {
  const table = new Array(1024);
  const posToIJ = [[0, 1, 3, 2], [0, 2, 3, 1], [3, 2, 0, 1], [3, 1, 0, 2]];
  const posToOrientation = [1, 0, 0, 3];
  const init = (level, i, j, orig, pos, orientation) => {
    if (level === 4) {
      table[(pos << 2) + orig] = (((i << 4) + j) << 2) + orientation;
      return;
    }
    const r = posToIJ[orientation];
    for (let k = 0; k < 4; k++) {
      init(level + 1, (i << 1) + (r[k] >> 1), (j << 1) + (r[k] & 1), orig, (pos << 2) + k, orientation ^ posToOrientation[k]);
    }
  };
  for (let o = 0; o < 4; o++) init(0, 0, 0, o, 0, o);
  return table;
})();

function s2CellToLatLng(hex) {
  const id = BigInt(hex);
  const face = Number(id >> 61n);
  let bits = face & 1;
  let i = 0;
  let j = 0;
  for (let k = 7; k >= 0; k--) {
    const n = k === 7 ? 2 : 4;
    bits += Number((id >> BigInt(k * 8 + 1)) & BigInt((1 << (2 * n)) - 1)) << 2;
    bits = S2_LOOKUP_IJ[bits];
    i += (bits >> 6) << (k * 4);
    j += ((bits >> 2) & 15) << (k * 4);
    bits &= 3;
  }
  const st = (x) => (2 * x + 1) / 2 ** 31;
  const uv = (s) => (s >= 0.5 ? (4 * s * s - 1) / 3 : (1 - 4 * (1 - s) * (1 - s)) / 3);
  const u = uv(st(i));
  const v = uv(st(j));
  const [x, y, z] = [[1, u, v], [-u, 1, v], [-u, -v, 1], [-1, -v, -u], [v, -1, -u], [v, u, -1]][face];
  return { lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, lng: (Math.atan2(y, x) * 180) / Math.PI };
}

function hintFromUrl(url) {
  const m = url && url.match(/!1s(0x[0-9a-f]{16}):0x[0-9a-f]+/i);
  if (!m) return null;
  try {
    const h = s2CellToLatLng(m[1]);
    return inRegion(h) ? h : { far: true }; // e.g. a place saved in China
  } catch (error) {
    return null;
  }
}

// Finds coordinates for a name/address: Mapbox if a token is set in
// config.js, otherwise OpenStreetMap (free, ~1 request per second).
async function geocode(p) {
  const query = p.address ? `${p.name}, ${p.address}` : `${p.name}, New York`;
  try {
    if (typeof MAPBOX_TOKEN === 'string' && MAPBOX_TOKEN) {
      const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}`
        + `&bbox=${REGION.minLng},${REGION.minLat},${REGION.maxLng},${REGION.maxLat}&limit=1&access_token=${MAPBOX_TOKEN}`
        + (p.hint ? `&proximity=${p.hint.lng},${p.hint.lat}` : '');
      const data = await (await fetch(url)).json();
      const c = data.features?.[0]?.geometry?.coordinates;
      if (c) return { lng: c[0], lat: c[1] };
      return p.hint ? { lat: p.hint.lat, lng: p.hint.lng, approx: true } : null;
    }
    await new Promise((r) => setTimeout(r, 1100)); // be polite to OSM
    // Chains (H Mart, Ten Ichi Mart…) have several branches: ask for a few
    // and keep the one nearest the hint from the Google link.
    const q = p.address ? query : p.name;
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=${p.hint ? 10 : 1}&bounded=1`
      + `&viewbox=${REGION.minLng},${REGION.maxLat},${REGION.maxLng},${REGION.minLat}&q=${encodeURIComponent(q)}`;
    const data = await (await fetch(url, { headers: { Accept: 'application/json' } })).json();
    const hits = data.map((d) => ({ lat: Number(d.lat), lng: Number(d.lon) }));
    if (!p.hint) return hits[0] || null;
    // The hint is usually right on, but now and then a few miles off.
    // One match for a unique name → trust it. Several (a chain) → the
    // branch next to the hint. Otherwise fall back to the hint itself.
    if (hits.length === 1 && haversineMiles(hits[0], p.hint) < 7) return hits[0];
    hits.sort((a, b) => haversineMiles(a, p.hint) - haversineMiles(b, p.hint));
    if (hits[0] && haversineMiles(hits[0], p.hint) < 1) return hits[0];
    return { lat: p.hint.lat, lng: p.hint.lng, approx: true };
  } catch (error) {
    return p.hint ? { lat: p.hint.lat, lng: p.hint.lng, approx: true } : null;
  }
}

function inRegion(p) {
  return p.lat >= REGION.minLat && p.lat <= REGION.maxLat && p.lng >= REGION.minLng && p.lng <= REGION.maxLng;
}

// Adds a new imported place, or returns the id of an existing landmark /
// place within ~150 m with the same idea (so reviews attach to it).
function addOrMerge(p, stats) {
  // Same name already imported: keep the exact location over a rough one.
  const twin = importedPlaces.find((q) => q.label.toLowerCase() === p.name.toLowerCase()
    && !!q.approx !== !!p.approx && haversineMiles(q, p) < 2); // not other branches of a chain
  if (twin) {
    if (twin.approx && !p.approx) Object.assign(twin, { lat: p.lat, lng: p.lng, approx: false });
    if (p.price && !twin.price) twin.price = p.price;
    if (p.list && !(twin.lists || [twin.list]).includes(p.list)) twin.lists = [...(twin.lists || [twin.list]), p.list];
    stats.merged++;
    return twin.id;
  }
  const near = Object.entries(PLACES).find(([id, q]) => id !== 'home'
    && haversineMiles(q, p) < 0.1
    && (q.label.toLowerCase() === p.name.toLowerCase() || (!q.imported && haversineMiles(q, p) < 0.03)));
  if (near) {
    stats.merged++;
    return near[0];
  }
  const id = `g${hashString(`${p.name}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`)}`;
  const again = importedPlaces.find((q) => q.id === id);
  if (again) { // same place in another list
    if (p.list && !(again.lists || [again.list]).includes(p.list)) again.lists = [...(again.lists || [again.list]), p.list];
    stats.merged++;
    return id;
  }
  const lm = {
    id,
    label: p.name,
    icon: iconForList(p.list),
    list: p.list,
    address: p.address || p.name,
    lat: p.lat,
    lng: p.lng,
    approx: !!p.approx,
    price: p.price || '',
    imported: true,
  };
  lm.trip = estimateTrip(lm);
  importedPlaces.push(lm);
  registerLandmark(lm);
  stats.added++;
  return id;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
}

// ---------------------------------------------------------------------------
// Toast

const toast = document.getElementById('toast');
let toastTimer = null;

function showToast(text, ms = 4000) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  if (ms > 0) {
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, ms);
  }
}

// Trip planner on nested zone frames.
//
// Five printed cards: 🏠 home + four places you often go (Times Square,
// 23rd St, MoMA, The Met). Hold up a place:
//   1. it shows how to get there leaving now — walk, the PATH train and the
//      subway train you'll catch, and when you arrive;
//   2. from the time you'd be done there it asks about breakfast / lunch /
//      dinner;
//   3. No (or the 🏠 card) → straight home. Yes → restaurants nearby (your
//      Google Maps saved places first). Tap one for booking info, how long a
//      meal takes and what it's known for, then "Eat here";
//   4. the trip home: walk, subway and PATH times you'll catch.

const FUNCTION_INFO = { home: { icon: '🏠', label: 'Home', color: '#ffffff', tone: 660 } };
for (const d of DESTINATIONS) {
  FUNCTION_INFO[`dest:${d.id}`] = { icon: d.icon, label: d.label, color: '#ffffff', tone: 880 };
}

const board = document.getElementById('board');
const planPanel = document.getElementById('plan');
const SVG = 'http://www.w3.org/2000/svg';
const OSM_CACHE_KEY = 'qrOsmFood:v1:';

const state = {
  dest: null, // destination id
  step: 'idle', // idle → arrive → food → (restaurant picked) → done
  eat: null, // true / false once answered
  restaurants: null, // list for the current destination
  openRestaurant: null, // index shown in detail
  restaurant: null, // chosen restaurant
  startedAt: null, // Date the plan is computed from
  spreadAt: 0, // when the restaurants last spread out (for the animation)
};
const fnWasVisible = new Set();
let geometry = null;

// ---------------------------------------------------------------------------
// Timetables

function serviceDay(date) {
  const day = date.getDay();
  return day === 0 ? 'Sunday' : day === 6 ? 'Saturday' : 'Weekday';
}

function minuteOfDay(date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function atMinute(base, minute) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + minute * 60000);
}

function pathDepartures(name) {
  const t = TIMETABLES[name];
  if (!t) return { list: [], estimated: true };
  const rows = Array.isArray(t) ? t : t.rows;
  const list = [];
  for (const [first, last, every] of rows) {
    for (let m = toMinutes(first); m <= toMinutes(last); m += every) list.push(m);
  }
  return { list: list.sort((a, b) => a - b), estimated: !Array.isArray(t) && Boolean(t.estimated) };
}

// Walks through the legs from `start`, catching the next train at each
// station. Returns the legs with times, and the arrival time.
function simulate(legs, start) {
  let t = new Date(start);
  const out = [];
  for (const leg of legs) {
    if (leg.type === 'walk') {
      const end = new Date(t.getTime() + leg.minutes * 60000);
      out.push({ ...leg, depart: t, arrive: end });
      t = end;
    } else if (leg.type === 'path') {
      const { list, estimated } = pathDepartures(leg.timetable);
      const now = minuteOfDay(t);
      let dep = list.find((m) => m >= now - 0.01);
      let est = estimated;
      if (dep === undefined) { // past the last train: assume early next morning
        dep = (list[0] ?? now) + 1440;
        est = true;
      }
      const depart = atMinute(t, dep);
      const arrive = new Date(depart.getTime() + leg.ride * 60000);
      out.push({ ...leg, depart, arrive, wait: (depart - t) / 60000, estimated: est });
      t = arrive;
    } else if (leg.type === 'subway') {
      const trips = SUBWAY_LEGS[leg.leg]?.[serviceDay(t)] || [];
      const now = minuteOfDay(t);
      const hit = trips.find(([m]) => m >= now - 0.01);
      let depart;
      let ride = leg.ride;
      let route = leg.lines;
      let est = false;
      if (hit) {
        depart = atMinute(t, hit[0]);
        ride = hit[1];
        route = hit[2].endsWith('X') ? `${hit[2].slice(0, -1)} express` : hit[2];
      } else {
        depart = new Date(t.getTime() + (leg.every / 2) * 60000);
        est = true;
      }
      const arrive = new Date(depart.getTime() + ride * 60000);
      out.push({ ...leg, route, depart, arrive, wait: (depart - t) / 60000, estimated: est });
      t = arrive;
    }
  }
  return { legs: out, arrive: t };
}

// Latest time to leave home and still catch the same first train.
function leaveBy(trip) {
  let walk = 0;
  for (const l of trip.legs) {
    if (l.type === 'walk') walk += l.minutes;
    else return new Date(Math.max(Date.now(), l.depart.getTime() - walk * 60000));
  }
  return new Date();
}

function walkMin(a, b) {
  return Math.max(1, Math.round((haversineMiles(a, b) * 1.25 / 3) * 60));
}

function destById(id) {
  return DESTINATIONS.find((d) => d.id === id);
}

// Trip home from a point near a destination.
function backLegs(dest, from) {
  return [
    { type: 'walk', minutes: walkMin(from, dest.backStation), text: `Walk to ${dest.backStation.name}` },
    ...dest.back,
    ...(dest.home || BACK_TO_HOME),
  ];
}

// The whole plan from `start`.
function buildPlan(start = new Date()) {
  const dest = destById(state.dest);
  // Leave just in time for the first train instead of waiting at the station.
  const going = simulate(dest.go, leaveBy(simulate(dest.go, start)));
  const visitEnd = new Date(going.arrive.getTime() + dest.visit * 60000);
  const plan = { dest, going, visitStart: going.arrive, visitEnd };
  let here = dest;
  let t = visitEnd;
  if (state.restaurant) {
    const r = state.restaurant;
    const walk = walkMin(dest, r);
    plan.toFood = { minutes: walk, depart: t, arrive: new Date(t.getTime() + walk * 60000) };
    plan.mealStart = plan.toFood.arrive;
    plan.mealEnd = new Date(plan.mealStart.getTime() + r.minutes * 60000);
    here = r;
    t = plan.mealEnd;
  }
  plan.home = simulate(backLegs(dest, here), t);
  return plan;
}

function mealAt(date) {
  const m = date.getHours() * 60 + date.getMinutes();
  if (m >= 7 * 60 && m < 11 * 60) return 'breakfast';
  if (m >= 11 * 60 && m < 16 * 60) return 'lunch';
  if (m >= 17 * 60 && m < 22 * 60) return 'dinner';
  return 'a bite';
}

// ---------------------------------------------------------------------------
// Restaurants: your Google saved places + checked notes + OpenStreetMap

// Your Google Maps saved places count as "places to eat" when they're
// near the place and look like food: on a food list (e.g. 美食地图), or
// named like a restaurant / market / bakery. Shops, spas, banks, parks…
// are left out.
const SAVED_FOOD_RADIUS_MI = 0.8; // about a 15–20 min walk
const FOOD_WORDS = /mart\b|market|grocer|food|deli\b|delicatessen|bakery|bakerie|baguette|cake|tart|caf[eé]|coffee|\btea\b|matcha|ramen|noodle|sushi|omakase|izakaya|pizza|burger|bbq|barbecue|chicken|kitchen|restaurant|bistro|grill|dumpling|hot ?pot|yogurt|ice cream|dessert|m[aá]l[aà]|eataly|ichiran|糖水|火锅|锅|餐|面|饭|食|烧|酒楼|超市|甜品|小吃/i;
const NOT_FOOD = /\b(spa|body ?work|library|bank|apothecary|jo malone|le labo|fueguia|nordstrom|micro center)\b|按摩/i;
const NOT_FOOD_PLACE = /\b(park|hall|yards|pointe|avenue|ave|street|st|design|room)\b/i;

function isFoodPlace(p) {
  const name = p.label || p.name || '';
  if (NOT_FOOD.test(name)) return false;
  if (FOOD_WORDS.test(name)) return true;
  const lists = [p.list, ...(p.lists || [])].join(' ');
  return /美食|吃|food|eat|restaurant/i.test(lists) && !NOT_FOOD_PLACE.test(name);
}

async function loadRestaurants(dest) {
  const meal = mealAt(buildPlan().visitEnd);
  const notes = (RESTAURANT_NOTES[dest.id] || [])
    .filter((r) => meal === 'a bite' || r.meals.includes(meal))
    .map((r) => ({ ...r, source: 'notes' }));
  // Your saved places come first (nearest first), marked ⭐.
  const saved = importedPlaces
    .filter((p) => isFoodPlace(p) && haversineMiles(p, dest) < SAVED_FOOD_RADIUS_MI)
    .sort((a, b) => haversineMiles(a, dest) - haversineMiles(b, dest))
    .slice(0, 8)
    .map((p) => {
      const note = RESTAURANT_NOTES[dest.id]?.find((r) => r.name.toLowerCase() === p.label.toLowerCase());
      const lists = [...new Set([p.list, ...(p.lists || [])].filter(Boolean))].join(', ');
      return {
        price: '', minutes: 45, booking: '', dishes: [], meals: ['breakfast', 'lunch', 'dinner'],
        ...(note || {}),
        name: p.label, lat: p.lat, lng: p.lng, approx: p.approx,
        ...(p.price && !note?.price ? { price: p.price } : {}),
        cuisine: note?.cuisine || `Saved in your Google Maps${lists ? ` · ${lists}` : ''}`,
        source: 'saved',
      };
    });
  const osm = await fetchOsmFood(dest);
  const seen = new Set();
  const all = [...saved, ...notes, ...osm].filter((r) => {
    const k = r.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return all.slice(0, 8);
}

async function fetchOsmFood(dest) {
  try {
    const hit = JSON.parse(localStorage.getItem(OSM_CACHE_KEY + dest.id));
    if (hit && Date.now() - hit.t < 7 * 864e5) return hit.list;
  } catch (error) { /* no cache */ }
  const q = `[out:json][timeout:15];nwr(around:550,${dest.lat},${dest.lng})["amenity"~"^(restaurant|cafe|fast_food)$"]["name"];out center tags 120;`;
  for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(host, { method: 'POST', body: `data=${encodeURIComponent(q)}`, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      const list = data.elements
        .map((e) => {
          const t = e.tags || {};
          const booking = { yes: 'Takes reservations', recommended: 'Reservations recommended', required: 'Reservations required', no: 'No reservations' }[t.reservation] || '';
          const fast = t.amenity === 'fast_food';
          return {
            name: t.name,
            lat: e.lat ?? e.center?.lat,
            lng: e.lon ?? e.center?.lon,
            cuisine: (t.cuisine || t.amenity).replace(/_/g, ' ').replace(/;/g, ', '),
            booking,
            price: '',
            minutes: fast ? 20 : t.amenity === 'cafe' ? 30 : 60,
            dishes: [],
            source: 'osm',
            notable: (t.wikidata ? 2 : 0) + (t.website ? 1 : 0),
          };
        })
        .filter((r) => r.name && Number.isFinite(r.lat))
        .sort((a, b) => haversineMiles(a, dest) - a.notable * 0.1 - (haversineMiles(b, dest) - b.notable * 0.1))
        .slice(0, 6);
      localStorage.setItem(OSM_CACHE_KEY + dest.id, JSON.stringify({ t: Date.now(), list }));
      return list;
    } catch (error) { /* next server */ }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Flow

async function chooseDestination(id) {
  const dest = destById(id);
  Object.assign(state, { dest: id, step: 'arrive', eat: null, restaurants: null, openRestaurant: null, restaurant: null });
  render();
  const plan = buildPlan();
  const trains = plan.going.legs.filter((l) => l.type !== 'walk')
    .map((l) => `${l.type === 'path' ? 'the PATH' : `the ${spokenLine(l.route)}`} at ${formatClock(l.depart)}`).join(', then ');
  speak(`${spokenName(dest)}. Leave by ${formatClock(leaveBy(plan.going))} and take ${trains}. You'll be there at ${formatClock(plan.visitStart)}. `
    + `When you're done, around ${formatClock(plan.visitEnd)}, do you want ${mealAt(plan.visitEnd)} nearby?`, { interrupt: true });
}

function spokenLine(route) {
  return route.length === 1 ? `${route} train` : `${route.split('/').join(', ')} train`;
}

async function answerEat(yes) {
  if (!state.dest) return;
  state.eat = yes;
  state.restaurant = null;
  if (!yes) {
    state.step = 'done';
    render();
    readHome();
    return;
  }
  state.step = 'food';
  state.openRestaurant = null;
  render();
  const dest = destById(state.dest);
  state.restaurants = await loadRestaurants(dest);
  state.spreadAt = Date.now();
  render();
  const meal = mealAt(buildPlan().visitEnd);
  speak(state.restaurants.length
    ? `Here are ${meal === 'a bite' ? 'places to eat' : `${meal} spots`} near ${spokenName(dest)}. Tap one to see more.`
    : `I couldn't find places to eat near ${spokenName(dest)}.`, { interrupt: true });
}

function openRestaurant(i) {
  state.openRestaurant = state.openRestaurant === i ? null : i;
  render();
  const r = state.restaurants[i];
  if (state.openRestaurant === i) {
    const dest = destById(state.dest);
    speak(`${r.name}. ${r.cuisine}.${r.price ? ` About ${spokenPrice(r.price)} a person.` : ''} ${walkMin(dest, r)} minutes' walk. ${r.booking ? `${r.booking}.` : ''} About ${r.minutes} minutes to eat.${r.dishes.length ? ` Known for ${r.dishes.slice(0, 2).join(' and ')}.` : ''}`, { interrupt: true });
  }
}

function spokenPrice(p) {
  return p.replace('–', ' to ').replace('+', ' or more');
}

function eatHere(i) {
  state.restaurant = state.restaurants[i];
  state.step = 'done';
  render();
  readHome();
}

function readHome() {
  const plan = buildPlan();
  const trains = plan.home.legs.filter((l) => l.type !== 'walk')
    .map((l) => `${l.type === 'path' ? 'the PATH' : `the ${spokenLine(l.route)}`} at ${formatClock(l.depart)}`).join(', then ');
  speak(`${state.restaurant ? `After ${state.restaurant.name}, ` : 'Heading home: '}take ${trains}. You'll be home around ${formatClock(plan.home.arrive)}.`, { interrupt: true });
}

function homeCard() {
  if (!state.dest) {
    speak('Hold up a place card first: Times Square, 23rd St, MoMA, The Met or Flushing.', { interrupt: true });
    return;
  }
  if (state.step === 'done') {
    readHome();
  } else {
    answerEat(false);
  }
}

// Cards in front of the camera right now (role strings).
let cardsInView = new Set();
const seenBar = document.getElementById('seen');

// Called every frame from script.js.
function handleFunctions(visible) {
  const now = new Set([...visible.keys()].filter((r) => FUNCTION_INFO[r]));
  if ([...now].join() !== [...cardsInView].join()) {
    cardsInView = now;
    renderSeenBar();
    render(); // places appear only while their card is up (or once chosen)
  }
  for (const [role] of visible) {
    if (fnWasVisible.has(role)) continue;
    if (role === 'home') homeCard();
    if (role.startsWith('dest:') && state.dest !== role.slice(5)) chooseDestination(role.slice(5));
  }
  fnWasVisible.clear();
  for (const [role] of visible) fnWasVisible.add(role);
}

function mapHint(visible, connection) {
  return '';
}

// Chips at the top: which cards the camera sees right now.
function renderSeenBar() {
  const area = typeof areaChipHtml === 'function' ? areaChipHtml() : '';
  if (cardsInView.size === 0) {
    seenBar.innerHTML = `${area}<span class="chip empty">📷 No card in ${area.includes('set') ? 'the area' : 'view'} — ${area.includes('set') ? 'put one inside the corners' : 'hold one up to the camera'}</span>`;
    return;
  }
  seenBar.innerHTML = area + [...cardsInView].map((r) => {
    const f = FUNCTION_INFO[r];
    return `<span class="chip">${f.icon} ${escapeHtml(f.label)}</span>`;
  }).join('');
}

function renderMap() { // used by zones.js after an import
  if (state.step === 'food' && state.dest) answerEat(true);
  else render();
}

// ---------------------------------------------------------------------------
// Board: nested frames (zones), Home in the middle, places on their zone

function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const wide = w >= 1000;
  const phone = w <= 640;
  const outer = { x: 10, y: 66, w: w - 20 - (wide ? 400 : 0), h: h - 76 - (phone ? Math.round(h * 0.4) : 0) };
  // The ArUco corner markers sit just outside Zone 4, so the zones are
  // inset by one marker on every side.
  const cell = Math.round(Math.max(phone ? 5 : 6, Math.min(9, Math.min(outer.w, outer.h) * 0.009)));
  const marker = cell * 8;
  const gap = 4;
  const area = { x: outer.x + marker + gap, y: outer.y + marker + gap, w: outer.w - 2 * (marker + gap), h: outer.h - 2 * (marker + gap) };
  const homeW = Math.max(phone ? 90 : 150, area.w * 0.16);
  const homeH = Math.max(phone ? 64 : 96, area.h * 0.14);
  const ix = (area.w - homeW) / 8;
  const iy = (area.h - homeH) / 8;
  const rects = [0, 1, 2, 3, 4].map((k) => ({ x: area.x + k * ix, y: area.y + k * iy, w: area.w - 2 * k * ix, h: area.h - 2 * k * iy }));
  geometry = { w, h, rects, phone, outer, cell };
}

function zoneOf(minutes) {
  return (ZONES.findIndex((z) => minutes <= z.max) + 1) || 4;
}

// Middle of a zone's band, on the destination's side.
function spotFor(zone, side) {
  const o = geometry.rects[4 - zone];
  const i = geometry.rects[5 - zone];
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  if (side === 'top') return { x: cx, y: (o.y + i.y) / 2 };
  if (side === 'bottom') return { x: cx, y: (o.y + o.h + i.y + i.h) / 2 };
  if (side === 'left') return { x: (o.x + i.x) / 2, y: cy };
  return { x: (o.x + o.w + i.x + i.w) / 2, y: cy };
}

function el(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}

function render() {
  layout();
  const g = geometry;
  board.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`);
  board.replaceChildren();
  let stackPoint = null;

  g.rects.forEach((r, k) => {
    board.append(el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: k === 4 ? 14 : 4, class: k === 4 ? 'home-box' : 'frame' }));
  });
  drawCornerMarkers(g.outer, g.cell);
  ZONES.forEach((z, idx) => {
    const r = g.rects[3 - idx];
    const prev = idx ? ZONES[idx - 1].max : 0;
    board.append(el('text', { x: r.x + 10, y: r.y + 16, class: 'zone-label' },
      `ZONE ${idx + 1} · ${z.max === Infinity ? `${prev}+` : `≤${z.max}`} MIN`));
  });

  const hb = g.rects[4];
  const home = { x: hb.x + hb.w / 2, y: hb.y + hb.h / 2 };
  const homeG = el('g', { class: 'home-label', role: 'button', tabindex: 0, 'data-key': 'home' });
  homeG.append(el('text', { x: home.x, y: home.y - 2, 'text-anchor': 'middle', class: 'home-title' }, 'HOME'));
  homeG.append(el('text', { x: home.x, y: home.y + 18, 'text-anchor': 'middle', class: 'home-sub' }, formatClock(new Date())));
  homeG.addEventListener('click', homeCard);
  board.append(homeG);

  // Destinations, each on the zone it takes right now.
  const pts = {};
  for (const d of DESTINATIONS) {
    if (!cardsInView.has(`dest:${d.id}`) && state.dest !== d.id) continue;
    const trip = simulate(d.go, new Date());
    const minutes = (trip.arrive - Date.now()) / 60000;
    const pt = spotFor(zoneOf(minutes), d.side);
    pts[d.id] = pt;
    const on = state.dest === d.id;
    const grp = el('g', { class: `spot dest${on ? ' picked' : ''}${state.dest && !on ? ' quiet' : ''}`, transform: `translate(${pt.x} ${pt.y})`, role: 'button', tabindex: 0, 'data-key': `dest-${d.id}` });
    grp.append(el('circle', { r: g.phone ? 14 : 20, class: 'spot-dot' }));
    grp.append(el('text', { y: g.phone ? 5 : 7, 'text-anchor': 'middle', class: 'spot-icon big' }, d.icon));
    // Keep labels on screen: beside the dot on the left/right edges,
    // above it at the bottom.
    const r0 = g.phone ? 14 : 20;
    const lab = {
      top: { x: 0, y1: r0 + 20, y2: r0 + 36, a: 'middle' },
      bottom: { x: 0, y1: -(r0 + 26), y2: -(r0 + 10), a: 'middle' },
      left: { x: -r0, y1: r0 + 20, y2: r0 + 36, a: 'start' },
      right: { x: r0, y1: r0 + 20, y2: r0 + 36, a: 'end' },
    }[d.side];
    if ((!g.phone || on || !state.dest) && !(g.phone && on && (state.step === 'food' || state.restaurant))) { // phones: only the chosen one, and not while food is out
      grp.append(el('text', { x: lab.x, y: lab.y1, 'text-anchor': lab.a, class: 'spot-name' }, d.label));
      if (!g.phone && !(on && state.step === 'food')) {
        grp.append(el('text', { x: lab.x, y: lab.y2, 'text-anchor': lab.a, class: 'spot-meta' }, `${Math.round(minutes)} min · arrive ${formatClock(trip.arrive)}`));
      }
    }
    // Tap (or point at) the chosen place again to spread out food nearby.
    grp.addEventListener('click', () => {
      if (state.dest !== d.id) chooseDestination(d.id);
      else if (state.step !== 'food') answerEat(true);
      else { state.openRestaurant = null; render(); }
    });
    if (on && state.step === 'arrive') {
      grp.append(el('circle', { r: (g.phone ? 14 : 20) + 8, class: 'tap-hint' }));
    }
    board.append(grp);
  }

  if (state.dest) {
    const d = destById(state.dest);
    const p = pts[d.id];
    const plan = buildPlan();
    line(edgeOf(hb, home, p), p, `${Math.round((plan.visitStart - Date.now()) / 60000)} min`);
    let last = p;
    if (state.step === 'food') stackPoint = p;
    // The restaurant you picked, beside the place.
    if (state.restaurant) {
      const list = [state.restaurant];
      foodSpots = {};
      const n = list.length;
      const o = g.rects[0];
      // Phones: two staggered rings so the names don't collide.
      const ring = (i) => (g.phone ? (i % 2 ? 150 : 82) : 175);
      const step = (g.phone ? 0.6 : 0.62) * (n <= 3 ? 1.5 : 1);
      const at = (centre, i) => {
        const a = centre + (n === 1 ? 0 : (i - (n - 1) / 2) * step);
        return { x: p.x + Math.cos(a) * ring(i), y: p.y + Math.sin(a) * ring(i) };
      };
      const inside = (q) => q.x > o.x + 30 && q.x < o.x + o.w - 30 && q.y > o.y + 30 && q.y < o.y + o.h - 40;
      // Fan out away from home if there's room, otherwise sideways or back.
      const away = Math.atan2(p.y - home.y, p.x - home.x);
      let centre = away;
      let best = -1;
      for (const c of [away, away - 0.8, away + 0.8, away - Math.PI / 2, away + Math.PI / 2, away + Math.PI]) {
        const fit = list.filter((r, i) => inside(at(c, i))).length;
        if (fit > best) { best = fit; centre = c; }
        if (fit === n) break;
      }
      list.forEach((r, i) => {
        const q = at(centre, i);
        const rp = {
          x: Math.min(o.x + o.w - 14, Math.max(o.x + 14, q.x)),
          y: Math.min(o.y + o.h - 14, Math.max(o.y + 14, q.y)),
        };
        const chosen = state.restaurant === r;
        if (chosen) {
          line(p, rp, `${walkMin(d, r)} min`);
          last = rp;
        } else {
          board.append(el('line', { x1: p.x, y1: p.y, x2: rp.x, y2: rp.y, class: 'leg faint' }));
        }
        const idx = state.restaurants ? state.restaurants.indexOf(r) : -1;
        const grp = el('g', { class: `spot food${chosen || state.openRestaurant === idx ? ' picked' : ''}`, transform: `translate(${rp.x} ${rp.y})`, role: 'button', tabindex: 0, 'data-key': `food-${i}` });
        // Spread out from the place: each dot flies out from the centre.
        const inner = el('g', { class: Date.now() - state.spreadAt < 900 ? 'pop' : '' });
        inner.style.setProperty('--dx', `${p.x - rp.x}px`);
        inner.style.setProperty('--dy', `${p.y - rp.y}px`);
        inner.style.animationDelay = `${i * 70}ms`;
        grp.append(inner);
        inner.append(el('circle', { r: g.phone ? 13 : 16, class: 'spot-dot' }));
        inner.append(el('text', { y: 5, 'text-anchor': 'middle', class: 'spot-icon' }, r.source === 'saved' ? '⭐' : '🍴'));
        {
          const max = g.phone ? 13 : 20;
          // Near the screen edge, line the name up with the edge so it isn't cut off.
          const anchor = rp.x > o.x + o.w - 70 ? 'end' : rp.x < o.x + 70 ? 'start' : 'middle';
          const ax = anchor === 'end' ? 14 : anchor === 'start' ? -14 : 0;
          inner.append(el('text', { x: ax, y: g.phone ? 28 : 32, 'text-anchor': anchor, class: 'spot-name small' }, r.name.length > max ? `${r.name.slice(0, max - 1)}…` : r.name));
          if (r.price && !chosen && !g.phone) inner.append(el('text', { x: ax, y: 46, 'text-anchor': anchor, class: 'spot-meta' }, `${r.price} · ${walkMin(d, r)} min`));
        }
        if (idx >= 0) foodSpots[idx] = rp;
        if (idx >= 0) grp.addEventListener('click', () => openRestaurant(idx));
        board.append(grp);
      });
    }
    if (state.step === 'done') {
      line(last, edgeOf(hb, home, last), `${Math.round((plan.home.arrive - (state.restaurant ? plan.mealEnd : plan.visitEnd)) / 60000)} min`, true);
    }
  }

  // While choosing food, the map steps back so the list is easy to read.
  board.classList.toggle('dim', !!stackPoint && !!state.restaurants?.length);
  renderPanel();
  renderFoodStack(stackPoint);
  renderFoodCard();
}

// ArUco markers (OpenCV DICT_4X4, ids 0–3) in the four corners of the
// Zone 4 frame: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
// Another camera or program can use them to find this screen. The bits
// are the marker's 4×4 inner cells, row by row (1 = white).
const SCREEN_MARKERS = ['1011010100110010', '0000111110011010', '0011001100101101', '1001100101000110'];

// Drawn in the corners of `r` (the box around Zone 4), outside the frame.
function drawCornerMarkers(r, cell) {
  const size = cell * 8; // 1 white margin + 6 marker cells + 1 white margin
  const spots = [
    [r.x, r.y],
    [r.x + r.w - size, r.y],
    [r.x + r.w - size, r.y + r.h - size],
    [r.x, r.y + r.h - size],
  ];
  spots.forEach(([x, y], id) => {
    const grp = el('g', { class: 'aruco', transform: `translate(${x} ${y})`, 'shape-rendering': 'crispEdges' });
    grp.append(el('rect', { width: size, height: size, fill: '#fff' }));
    grp.append(el('rect', { x: cell, y: cell, width: cell * 6, height: cell * 6, fill: '#000' }));
    [...SCREEN_MARKERS[id]].forEach((bit, k) => {
      if (bit === '1') grp.append(el('rect', { x: cell * (2 + (k % 4)), y: cell * (2 + Math.floor(k / 4)), width: cell, height: cell, fill: '#fff' }));
    });
    board.append(grp);
  });
}

function edgeOf(r, c, p) {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const t = Math.min(Math.abs((r.w / 2) / (dx || 1e-6)), Math.abs((r.h / 2) / (dy || 1e-6)));
  return { x: c.x + dx * t, y: c.y + dy * t };
}

// `curve` bends the line (used for the way home so it doesn't sit on top of
// the way there).
function line(a, b, label, curve = false) {
  let mx = (a.x + b.x) / 2;
  let my = (a.y + b.y) / 2;
  if (curve) {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const bend = Math.min(90, len * 0.35);
    const cx = mx + ((b.y - a.y) / len) * bend * -1;
    const cy = my + ((b.x - a.x) / len) * bend;
    board.insertBefore(el('path', { d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`, class: 'leg back', fill: 'none' }), board.querySelector('.spot'));
    mx = (a.x + 2 * cx + b.x) / 4;
    my = (a.y + 2 * cy + b.y) / 4;
  } else {
    board.insertBefore(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'leg' }), board.querySelector('.spot'));
  }
  if (label && !geometry.phone) {
    board.append(el('rect', { x: mx - 30, y: my - 11, width: 60, height: 22, rx: 11, class: 'leg-pill' }));
    board.append(el('text', { x: mx, y: my + 4, 'text-anchor': 'middle', class: 'leg-text' }, label));
  }
}

// ---------------------------------------------------------------------------
// Panel

function legRow(l) {
  if (l.type === 'walk') {
    return `<li class="st walk"><span class="t">${formatClock(l.depart)}</span><span>🚶 ${escapeHtml(l.text)} · ${l.minutes} min</span></li>`;
  }
  const name = l.type === 'path' ? 'PATH' : `${escapeHtml(l.route)} train`;
  const wait = l.wait >= 1 ? ` <em>· wait ${Math.round(l.wait)} min</em>` : '';
  return `<li class="st ride"><span class="t">${formatClock(l.depart)}</span><span>🚇 <b>${name}</b> ${escapeHtml(l.from)} → ${escapeHtml(l.to)}${wait}${l.estimated ? ' <em>(est.)</em>' : ''}<br><em>arrive ${formatClock(l.arrive)}</em></span></li>`;
}

// Places to eat slide out from the chosen place as a tidy column of
// glass rows (name · price · walk). Tap / pinch a row to open its card.
let foodSpots = {};
const foodCard = document.getElementById('food-card');
const foodStack = document.getElementById('food-stack');
let stackShownFor = '';
let stackSide = 'right';

function renderFoodStack(p) {
  if (!p || state.step !== 'food' || !state.restaurants || state.restaurants.length === 0) {
    foodStack.hidden = true;
    foodStack.replaceChildren();
    stackShownFor = '';
    return;
  }
  const d = destById(state.dest);
  const g = geometry;
  const key = `${state.dest}:${state.spreadAt}`;
  const animate = stackShownFor !== key;
  stackShownFor = key;
  const meal = mealAt(buildPlan().visitEnd);
  stackSide = p.x > g.rects[0].x + g.rects[0].w / 2 ? 'left' : 'right';
  foodStack.className = `${animate ? 'in ' : ''}from-${stackSide}`;
  foodStack.innerHTML = `<div class="fs-head">${meal === 'a bite' ? 'TO EAT' : meal.toUpperCase()} NEAR ${escapeHtml(d.label.toUpperCase())}</div>`
    + state.restaurants.map((r, i) => `<button type="button" class="fs-item${state.openRestaurant === i ? ' on' : ''}" data-key="food-${i}" data-i="${i}" style="--d:${80 + i * 60}ms">
        <span class="fs-name">${r.source === 'saved' ? '⭐ ' : ''}${escapeHtml(r.name)}</span>
        <span class="fs-meta">${r.price ? `${escapeHtml(r.price)} · ` : ''}🚶 ${walkMin(d, r)} min</span></button>`).join('');
  foodStack.hidden = false;
  foodStack.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => openRestaurant(Number(b.dataset.i))));

  // Beside the place, on the side with more room, kept inside the map.
  const o = g.rects[0];
  const sw = foodStack.offsetWidth;
  const sh = foodStack.offsetHeight;
  const gap = g.phone ? 26 : 40;
  const clamp2 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const x = clamp2(stackSide === 'left' ? p.x - gap - sw : p.x + gap, o.x + 6, o.x + o.w - sw - 6);
  const y = clamp2(p.y - sh / 2, o.y + 6, Math.max(o.y + 6, o.y + o.h - sh - 6));
  foodStack.style.left = `${x}px`;
  foodStack.style.top = `${y}px`;
  // One quiet line from the place to the column.
  const ex = stackSide === 'left' ? x + sw : x;
  const ey = clamp2(p.y, y + 30, y + sh - 20);
  board.insertBefore(el('line', { x1: p.x, y1: p.y, x2: ex, y2: ey, class: 'leg faint' }), board.querySelector('.spot'));
}

// Card for the restaurant you opened: price, distance, booking, time to
// eat, signature dishes, and "Eat here". Sits beside the column.
function renderFoodCard() {
  const i = state.openRestaurant;
  const r = state.step === 'food' && i != null && state.restaurants ? state.restaurants[i] : null;
  const row = r && foodStack.querySelector(`[data-i="${i}"]`);
  if (!row) {
    foodCard.hidden = true;
    return;
  }
  const d = destById(state.dest);
  const miles = haversineMiles(d, r);
  foodCard.innerHTML = `
    <button type="button" class="fc-close" data-fc="close" aria-label="Close">✕</button>
    <div class="fc-name">${r.source === 'saved' ? '⭐ ' : ''}${escapeHtml(r.name)}</div>
    <div class="fc-cuisine">${escapeHtml(r.cuisine)}</div>
    <dl>
      <dt>💵</dt><dd>${r.price ? `${escapeHtml(r.price)} per person <em>(approx.)</em>` : 'Price not known'}</dd>
      <dt>🚶</dt><dd>${miles.toFixed(1)} mi · ${walkMin(d, r)} min walk from ${escapeHtml(d.label)}${r.approx ? ' <em>(location approx.)</em>' : ''}</dd>
      <dt>📅</dt><dd>${escapeHtml(r.booking || 'Booking info not available — check before you go')}</dd>
      <dt>⏱</dt><dd>About ${r.minutes} min to eat</dd>
      ${r.dishes.length ? `<dt>⭐</dt><dd>${r.dishes.map(escapeHtml).join(' · ')}</dd>` : ''}
    </dl>
    <button type="button" class="fc-eat" data-fc="eat">🍴 Eat here</button>`;
  foodCard.hidden = false;
  const cw = foodCard.offsetWidth;
  const ch = foodCard.offsetHeight;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const sr = foodStack.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  // Away from the place first (the column already sits beside it).
  const sides = stackSide === 'left' ? [sr.left - 12 - cw, sr.right + 12] : [sr.right + 12, sr.left - 12 - cw];
  let x = sides.find((v) => v >= 8 && v + cw <= W - 8);
  if (x === undefined) x = Math.max(8, (W - cw) / 2); // phone: over the map
  const y = Math.max(64, Math.min(H - ch - 8, rr.top + rr.height / 2 - ch / 2));
  foodCard.style.left = `${x}px`;
  foodCard.style.top = `${y}px`;
  foodCard.querySelector('[data-fc="close"]').addEventListener('click', () => { state.openRestaurant = null; render(); });
  foodCard.querySelector('[data-fc="eat"]').addEventListener('click', () => eatHere(i));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderPanel() {
  const parts = [];
  if (!state.dest) {
    const showing = DESTINATIONS.filter((d) => cardsInView.has(`dest:${d.id}`));
    parts.push('<div class="pl-kicker">WHERE TO?</div>');
    if (showing.length === 0) {
      parts.push('<p class="pl-empty">Hold up one of your place cards to the camera. It shows up on the map with how long it takes from home right now.</p>');
    } else {
      parts.push('<div class="dest-list">');
      for (const d of showing) {
        const trip = simulate(d.go, new Date());
        parts.push(`<button type="button" data-dest="${d.id}">${d.icon} ${escapeHtml(d.label)}<span>arrive ${formatClock(trip.arrive)}</span></button>`);
      }
      parts.push('</div>');
    }
    if (typeof savedPlansHtml === 'function') parts.push(savedPlansHtml());
  } else {
    const plan = buildPlan();
    const d = plan.dest;
    parts.push(`<div class="pl-kicker">TODAY · LEAVE BY ${formatClock(leaveBy(plan.going))}</div><h2 class="pl-title">${d.icon} ${escapeHtml(d.label)}</h2>`);
    parts.push('<ol class="steps">');
    parts.push(`<li class="st place"><span class="t">${formatClock(leaveBy(plan.going))}</span><span>🏠 Leave home</span></li>`);
    plan.going.legs.forEach((l) => parts.push(legRow(l)));
    parts.push(`<li class="st place"><span class="t">${formatClock(plan.visitStart)}</span><span>${d.icon} <b>${escapeHtml(d.label)}</b> <em>· about ${d.visit} min</em></span></li>`);

    if (state.step === 'arrive') {
      parts.push('</ol>');
      const meal = mealAt(plan.visitEnd);
      parts.push(`<div class="ask"><div>Done around <b>${formatClock(plan.visitEnd)}</b>. ${meal === 'a bite' ? 'Grab a bite nearby?' : `Have ${meal} nearby?`}</div>
        <div class="ask-buttons"><button type="button" data-eat="yes">🍴 Yes, show places</button><button type="button" data-eat="no">🏠 No, head home</button></div>
        <div class="ask-tip">✋ Or point at ${d.icon} on the map and pinch (or hold still) — places to eat spread out around it.</div></div>`);
    } else if (state.step === 'food') {
      parts.push('</ol>');
      if (!state.restaurants) {
        parts.push('<p class="pl-empty">Finding places to eat…</p>');
      } else {
        parts.push(`<p class="pl-empty">${state.restaurants.length ? `${state.restaurants.length} places to eat are on the map, next to ${d.icon}. Tap one — or point and pinch — to see price, distance, booking and dishes.` : ''}</p>`);
        if (state.restaurants.length === 0) parts.push('<p class="pl-empty">No places found nearby.</p>');
        parts.push('<button type="button" class="skip" data-eat="no">Skip — head home</button>');
      }
    } else if (state.step === 'done') {
      if (state.restaurant) {
        const r = state.restaurant;
        parts.push(`<li class="st walk"><span class="t">${formatClock(plan.toFood.depart)}</span><span>🚶 Walk to ${escapeHtml(r.name)} · ${plan.toFood.minutes} min</span></li>`);
        parts.push(`<li class="st place"><span class="t">${formatClock(plan.mealStart)}</span><span>🍴 <b>${escapeHtml(r.name)}</b> <em>· about ${r.minutes} min</em></span></li>`);
      }
      plan.home.legs.forEach((l) => parts.push(legRow(l)));
      parts.push(`<li class="st place"><span class="t">${formatClock(plan.home.arrive)}</span><span>🏠 <b>Home</b></span></li></ol>`);
      const saved = typeof isPlanSaved === 'function' && isPlanSaved();
      parts.push(`<div class="keep-buttons"><button type="button" data-act="save"${saved ? ' class="on"' : ''}>${saved ? '⭐ Saved' : '☆ Save plan'}</button><button type="button" data-act="image">🖼 Image</button><button type="button" data-act="calendar">📅 Calendar</button></div>`);
      parts.push('<div class="ask-buttons"><button type="button" data-act="read">🔊 Read it</button><button type="button" data-act="reset">Start over</button></div>');
    }
  }
  parts.push('<p class="pl-note">Subway times: MTA schedule. PATH: timetable from the PATH app (home direction estimated). Walks are estimates.</p>');
  planPanel.innerHTML = parts.join('');

  planPanel.querySelectorAll('[data-dest]').forEach((b) => b.addEventListener('click', () => chooseDestination(b.dataset.dest)));
  planPanel.querySelectorAll('[data-eat]').forEach((b) => b.addEventListener('click', () => answerEat(b.dataset.eat === 'yes')));
  planPanel.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openRestaurant(Number(b.dataset.open))));
  planPanel.querySelectorAll('[data-eat-here]').forEach((b) => b.addEventListener('click', () => eatHere(Number(b.dataset.eatHere))));
  if (typeof bindSavedPlanButtons === 'function') bindSavedPlanButtons(planPanel);
  planPanel.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.act === 'read') readHome();
    if (b.dataset.act === 'save') savePlan();
    if (b.dataset.act === 'image') downloadPlanImage();
    if (b.dataset.act === 'calendar') downloadPlanCalendar();
    if (b.dataset.act === 'reset') {
      Object.assign(state, { dest: null, step: 'idle', eat: null, restaurants: null, openRestaurant: null, restaurant: null });
      render();
    }
  }));
}

window.addEventListener('resize', render);
setInterval(render, 30000); // trains and "leave now" move on
renderSeenBar();
render();

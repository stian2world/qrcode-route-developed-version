// Play area from four ArUco corner markers.
// Print the four markers (poster.html, page 2) and put them at the corners
// of your table / sheet: 0 top-left, 1 top-right, 2 bottom-right,
// 3 bottom-left. Once the camera has seen at least three of them, only
// cards INSIDE that area count — cards held outside it are ignored (they
// get a dashed box and "outside area" so you can tell).
// No markers in view → every card counts, as before.

const AREA = {
  dictionary: 'ARUCO_4X4_1000', // OpenCV's DICT_4X4: big squares, easy to spot
  ids: [0, 1, 2, 3], // top-left, top-right, bottom-right, bottom-left
  labels: ['top-left', 'top-right', 'bottom-right', 'bottom-left'],
  everyFrames: 5, // look for markers about 6 times a second
  scanWidth: 800, // px; markers are big, no need for full resolution
  rememberMs: 6000, // a hand covering a marker for a moment is fine
  lib: 'https://cdn.jsdelivr.net/npm/js-aruco2@2.0.0/src/',
};

let arDetector = null;
let arCanvas = null;
let arCtx = null;
let arFrame = 0;
const arSeen = {}; // id -> { pts: [4 points, video px], center, t }
let playArea = null; // [TL, TR, BR, BL] in video px, or null
let areaCount = 0; // how many corners currently known
let outsideCards = new Map(); // role -> screen point, for cards outside the area
let arLoading = true; // until the marker library has loaded (or failed)
let arScans = 0;

(async function loadAruco() {
  try {
    for (const f of ['cv.js', 'aruco.js', 'dictionaries/aruco_4x4_1000.js']) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = AREA.lib + f;
        s.onload = resolve;
        s.onerror = reject;
        document.head.append(s);
      });
    }
    arDetector = new AR.Detector({ dictionaryName: AREA.dictionary });
  } catch (error) {
    console.warn('Corner markers unavailable', error);
  }
  arLoading = false;
}());

// Called every frame from script.js (before cards are sorted in/out).
function updatePlayArea(now) {
  if (arDetector && video.videoWidth && ++arFrame % AREA.everyFrames === 0) {
    const scale = Math.min(1, AREA.scanWidth / video.videoWidth);
    if (!arCanvas) {
      arCanvas = document.createElement('canvas');
      arCtx = arCanvas.getContext('2d', { willReadFrequently: true });
    }
    arCanvas.width = Math.round(video.videoWidth * scale);
    arCanvas.height = Math.round(video.videoHeight * scale);
    arCtx.drawImage(video, 0, 0, arCanvas.width, arCanvas.height);
    let markers = [];
    try {
      markers = arDetector.detect(arCtx.getImageData(0, 0, arCanvas.width, arCanvas.height));
    } catch (error) { /* skip this frame */ }
    arScans++;
    for (const m of markers) {
      if (!AREA.ids.includes(m.id)) continue;
      const pts = m.corners.map((c) => ({ x: c.x / scale, y: c.y / scale }));
      const center = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
      arSeen[m.id] = { pts, center, t: now };
    }
  }

  const known = AREA.ids.filter((id) => arSeen[id] && now - arSeen[id].t < AREA.rememberMs);
  if (known.length !== areaCount) {
    areaCount = known.length;
    if (typeof renderSeenBar === 'function') renderSeenBar();
  }
  if (known.length < 3) {
    playArea = null;
    return;
  }
  // Use each marker's inner corner (the one facing the middle), so the
  // area is the space between the markers.
  const mid = known.reduce((s, id) => ({ x: s.x + arSeen[id].center.x / known.length, y: s.y + arSeen[id].center.y / known.length }), { x: 0, y: 0 });
  const quad = AREA.ids.map((id) => {
    if (!known.includes(id)) return null;
    return arSeen[id].pts.reduce((best, p) => (Math.hypot(p.x - mid.x, p.y - mid.y) < Math.hypot(best.x - mid.x, best.y - mid.y) ? p : best));
  });
  // Three corners: the fourth completes the parallelogram.
  const miss = quad.indexOf(null);
  if (miss >= 0) {
    const a = quad[(miss + 1) % 4];
    const b = quad[(miss + 2) % 4];
    const c = quad[(miss + 3) % 4];
    quad[miss] = { x: a.x + c.x - b.x, y: a.y + c.y - b.y, guessed: true };
  }
  playArea = quad;
}

// Right after the camera starts, wait a moment for the corners before
// letting cards count — otherwise a card outside the area could fire first.
function playAreaWarmingUp() {
  return arLoading || (arDetector && arScans < 8);
}

function insidePlayArea(p) {
  if (!playArea) return true;
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = playArea[i];
    const b = playArea[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Dashed outline of the area + small corner ticks, on the camera picture.
function drawPlayArea() {
  if (!playArea) return;
  const pts = playArea.map((p) => toScreen(p));
  overlayCtx.save();
  overlayCtx.strokeStyle = 'rgba(255,255,255,0.8)';
  overlayCtx.lineWidth = 2;
  overlayCtx.setLineDash([10, 8]);
  overlayCtx.beginPath();
  pts.forEach((p, i) => (i ? overlayCtx.lineTo(p.x, p.y) : overlayCtx.moveTo(p.x, p.y)));
  overlayCtx.closePath();
  overlayCtx.stroke();
  overlayCtx.setLineDash([]);
  overlayCtx.lineWidth = 4;
  pts.forEach((p, i) => {
    if (playArea[i].guessed) return;
    overlayCtx.beginPath();
    overlayCtx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    overlayCtx.stroke();
  });
  overlayCtx.restore();
}

// Cards the camera sees but that are outside the area.
function drawOutsideCards() {
  const u = unit();
  if (playAreaWarmingUp()) return; // nothing to say yet
  for (const [role, point] of outsideCards) {
    const f = FUNCTION_INFO[role];
    if (!f) continue;
    const half = point.size * 0.62;
    overlayCtx.save();
    overlayCtx.strokeStyle = 'rgba(255,255,255,0.45)';
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([8, 8]);
    roundRect(point.x - half, point.y - half, half * 2, half * 2, 10);
    overlayCtx.stroke();
    overlayCtx.restore();
    const y = Math.max(u * 1.6, point.y - half - u * 1.4);
    overlayCtx.save();
    overlayCtx.globalAlpha = 0.6;
    drawPill(`${f.icon} ${f.label} · outside area`, point.x, y, '#ffffff', u * 1.05);
    overlayCtx.restore();
  }
}

// Shown in the chip bar at the top.
function areaChipHtml() {
  if (!arDetector) return '';
  if (playArea) return `<span class="chip area">▢ Play area set${areaCount === 3 ? ' (3 of 4 corners)' : ''}</span>`;
  if (areaCount > 0) return `<span class="chip area off">▢ ${areaCount} of 4 corners — need 3</span>`;
  return '';
}

// Hand control: point at something on screen with your index finger and
// either PINCH (thumb + index together) or HOLD STILL for a moment to tap it.
// Uses MediaPipe Hand Landmarker (runs in the browser, nothing is uploaded).
// The ✋ button turns it on and off.

const HANDS = {
  version: '0.10.21',
  model: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  dwellMs: 550, // hold the fingertip on a button this long to tap it
  pinchRatio: 0.32, // thumb–index gap / hand size below this = pinch
  everyMs: 33, // run the hand model at most ~30 times a second
  // 'CPU' (WebAssembly) is steadier than 'GPU': the GPU version shares the
  // graphics card with the blurred glass panels and could crash the page
  // to a white screen, after which hand tracking stopped.
  delegate: 'CPU',
};

const finger = document.getElementById('finger');
const handButton = document.getElementById('hand-button');
let handOn = true;
let handLandmarker = null;
let handLoading = false;
let lastHandRun = 0;
let lastVideoTime = -1;
let pinched = false;
let hoverEl = null;
let hoverSince = 0;
let cooldownUntil = 0;
let smooth = null;
let handErrors = 0;
let tapPoint = null; // after a tap, hold-to-tap waits until the finger moves away

try {
  handOn = localStorage.getItem('qrHandControl') !== 'off';
} catch (error) { /* default on */ }
setHandButton();

handButton.addEventListener('click', () => {
  handOn = !handOn;
  try { localStorage.setItem('qrHandControl', handOn ? 'on' : 'off'); } catch (error) { /* ignore */ }
  setHandButton();
  if (handOn) {
    loadHands();
    showToast('✋ Hand control on — point, then pinch or hold still to tap');
  } else {
    hideFinger();
  }
});

function setHandButton() {
  handButton.setAttribute('aria-pressed', String(handOn));
  handButton.classList.toggle('off', !handOn);
}

async function loadHands() {
  if (handLandmarker || handLoading) return;
  handLoading = true;
  try {
    const base = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${HANDS.version}`;
    const { FilesetResolver, HandLandmarker } = await import(`${base}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${base}/wasm`);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: HANDS.model, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      handLandmarker = await HandLandmarker.createFromOptions(files, options(HANDS.delegate));
    } catch (error) {
      handLandmarker = await HandLandmarker.createFromOptions(files, options(HANDS.delegate === 'CPU' ? 'GPU' : 'CPU'));
    }
    handErrors = 0;
  } catch (error) {
    console.warn('Hand control unavailable', error);
    showToast('Hand control could not load — tapping still works');
  }
  handLoading = false;
}

function restartHands() {
  try { handLandmarker?.close(); } catch (error) { /* already gone */ }
  handLandmarker = null;
  handErrors = 0;
  hideFinger();
  if (handOn) loadHands();
}

// Coming back to the tab: timestamps jump, so begin fresh.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lastVideoTime = -1;
});

// Start once the camera is running.
video.addEventListener('playing', () => { if (handOn) loadHands(); });
requestAnimationFrame(handLoop);

function handLoop(now) {
  requestAnimationFrame(handLoop);
  if (!handOn || !handLandmarker || video.readyState < 2) return;
  if (now - lastHandRun < HANDS.everyMs || video.currentTime === lastVideoTime) return;
  lastHandRun = now;
  lastVideoTime = video.currentTime;
  let result;
  try {
    result = handLandmarker.detectForVideo(video, now);
    handErrors = 0;
  } catch (error) {
    // If the model keeps failing (e.g. lost its graphics context), start it
    // again instead of leaving hand control dead.
    if (++handErrors > 10) restartHands();
    return;
  }
  const hand = result.landmarks && result.landmarks[0];
  if (!hand) {
    hideFinger();
    return;
  }
  const tip = hand[8];
  const thumb = hand[4];
  const size = Math.hypot(hand[0].x - hand[9].x, hand[0].y - hand[9].y) || 1;
  const pinch = Math.hypot(tip.x - thumb.x, tip.y - thumb.y) / size < HANDS.pinchRatio;
  // Landmarks are 0–1 of the video frame; map them like the QR overlay.
  const p = toScreen({ x: tip.x * video.videoWidth, y: tip.y * video.videoHeight });
  handPointer(p.x, p.y, pinch);
}

// Moves the on-screen fingertip and taps things. Exposed so it can be tested
// (or driven by something else) without a real hand.
function handPointer(x, y, pinch, now = performance.now()) {
  // Follow fast moves straight away, smooth only small jitter.
  const jump = smooth ? Math.hypot(x - smooth.x, y - smooth.y) : 0;
  const k = jump > 40 ? 1 : 0.6;
  smooth = smooth ? { x: smooth.x + (x - smooth.x) * k, y: smooth.y + (y - smooth.y) * k } : { x, y };
  finger.hidden = false;
  finger.style.transform = `translate(${smooth.x}px, ${smooth.y}px)`;

  const target = tappableAt(smooth.x, smooth.y);
  // The map redraws itself; keep the hold timer if it's the same thing.
  const key = (e) => e && (e.getAttribute('data-key') || (e.tagName === 'BUTTON' ? `${e.className}|${e.textContent}` : null));
  if (target && hoverEl && target !== hoverEl && key(target) && key(target) === key(hoverEl)) {
    hoverEl = target;
    hoverEl.classList.add('hand-hover');
  }
  if (target !== hoverEl) {
    hoverEl?.classList.remove('hand-hover');
    hoverEl = target;
    hoverEl?.classList.add('hand-hover');
    hoverSince = now;
  }

  if (tapPoint && Math.hypot(smooth.x - tapPoint.x, smooth.y - tapPoint.y) > 40) {
    tapPoint = null;
    hoverSince = now;
  }
  let progress = 0;
  if (hoverEl && now > cooldownUntil) {
    progress = tapPoint ? 0 : Math.min(1, (now - hoverSince) / HANDS.dwellMs);
    if ((pinch && !pinched) || progress >= 1) {
      tapElement(hoverEl);
      cooldownUntil = now + 450;
      tapPoint = { ...smooth };
      progress = 0;
    }
  }
  pinched = pinch;
  finger.classList.toggle('pinch', pinch);
  finger.classList.toggle('over', !!hoverEl);
  finger.style.setProperty('--p', progress.toFixed(3));
}

function hideFinger() {
  finger.hidden = true;
  hoverEl?.classList.remove('hand-hover');
  hoverEl = null;
  smooth = null;
  tapPoint = null;
  pinched = false;
}

function tappableAt(x, y) {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const t = hit.closest('button, [role="button"], select');
  if (!t || t.disabled || t.closest('[hidden]')) return null;
  return t;
}

function tapElement(target) {
  finger.classList.remove('tapped');
  void finger.offsetWidth; // restart the little flash
  finger.classList.add('tapped');
  if (typeof target.click === 'function' && !(target instanceof SVGElement)) target.click();
  else target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

# tracking

A single-page web app that uses a webcam and [jsQR](https://github.com/cozmo/jsQR) to turn printed QR codes into a physical map of places — connect two of them and it recommends how to travel between them.

**Live demo:** https://qrcode-tracking-svs.netlify.app

## QR Routes — trip planner

The whole screen is the camera. Home is the box in the middle and **Zones 1–4 are frames around it**; each place sits on the zone it takes to reach *right now*.

| Card (QR text) | |
| --- | --- |
| Kimbap | 🥟 Flushing (PATH → N/Q/R/W → 7 train) |
| Vanila Creme Brulee | 🎭 Times Square |
| Matcha | 🎨 23rd St (PATH straight there) |
| yogurt | 🖼️ MoMA |
| Grapes | 🏛️ The Met |

Home is always the centre of the map, so every card is a place. Trips are timed from home, leaving now.

1. **Hold up a place card** (or tap it). The panel shows the trip leaving now: when to leave home, the walk, the **PATH train** and the **subway train** you'll catch (e.g. *“Leave by 2:12 PM, PATH at 2:16 PM, then the Q train at 2:38 PM — there at 2:42 PM”*).
2. From the time you'd be done there it asks about **breakfast / lunch / dinner**.
3. **No** (or the 🏠 card) → straight home. **Yes** → places to eat nearby: your Google Maps saved places first (⭐), then my notes (`RESTAURANT_NOTES`), then OpenStreetMap. Tap one to see **booking info, how long a meal takes and what it's known for**, then **Eat here**.
4. The way home: walk to the subway, the train you'll catch, then the PATH and the walk home, with the time you'll be back. Everything is read out loud.

Train times: subway departures are the real MTA schedule (`subway.js`, extracted from the GTFS zip with `tools/extract_subway_legs.py`); PATH toward NYC is the timetable from the PATH app; PATH toward home is estimated until its timetable is added. Walks are estimates. Restaurant notes are hand-checked but may go out of date — check before you go.

### Where the times come from

No API key needed. `PRESET_ROUTES` in `config.js` holds door-to-door times looked up in Google Maps and the PATH app. For Home ↔ SVA the pop-up shows the **next PATH train from the current time** (from `TIMETABLES`), e.g. *🚇 Next PATH 9:52 PM · in 9 min*, reads it out, and adds the wait to the trip time. After the last train it says there are no more trains tonight and gives tomorrow's first train. The 23rd St → Grove St timetable is still a copy of the other direction and is marked *(est.)* until the real times are added. Pairs or modes that aren't filled in are rough guesses from distance and are marked *est.*

### Google Maps API key (optional)

With a key, live routes from the [Google Routes API](https://developers.google.com/maps/documentation/routes/overview) replace the preset times.

1. In Google Cloud Console, create a key and enable **Routes API**.
2. Restrict the key to your site URLs (HTTP referrers) — it's visible in the browser.
3. Open the app once as `https://…/?key=YOUR_KEY`. The key is remembered in that browser and removed from the address bar, so it never needs to be committed.

### Import from Google Maps

Google has no API for saved places, so export them once with [Google Takeout](https://takeout.google.com): select **Maps (your places)** *and* **Saved**, export, then tap ⬇️ and choose the zip. Starred places, saved lists (Want to go, Favorites, your own lists) and your reviews are imported and show up first in the neighbourhood they're in; places outside North NJ / NYC are skipped. Places without coordinates are located with Mapbox (`MAPBOX_TOKEN` in `config.js`) or, without a token, OpenStreetMap.

Imported places and check-ins are stored **only in that browser** (localStorage) — they never go into this public repo. Import on the device you'll demo with.

## Phone and laptop

The layout adapts to the screen (tested at iPhone 12 Pro size, portrait and landscape, and on a laptop):

- the whole camera picture is always shown (never cropped), and labels are drawn in screen pixels so they stay readable;
- the top bar (✨ preference — tap it to switch — and 🔄 camera flip) stays clear of the iPhone notch;
- every button is at least 44 × 44 px;
- the route pop-up is a card on the top-right on a laptop, a sheet along the bottom on a phone in portrait, and a side panel on a phone held sideways.

## Running locally

```bash
npx serve .
```

Then open the printed URL and grant camera access. No build step — it's vanilla JS/HTML/CSS.

## Deploying

```bash
npx netlify-cli deploy --prod --dir=.
```

## Files

- `index.html` — page shell, loads the webcam video element and jsQR from a CDN
- `landmarks.js` — zones, default landmarks, PATH stations
- `zones.js` — trips from home, Google Maps import, check-ins
- `planner.js` — zone frames, the five cards, trip + meal + way home
- `plans.js` — keep a plan: ⭐ save (reopen later), 🖼 image, 📅 calendar (.ics)
- `hands.js` — hand control: fingertip pointer, pinch / hold-still to tap (MediaPipe)
- `subway.js` — subway departures for the four trips (MTA GTFS)
- `poster.html` — printable QR cards
- `config.js` — QR → place mapping, addresses, API key, cost/CO₂ estimates
- `script.js` — QR detection, routing, pop-up and voice. Detection scans a downscaled frame, re-checks known codes in a small window every frame, and spreads the full search for new codes over 3 frames (about 4× faster than scanning every tile every frame).
- `style.css` — minimal layout for the fullscreen video + canvas overlay

## Hand control ✋ and places to eat

- Hold up a place card (e.g. **Grapes → The Met**). The trip appears.
- **Point** at the place on the map with your index finger. A white ring follows your fingertip.
- **Pinch** (thumb + index) or **hold still** for about a second to tap it. Places to eat spread out around it.
- Point at a restaurant and pinch to open its card. It shows the price per person (approx.), the distance and walk time, whether you need to book, how long a meal takes, and the signature dishes. Pinch **Eat here** to get the way home.
- Mouse / touch tapping still works. The ✋ button turns hand control on and off.
- Hand tracking uses MediaPipe Hand Landmarker in the browser. Nothing is uploaded.
- Restaurant notes (price, dishes, booking) live in `RESTAURANT_NOTES` in `landmarks.js`.

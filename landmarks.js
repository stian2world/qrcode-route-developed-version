// Zones, saved landmarks, and the PATH stations used to estimate trips.
// Everything here is plain data — edit freely.

// Zones are rings of "how long it takes from home, leaving now".
// A landmark can move between zones during the day (e.g. waiting for the
// next PATH train). Printed zone QR codes contain the `id` text.
const ZONES = [
  { id: 'zone-1', label: 'Zone 1', name: 'Around the corner', max: 15, color: '#7be495' },
  { id: 'zone-2', label: 'Zone 2', name: 'Quick trip', max: 35, color: '#ffd166' },
  { id: 'zone-3', label: 'Zone 3', name: 'Worth the ride', max: 45, color: '#ff9f43' },
  { id: 'zone-4', label: 'Zone 4', name: 'Day out', max: Infinity, color: '#7aa2ff' },
];

// PATH from Grove St (the station by home). `ride` = minutes on the train
// from Grove St. `timetable` = a TIMETABLES entry in config.js if we have
// one; otherwise an average wait is assumed and marked "est.".
const HOME_TO_GROVE_MIN = 4;
const AVG_PATH_WAIT_MIN = 5;
const PATH_STATIONS = {
  exchange: { name: 'Exchange Place', lat: 40.7164, lng: -74.0329, ride: 2, line: 'WTC' },
  wtc: { name: 'World Trade Center', lat: 40.7126, lng: -74.0099, ride: 7, line: 'WTC' },
  newport: { name: 'Newport', lat: 40.7270, lng: -74.0340, ride: 3, line: '33RD', timetable: 'GROVE_TO_33RD' },
  christopher: { name: 'Christopher St', lat: 40.7329, lng: -74.0071, ride: 9, line: '33RD', timetable: 'GROVE_TO_33RD' },
  ninth: { name: '9th St', lat: 40.7343, lng: -73.9989, ride: 11, line: '33RD', timetable: 'GROVE_TO_33RD' },
  fourteenth: { name: '14th St', lat: 40.7374, lng: -73.9968, ride: 13, line: '33RD', timetable: 'GROVE_TO_33RD' },
  twentythird: { name: '23rd St', lat: 40.7429, lng: -73.9926, ride: 15, line: '33RD', timetable: 'GROVE_TO_33RD' },
  thirtythird: { name: '33rd St', lat: 40.7491, lng: -73.9882, ride: 17, line: '33RD', timetable: 'GROVE_TO_33RD' },
};

// Default landmarks. `trip` describes the best way from home:
//   { walk: minutes }                                    — just walk
//   { path: station, after: minutes, detail, say }       — PATH, then
//      `after` minutes of walking / subway from that station.
// Subway leg times come from the MTA GTFS file; walking and transfers are
// estimates. Each landmark's QR code contains `lm-<id>`.
const LANDMARKS = [
  {
    id: 'hudson', label: 'Hudson River Waterfront', spoken: 'Hudson River Waterfront', icon: '🌊', kind: 'Park',
    address: 'Hudson River Waterfront Walkway, Exchange Place, Jersey City, NJ',
    lat: 40.7163, lng: -74.0327, state: 'NJ',
    trip: { walk: 8, miles: 0.4 },
  },
  {
    id: 'liberty', label: 'Liberty State Park', icon: '🗽', kind: 'Park',
    address: 'Liberty State Park, Jersey City, NJ',
    lat: 40.7041, lng: -74.0533, state: 'NJ',
    trip: { walk: 35, miles: 1.7, note: 'est. — or the Hudson-Bergen Light Rail' },
  },
  {
    id: 'bryant', label: 'Bryant Park', icon: '🌳', kind: 'Park',
    address: 'Bryant Park, New York, NY',
    lat: 40.7536, lng: -73.9832, state: 'NY',
    trip: { path: 'thirtythird', after: 9, miles: 5, detail: 'PATH to 33rd St, walk 9 blocks', say: 'Take the PATH to 33rd Street, then walk 9 blocks up 6th Avenue.' },
  },
  {
    id: 'timessq', label: 'Times Square', icon: '🎭', kind: 'Landmark',
    address: 'Times Square, New York, NY',
    lat: 40.7580, lng: -73.9855, state: 'NY',
    trip: { path: 'thirtythird', after: 10, miles: 5, detail: 'PATH to 33rd St + N/Q/R/W 1 stop', say: 'Take the PATH to 33rd Street, then the N, Q, R or W one stop to Times Square.' },
  },
  {
    id: 'moma', label: 'MoMA', spoken: 'Moma', icon: '🖼️', kind: 'Museum',
    address: 'The Museum of Modern Art, 11 W 53rd St, New York, NY',
    lat: 40.7614, lng: -73.9776, state: 'NY',
    trip: { path: 'thirtythird', after: 16, miles: 5.5, detail: 'PATH to 33rd St + F to 5 Av/53 St', say: 'Take the PATH to 33rd Street, then the F train to Fifth Avenue and 53rd Street.' },
  },
  {
    id: 'centralpark', label: 'Central Park', icon: '🌲', kind: 'Park',
    address: 'Central Park South, New York, NY',
    lat: 40.7651, lng: -73.9762, state: 'NY',
    trip: { path: 'thirtythird', after: 16, miles: 5.5, detail: 'PATH to 33rd St + N/Q/R/W to 57 St', say: 'Take the PATH to 33rd Street, then the N, Q, R or W to 57th Street.' },
  },
  {
    id: 'met', label: 'The Met', icon: '🏛️', kind: 'Museum',
    address: 'The Metropolitan Museum of Art, 1000 5th Ave, New York, NY',
    lat: 40.7794, lng: -73.9632, state: 'NY',
    trip: { path: 'thirtythird', after: 30, miles: 7, detail: 'PATH to 33rd St + 6 train to 86 St', say: 'Take the PATH to 33rd Street, walk to Park Avenue, then the 6 train to 86th Street.' },
  },
  {
    id: 'bbp', label: 'Brooklyn Bridge Park', icon: '🌉', kind: 'Park',
    address: 'Brooklyn Bridge Park, Brooklyn, NY',
    lat: 40.7003, lng: -73.9967, state: 'NY',
    trip: { path: 'wtc', after: 22, miles: 5, detail: 'PATH to WTC + A/C to High St', say: 'Take the PATH to World Trade Center, then the A or C train from Fulton Street to High Street.' },
  },
];

// ---------------------------------------------------------------------------
// Neighbourhoods — one per zone, each with its own printed QR card (the
// `id` is the text inside the code). Holding a card up shows places to eat
// and things to do around `center` (from OpenStreetMap, or `fallback` when
// that can't be reached).
const DISTRICTS = [
  {
    id: 'jersey-city', zone: 1, label: 'Downtown Jersey City', short: 'Jersey City',
    center: { lat: 40.7196, lng: -74.0423 }, radius: 700,
    fallback: [
      { name: 'Razza', kind: 'restaurant', lat: 40.7193, lng: -74.0429 },
      { name: 'Grand Sichuan', kind: 'restaurant', lat: 40.7205, lng: -74.0427 },
      { name: 'Porta', kind: 'restaurant', lat: 40.7208, lng: -74.0436 },
      { name: 'Van Vorst Park', kind: 'park', lat: 40.7178, lng: -74.0478 },
      { name: 'Hamilton Park', kind: 'park', lat: 40.7277, lng: -74.0453 },
      { name: 'Hudson River Waterfront Walkway', kind: 'sight', lat: 40.7163, lng: -74.0327 },
    ],
  },
  {
    id: 'village', zone: 2, label: 'Chelsea & the Village', short: 'Village',
    center: { lat: 40.7370, lng: -74.0010 }, radius: 900,
    fallback: [
      { name: 'Chelsea Market', kind: 'restaurant', lat: 40.7424, lng: -74.0061 },
      { name: "Joe's Pizza", kind: 'restaurant', lat: 40.7306, lng: -74.0024 },
      { name: 'Washington Square Park', kind: 'park', lat: 40.7308, lng: -73.9973 },
      { name: 'The High Line', kind: 'park', lat: 40.7398, lng: -74.0082 },
      { name: 'Whitney Museum', kind: 'museum', lat: 40.7396, lng: -74.0089 },
      { name: 'Union Square', kind: 'park', lat: 40.7359, lng: -73.9906 },
    ],
  },
  {
    id: 'midtown', zone: 3, label: 'Midtown', short: 'Midtown',
    center: { lat: 40.7550, lng: -73.9820 }, radius: 900,
    fallback: [
      { name: 'Grand Central Oyster Bar', kind: 'restaurant', lat: 40.7524, lng: -73.9773 },
      { name: 'Urbanspace Vanderbilt', kind: 'restaurant', lat: 40.7537, lng: -73.9787 },
      { name: 'Bryant Park', kind: 'park', lat: 40.7536, lng: -73.9832 },
      { name: 'New York Public Library', kind: 'museum', lat: 40.7532, lng: -73.9822 },
      { name: 'Times Square', kind: 'sight', lat: 40.7580, lng: -73.9855 },
      { name: 'MoMA', kind: 'museum', lat: 40.7614, lng: -73.9776 },
      { name: 'Rockefeller Center', kind: 'sight', lat: 40.7587, lng: -73.9787 },
    ],
  },
  {
    id: 'uptown', zone: 4, label: 'Central Park & Upper East Side', short: 'Uptown',
    center: { lat: 40.7765, lng: -73.9665 }, radius: 1000,
    fallback: [
      { name: 'Café Sabarsky', kind: 'cafe', lat: 40.7813, lng: -73.9603 },
      { name: 'The Met', kind: 'museum', lat: 40.7794, lng: -73.9632 },
      { name: 'Guggenheim Museum', kind: 'museum', lat: 40.7830, lng: -73.9590 },
      { name: 'Bethesda Terrace', kind: 'park', lat: 40.7740, lng: -73.9708 },
      { name: 'Central Park — The Mall', kind: 'park', lat: 40.7720, lng: -73.9711 },
    ],
  },
];

// How long you usually stay, in minutes.
const STAY_MINUTES = {
  restaurant: 60,
  cafe: 30,
  bar: 60,
  park: 45,
  museum: 90,
  gallery: 40,
  sight: 30,
};

// Grove St PATH station (by home).
const GROVE_ST = { lat: 40.7194, lng: -74.0430 };

// ---------------------------------------------------------------------------
// The four place cards (QR text = id). `go` / `back` are the trip legs:
//   walk   — minutes on foot
//   path   — PATH train, using a TIMETABLES entry (config.js)
//   subway — subway train, using real departures in SUBWAY_LEGS (subway.js);
//            `every` is used when there's no schedule for that day (est.)
// `back` starts with a walk from wherever you are to `backStation`.
const DESTINATIONS = [
  {
    id: 'times-square', label: 'Times Square', icon: '🎭', side: 'right',
    lat: 40.7580, lng: -73.9855, visit: 30,
    go: [
      { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk to Grove St PATH' },
      { type: 'path', timetable: 'GROVE_TO_33RD', ride: 17, from: 'Grove St', to: '33rd St' },
      { type: 'walk', minutes: 3, text: 'Walk to 34 St–Herald Sq' },
      { type: 'subway', leg: 'times-square-go', lines: 'N/Q/R/W', from: '34 St–Herald Sq', to: 'Times Sq–42 St', every: 5, ride: 2 },
      { type: 'walk', minutes: 2, text: 'Walk to Times Square' },
    ],
    backStation: { name: 'Times Sq–42 St', lat: 40.7547, lng: -73.9868 },
    back: [
      { type: 'subway', leg: 'times-square-back', lines: 'N/Q/R/W', from: 'Times Sq–42 St', to: '34 St–Herald Sq', every: 5, ride: 2 },
      { type: 'walk', minutes: 3, text: 'Walk to 33rd St PATH' },
    ],
  },
  {
    id: '23rd-st', label: '23rd St', spoken: 'Twenty-third Street', icon: '🎨', side: 'top',
    lat: 40.7429, lng: -73.9928, visit: 60, // 23rd St PATH, 6th Ave (by SVA)
    go: [
      { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk to Grove St PATH' },
      { type: 'path', timetable: 'GROVE_TO_33RD', ride: 14, from: 'Grove St', to: '23rd St' },
    ],
    backStation: { name: '23rd St PATH', lat: 40.7429, lng: -73.9928 },
    back: [],
    // Straight home from 23rd St (no change to 33rd St).
    home: [
      { type: 'path', timetable: 'TWENTY_THIRD_TO_GROVE', ride: 14, from: '23rd St', to: 'Grove St' },
      { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk home' },
    ],
  },
  {
    id: 'moma', label: 'MoMA', spoken: 'Moma', icon: '🖼️', side: 'left',
    lat: 40.7614, lng: -73.9776, visit: 90,
    go: [
      { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk to Grove St PATH' },
      { type: 'path', timetable: 'GROVE_TO_33RD', ride: 17, from: 'Grove St', to: '33rd St' },
      { type: 'walk', minutes: 2, text: 'Walk to 34 St–Herald Sq' },
      { type: 'subway', leg: 'moma-go', lines: 'F/M', from: '34 St–Herald Sq', to: '5 Av/53 St', every: 8, ride: 6 },
      { type: 'walk', minutes: 3, text: 'Walk to MoMA' },
    ],
    backStation: { name: '5 Av/53 St', lat: 40.7602, lng: -73.9752 },
    back: [
      { type: 'subway', leg: 'moma-back', lines: 'F/M', from: '5 Av/53 St', to: '34 St–Herald Sq', every: 8, ride: 6 },
      { type: 'walk', minutes: 2, text: 'Walk to 33rd St PATH' },
    ],
  },
  {
    id: 'the-met', label: 'The Met', icon: '🏛️', side: 'bottom',
    lat: 40.7794, lng: -73.9632, visit: 120,
    go: [
      { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk to Grove St PATH' },
      { type: 'path', timetable: 'GROVE_TO_33RD', ride: 17, from: 'Grove St', to: '33rd St' },
      { type: 'walk', minutes: 8, text: 'Walk to 33 St (Park Ave)' },
      { type: 'subway', leg: 'met-go', lines: '6', from: '33 St', to: '86 St', every: 6, ride: 11 },
      { type: 'walk', minutes: 9, text: 'Walk to The Met' },
    ],
    backStation: { name: '86 St (Lexington Ave)', lat: 40.7795, lng: -73.9556 },
    back: [
      { type: 'subway', leg: 'met-back', lines: '6', from: '86 St', to: '33 St', every: 6, ride: 11 },
      { type: 'walk', minutes: 8, text: 'Walk to 33rd St PATH' },
    ],
  },
  {
    id: 'flushing', label: 'Flushing', spoken: 'Flushing', icon: '🥟', side: 'right',
    lat: 40.7596, lng: -73.8300, visit: 120, // Flushing–Main St (7)
    go: [
      { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk to Grove St PATH' },
      { type: 'path', timetable: 'GROVE_TO_33RD', ride: 17, from: 'Grove St', to: '33rd St' },
      { type: 'walk', minutes: 3, text: 'Walk to 34 St–Herald Sq' },
      { type: 'subway', leg: 'times-square-go', lines: 'N/Q/R/W', from: '34 St–Herald Sq', to: 'Times Sq–42 St', every: 5, ride: 2 },
      { type: 'walk', minutes: 4, text: 'Change to the 7 at Times Sq' },
      { type: 'subway', leg: 'flushing-go', lines: '7', from: 'Times Sq–42 St', to: 'Flushing–Main St', every: 6, ride: 35 },
    ],
    backStation: { name: 'Flushing–Main St', lat: 40.7596, lng: -73.8300 },
    back: [
      { type: 'subway', leg: 'flushing-back', lines: '7', from: 'Flushing–Main St', to: 'Times Sq–42 St', every: 6, ride: 35 },
      { type: 'walk', minutes: 4, text: 'Change to the N/Q/R/W at Times Sq' },
      { type: 'subway', leg: 'times-square-back', lines: 'N/Q/R/W', from: 'Times Sq–42 St', to: '34 St–Herald Sq', every: 5, ride: 2 },
      { type: 'walk', minutes: 3, text: 'Walk to 33rd St PATH' },
    ],
  },
];

// Last part of every trip home.
const BACK_TO_HOME = [
  { type: 'path', timetable: 'TWENTY_THIRD_TO_GROVE', ride: 17, from: '33rd St', to: 'Grove St' },
  { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk home' },
];

// Places to eat near each place — checked notes, not live data. `meals`
// says when it makes sense. Verify hours / bookings before you go.
// `price` is a rough per-person guess for one meal (food + a drink, before
// tip) — check the menu before you go.
const RESTAURANT_NOTES = {
  'times-square': [
    { name: 'Los Tacos No. 1', cuisine: 'Mexican · tacos', price: '$15–25', lat: 40.7572, lng: -73.9876, booking: 'Walk-in, order at the counter', minutes: 25,
      dishes: ['Adobada (al pastor) taco', 'Carne asada taco', 'Flour tortillas'], meals: ['lunch', 'dinner'] },
    { name: "Carmine's", cuisine: 'Italian · family-style', price: '$40–60', lat: 40.7577, lng: -73.9866, booking: 'Reservations recommended (OpenTable)', minutes: 75,
      dishes: ['Big family-style platters to share'], meals: ['lunch', 'dinner'] },
  ],
  '23rd-st': [
    { name: 'Eataly Flatiron', cuisine: 'Italian food hall', price: '$20–50', lat: 40.7421, lng: -73.9897, booking: 'Counters are walk-in; the sit-down restaurants take reservations (OpenTable)', minutes: 45,
      dishes: ['Fresh pasta', 'Neapolitan pizza', 'Gelato'], meals: ['breakfast', 'lunch', 'dinner'] },
    { name: 'Shake Shack (Madison Square Park)', cuisine: 'Burgers', price: '$15–25', lat: 40.7414, lng: -73.9882, booking: 'Walk-up kiosk in the park — expect a line at lunch', minutes: 25,
      dishes: ['ShackBurger', 'Crinkle-cut fries', 'Frozen custard'], meals: ['lunch', 'dinner'] },
  ],
  flushing: [
    { name: 'Nan Xiang Xiao Long Bao', cuisine: 'Shanghainese · soup dumplings', price: '$20–35', lat: 40.7571, lng: -73.8336, booking: 'Walk-in; expect a wait at peak times', minutes: 50,
      dishes: ['Pork soup dumplings', 'Pork & crab soup dumplings'], meals: ['lunch', 'dinner'] },
    { name: 'White Bear', cuisine: 'Wontons · takeout counter', price: '$10–15', lat: 40.7594, lng: -73.8317, booking: 'Walk-up window, takeout only', minutes: 15,
      dishes: ['No. 6: wontons with hot chili oil'], meals: ['breakfast', 'lunch', 'dinner'] },
    { name: 'Szechuan Mountain House', cuisine: 'Sichuan', price: '$30–50', lat: 40.7571, lng: -73.8336, booking: 'Walk-in; long waits at dinner', minutes: 70,
      dishes: ['Mapo tofu', 'Pork belly & cucumber in garlic sauce', 'Sour fish & cabbage soup'], meals: ['lunch', 'dinner'] },
    { name: 'Jiang Nan', cuisine: 'Chinese · Peking duck', price: '$35–60', lat: 40.7590, lng: -73.8345, booking: 'Reservations recommended (OpenTable)', minutes: 75,
      dishes: ['Peking duck with pancakes', 'Soup dumplings'], meals: ['lunch', 'dinner'] },
    { name: 'New World Mall Food Court', cuisine: 'Food court · many stalls', price: '$12–20', lat: 40.7583, lng: -73.8291, booking: 'Walk-in', minutes: 35,
      dishes: ['Lamb knife-cut noodles', 'Pan-fried pork buns'], meals: ['lunch', 'dinner'] },
    { name: 'Kong Sihk Tong', cuisine: 'Hong Kong café', price: '$15–25', lat: 40.7546, lng: -73.8287, booking: 'Walk-in', minutes: 40,
      dishes: ['Salted egg-yolk lava French toast', 'HK milk tea'], meals: ['breakfast', 'lunch', 'dinner'] },
  ],
  'bryant-park': [
    { name: 'Urbanspace Vanderbilt', cuisine: 'Food hall', price: '$15–25', lat: 40.7537, lng: -73.9787, booking: 'Walk-in', minutes: 30,
      dishes: ['Lots of stalls — something for everyone'], meals: ['breakfast', 'lunch', 'dinner'] },
    { name: 'Grand Central Oyster Bar', cuisine: 'Seafood', price: '$50–80', lat: 40.7524, lng: -73.9773, booking: 'Reservations recommended', minutes: 60,
      dishes: ['Oysters', 'Oyster pan roast'], meals: ['lunch', 'dinner'] },
  ],
  moma: [
    { name: 'The Modern', cuisine: 'Contemporary · fine dining', price: '$150+', lat: 40.7613, lng: -73.9772, booking: 'Reservations required', minutes: 120,
      dishes: ['Tasting menu'], meals: ['lunch', 'dinner'] },
    { name: 'The Halal Guys (53rd & 6th)', cuisine: 'Halal street food', price: '$12–18', lat: 40.7616, lng: -73.9790, booking: 'Walk-up cart', minutes: 15,
      dishes: ['Chicken & gyro over rice', 'White sauce'], meals: ['lunch', 'dinner'] },
  ],
  'the-met': [
    { name: 'Café Sabarsky', cuisine: 'Austrian café', price: '$35–60', lat: 40.7813, lng: -73.9603, booking: 'Dinner on Resy; breakfast & lunch first-come (expect a line). Closed Tuesdays', minutes: 60,
      dishes: ['Wiener schnitzel', 'Weisswurst with pretzel', 'Einspänner coffee'], meals: ['breakfast', 'lunch', 'dinner'] },
    { name: 'Sant Ambroeus', cuisine: 'Italian café', price: '$40–70', lat: 40.7747, lng: -73.9628, booking: 'Reservations recommended (OpenTable)', minutes: 60,
      dishes: ['Principessa cake', 'Pasta', 'Freddo cappuccino'], meals: ['breakfast', 'lunch', 'dinner'] },
    { name: 'Via Quadronno', cuisine: 'Italian · panini & pasta', price: '$25–40', lat: 40.7719, lng: -73.9660, booking: 'Walk-in', minutes: 45,
      dishes: ['Speck panini', 'Carbonara', 'Gelato'], meals: ['breakfast', 'lunch', 'dinner'] },
    { name: 'Pastrami Queen', cuisine: 'Jewish deli (kosher)', price: '$25–35', lat: 40.7739, lng: -73.9585, booking: 'Walk-in, counter service', minutes: 30,
      dishes: ['Pastrami on rye with deli mustard'], meals: ['lunch', 'dinner'] },
  ],
};

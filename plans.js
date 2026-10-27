// Keep a plan you like:
//   ⭐ Save      — stays in this browser; reopen it any time from the panel
//                  (trains are worked out again for the moment you reopen)
//   🖼 Image     — a picture of the timeline (good for your phone's photos)
//   📅 Calendar  — an .ics event from "leave home" to "home", steps in notes

const SAVED_PLANS_KEY = 'qrSavedPlans';
let savedPlans = loadSavedPlans();

function loadSavedPlans() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_PLANS_KEY)) || [];
  } catch (error) {
    return [];
  }
}

function storeSavedPlans() {
  try {
    localStorage.setItem(SAVED_PLANS_KEY, JSON.stringify(savedPlans));
  } catch (error) { /* private mode: keep for this visit only */ }
}

// The current plan as plain rows: { time: Date, icon, text, sub }.
function planRows(plan) {
  const d = plan.dest;
  const rows = [{ time: leaveBy(plan.going), icon: '🏠', text: 'Leave home' }];
  const legRows = (legs) => legs.forEach((l) => {
    if (l.type === 'walk') {
      rows.push({ time: l.depart, icon: '🚶', text: `${l.text} · ${l.minutes} min` });
    } else {
      const name = l.type === 'path' ? 'PATH' : `${l.route} train`;
      rows.push({ time: l.depart, icon: '🚇', text: `${name} ${l.from} → ${l.to}`, sub: `arrive ${formatClock(l.arrive)}${l.estimated ? ' (est.)' : ''}` });
    }
  });
  legRows(plan.going.legs);
  rows.push({ time: plan.visitStart, icon: d.icon, text: `${d.label} · about ${d.visit} min` });
  if (state.restaurant) {
    const r = state.restaurant;
    rows.push({ time: plan.toFood.depart, icon: '🚶', text: `Walk to ${r.name} · ${plan.toFood.minutes} min` });
    rows.push({ time: plan.mealStart, icon: '🍴', text: `${r.name} · about ${r.minutes} min`, sub: [r.price && `${r.price} per person`, r.booking].filter(Boolean).join(' · ') });
  }
  legRows(plan.home.legs);
  rows.push({ time: plan.home.arrive, icon: '🏠', text: 'Home' });
  return rows;
}

function planTitle(plan) {
  return `${plan.dest.label}${state.restaurant ? ` + ${state.restaurant.name}` : ''}`;
}

// ---------------------------------------------------------------------------
// ⭐ Save

function savePlan() {
  const plan = buildPlan();
  const entry = {
    id: Date.now().toString(36),
    savedAt: new Date().toISOString(),
    dest: state.dest,
    restaurant: state.restaurant,
    title: planTitle(plan),
    leave: leaveBy(plan.going).toISOString(),
    home: plan.home.arrive.toISOString(),
  };
  const same = savedPlans.findIndex((p) => p.dest === entry.dest && (p.restaurant?.name || '') === (entry.restaurant?.name || ''));
  if (same >= 0) savedPlans.splice(same, 1);
  savedPlans.unshift(entry);
  savedPlans = savedPlans.slice(0, 20);
  storeSavedPlans();
  showToast(`⭐ Saved “${entry.title}” — find it under Saved plans`);
  render();
}

function openSavedPlan(id) {
  const p = savedPlans.find((x) => x.id === id);
  if (!p || !destById(p.dest)) return;
  Object.assign(state, { dest: p.dest, step: 'done', eat: !!p.restaurant, restaurants: null, openRestaurant: null, restaurant: p.restaurant || null });
  render();
  readHome();
}

function deleteSavedPlan(id) {
  savedPlans = savedPlans.filter((x) => x.id !== id);
  storeSavedPlans();
  render();
}

function isPlanSaved() {
  return savedPlans.some((p) => p.dest === state.dest && (p.restaurant?.name || '') === (state.restaurant?.name || ''));
}

function savedPlansHtml() {
  if (!savedPlans.length) return '';
  const items = savedPlans.map((p) => {
    const d = destById(p.dest);
    if (!d) return '';
    return `<li><button type="button" class="sp-open" data-plan="${p.id}">${d.icon} ${escapeHtml(p.title)}<span>saved ${new Date(p.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></button>`
      + `<button type="button" class="sp-del" data-plan-del="${p.id}" aria-label="Delete saved plan">✕</button></li>`;
  }).join('');
  return `<div class="pl-kicker">SAVED PLANS</div><ul class="saved-plans">${items}</ul>`;
}

function bindSavedPlanButtons(root) {
  root.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => openSavedPlan(b.dataset.plan)));
  root.querySelectorAll('[data-plan-del]').forEach((b) => b.addEventListener('click', () => deleteSavedPlan(b.dataset.planDel)));
}

// ---------------------------------------------------------------------------
// 🖼 Image

async function downloadPlanImage() {
  const plan = buildPlan();
  const rows = planRows(plan);
  const W = 1080;
  const pad = 116;
  const rowH = 96;
  const H = 330 + rows.length * rowH + 120;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const fit = (text, maxW) => { // shorten with … to fit the width
    let t = text;
    while (t.length > 1 && g.measureText(t).width > maxW) t = t.slice(0, -1);
    return t === text ? t : `${t.trimEnd()}…`;
  };
  const font = (size, weight = 400) => `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", sans-serif`;

  g.fillStyle = '#151515';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 2;
  for (let k = 0; k < 4; k++) g.strokeRect(24 + k * 18, 24 + k * 18, W - 48 - k * 36, H - 48 - k * 36);

  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.font = font(28, 600);
  const day = plan.going.legs[0]?.depart || new Date();
  g.fillText(`${day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()} · LEAVE BY ${formatClock(leaveBy(plan.going))}`, pad, 150);
  g.fillStyle = '#fff';
  g.font = font(54, 700);
  g.fillText(fit(`${plan.dest.icon} ${planTitle(plan)}`, W - 2 * pad - 40), pad, 236);

  let y = 330;
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.beginPath();
  g.moveTo(pad + 166, y - 20);
  g.lineTo(pad + 166, y + (rows.length - 1) * rowH);
  g.stroke();
  for (const r of rows) {
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = font(32, 500);
    g.fillText(formatClock(r.time), pad, y + 12);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(pad + 166, y, 8, 0, Math.PI * 2);
    g.fill();
    g.font = font(32, r.icon === '🚶' ? 400 : 600);
    g.fillText(fit(`${r.icon}  ${r.text}`, W - pad - (pad + 196) - 10), pad + 196, y + 12);
    if (r.sub) {
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.font = font(26);
      g.fillText(fit(r.sub, W - pad - (pad + 236) - 20), pad + 236, y + 50);
    }
    y += rowH;
  }
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.font = font(22);
  g.fillText(fit('QR Routes · subway: MTA schedule · PATH: PATH app timetable · walks are estimates', W - 2 * pad), pad, H - 90);

  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  await saveFile(blob, `plan-${fileSafe(planTitle(plan))}.png`, 'image/png');
}

// ---------------------------------------------------------------------------
// 📅 Calendar (.ics)

function downloadPlanCalendar() {
  const plan = buildPlan();
  const rows = planRows(plan);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const notes = rows.map((r) => `${formatClock(r.time)}  ${r.text}${r.sub ? ` (${r.sub})` : ''}`).join('\n');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QR Routes//EN',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@qr-routes`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(leaveBy(plan.going))}`,
    `DTEND:${stamp(plan.home.arrive)}`,
    `SUMMARY:${esc(`${plan.dest.icon} ${planTitle(plan)}`)}`,
    `LOCATION:${esc(state.restaurant ? state.restaurant.name : plan.dest.label)}`,
    `DESCRIPTION:${esc(`${notes}\n\nTrain times from the schedule — check before you leave.`)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(`Leave for ${plan.dest.label}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(foldIcsLine).join('\r\n');
  saveFile(new Blob([ics], { type: 'text/calendar' }), `plan-${fileSafe(planTitle(plan))}.ics`, 'text/calendar');
}

// ---------------------------------------------------------------------------

// Calendar files want lines of at most 75 bytes; longer ones continue on
// the next line after a space.
function foldIcsLine(line) {
  const bytes = new TextEncoder();
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (bytes.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function fileSafe(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan';
}

// Phones: the share sheet (Save Image / add to Calendar). Computers: a download.
async function saveFile(blob, name, type) {
  const file = new File([blob], name, { type });
  const phone = matchMedia('(pointer: coarse)').matches;
  if (phone && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast(`⬇️ Downloaded ${name}`);
}

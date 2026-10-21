/**
 * Fleet Logbook — Google Apps Script backend.
 *
 * Paste this whole file into Extensions → Apps Script of your Google Sheet,
 * run setup() once, then deploy as a Web app (see README.md).
 *
 * Sheets it uses (setup() creates them):
 *   Machines   – one row per machine
 *   Intervals  – service intervals per machine
 *   Lists      – Operators (column A) and Sites (column B)
 *   Logs       – one row per driver submission
 *   Services   – one row per service done
 *   Parts      – parts / consumables stock
 *
 * Script properties (Project Settings → Script properties):
 *   PIN        – 4-digit code drivers type on the form
 *   ADMIN_KEY  – long key for the dashboard (keep private)
 */

const HEADERS = {
  Machines:  ['id', 'name', 'type', 'meter', 'baseline'],
  Intervals: ['machine_id', 'service', 'every', 'last_done_at', 'last_done_date'],
  Lists:     ['Operators', 'Sites'],
  Logs:      ['timestamp', 'date', 'machine_id', 'machine', 'operator', 'site', 'reading', 'fuel_pct', 'fuel_added_l', 'defect', 'defect_note', 'photo'],
  Services:  ['timestamp', 'date', 'machine_id', 'machine', 'reading', 'services', 'parts', 'notes'],
  Parts:     ['id', 'name', 'part_no', 'used_on', 'qty', 'reorder_at', 'unit']
};

const PHOTO_FOLDER = 'Fleet Logbook photos';

/* ------------------------------------------------------------------ */
/* One-time setup                                                      */
/* ------------------------------------------------------------------ */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(HEADERS[name]);
      sh.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  // Keep date columns as plain text so they don't shift with time zones
  ss.getSheetByName('Logs').getRange('B:B').setNumberFormat('@');
  ss.getSheetByName('Services').getRange('B:B').setNumberFormat('@');
  ss.getSheetByName('Intervals').getRange('E:E').setNumberFormat('@');

  const machines = ss.getSheetByName('Machines');
  if (machines.getLastRow() === 1) {
    machines.getRange(2, 1, 3, 5).setValues([
      ['cat-426f',    'CAT 426F',    'TLB',        'h',  ''],
      ['bobcat-s530', 'Bobcat S530', 'Skid steer', 'h',  ''],
      ['tata-2628',   'Tata 2628',   'Truck',      'km', '']
    ]);
  }
  const intervals = ss.getSheetByName('Intervals');
  if (intervals.getLastRow() === 1) {
    // PLACEHOLDER intervals — confirm against each machine's service manual
    intervals.getRange(2, 1, 5, 5).setValues([
      ['cat-426f',    '250 h service', 250,   '', ''],
      ['cat-426f',    '500 h service', 500,   '', ''],
      ['bobcat-s530', '250 h service', 250,   '', ''],
      ['bobcat-s530', '500 h service', 500,   '', ''],
      ['tata-2628',   'Service',       10000, '', '']
    ]);
  }

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PIN')) props.setProperty('PIN', String(Math.floor(1000 + Math.random() * 9000)));
  if (!props.getProperty('ADMIN_KEY')) props.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('Driver PIN: ' + props.getProperty('PIN'));
  Logger.log('Dashboard ADMIN_KEY: ' + props.getProperty('ADMIN_KEY'));
}

/* ------------------------------------------------------------------ */
/* Web app entry points                                                */
/* ------------------------------------------------------------------ */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'config') return json(publicConfig());
    if (p.action === 'data') {
      requireAdmin(p.key);
      return json(allData());
    }
    return json({ ok: true, app: 'Fleet Logbook' });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'Bad request.' }); }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    if (body.action === 'log') return json(saveLog(body));
    if (body.action === 'service') { requireAdmin(body.key); return json(saveService(body)); }
    if (body.action === 'part') { requireAdmin(body.key); return json(savePart(body)); }
    return json({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function publicConfig() {
  const machines = rows('Machines').filter(m => m.id);
  const logs = rows('Logs');
  const lists = listColumns();
  return {
    ok: true,
    machines: machines.map(m => {
      const last = lastLog(logs, m.id);
      return {
        id: m.id, name: m.name, type: m.type, meter: m.meter === 'km' ? 'km' : 'h',
        last: last ? { reading: num(last.reading), date: last.date, operator: last.operator }
                   : (m.baseline !== '' ? { reading: num(m.baseline), date: null, operator: null } : null)
      };
    }),
    operators: lists.operators,
    sites: lists.sites
  };
}

function allData() {
  return {
    ok: true,
    machines: rows('Machines').filter(m => m.id).map(m => ({ ...m, meter: m.meter === 'km' ? 'km' : 'h', baseline: m.baseline === '' ? null : num(m.baseline) })),
    intervals: rows('Intervals').filter(i => i.machine_id).map(i => ({
      ...i, every: num(i.every), last_done_at: i.last_done_at === '' ? null : num(i.last_done_at)
    })),
    logs: rows('Logs').filter(l => l.machine_id).map(l => ({
      ...l, reading: num(l.reading), fuel_pct: num(l.fuel_pct), fuel_added_l: num(l.fuel_added_l) || 0,
      defect: String(l.defect).toLowerCase() === 'yes'
    })),
    services: rows('Services').filter(s => s.machine_id).map(s => ({ ...s, reading: num(s.reading) })),
    parts: rows('Parts').filter(p => p.id).map(p => ({ ...p, qty: num(p.qty) || 0, reorder_at: num(p.reorder_at) || 0 })),
    lists: listColumns(),
    tz: Session.getScriptTimeZone()
  };
}

function saveLog(b) {
  const pin = PropertiesService.getScriptProperties().getProperty('PIN');
  if (String(b.pin || '') !== String(pin)) throw new Error('Wrong PIN. Ask your supervisor for the current PIN.');

  const machine = rows('Machines').find(m => m.id === b.machine_id);
  if (!machine) throw new Error('Unknown machine.');
  const lists = listColumns();
  if (!b.operator || lists.operators.indexOf(b.operator) === -1) throw new Error('Choose an operator from the list.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) throw new Error('Enter the date.');
  const reading = Number(b.reading);
  if (!isFinite(reading) || reading < 0) throw new Error('Enter the meter reading.');
  const fuel = Number(b.fuel_pct);
  if ([0, 25, 50, 75, 100].indexOf(fuel) === -1) throw new Error('Choose the fuel level.');

  const last = lastLog(rows('Logs'), machine.id);
  if (last && reading < num(last.reading)) {
    throw new Error('Reading is lower than the last one logged (' + last.reading + '). Check the meter.');
  }

  // Duplicate guard: same machine, date and reading already logged (e.g. a resend)
  if (b.client_id) {
    const dup = rows('Logs').some(l => l.machine_id === machine.id && l.date === b.date && num(l.reading) === reading);
    if (dup) return { ok: true, duplicate: true };
  }

  let photoUrl = '';
  if (b.photo && /^data:image\/(jpeg|png|webp);base64,/.test(b.photo)) {
    try { photoUrl = savePhoto(b.photo, machine.name + ' ' + b.date + ' ' + reading); } catch (err) { photoUrl = ''; }
  }

  sheet('Logs').appendRow([
    new Date(), String(b.date), machine.id, machine.name, b.operator, String(b.site || ''),
    reading, fuel, Number(b.fuel_added) || 0, b.defect ? 'Yes' : 'No', String(b.defect_note || '').slice(0, 1000), photoUrl
  ]);
  return { ok: true };
}

function saveService(b) {
  const machine = rows('Machines').find(m => m.id === b.machine_id);
  if (!machine) throw new Error('Unknown machine.');
  const reading = Number(b.reading);
  if (!isFinite(reading)) throw new Error('Enter the reading at service.');
  const done = Array.isArray(b.services) ? b.services : [];

  // Reset the countdown for each service ticked
  const sh = sheet('Intervals');
  const values = sh.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (values[r][0] === machine.id && done.indexOf(values[r][1]) !== -1) {
      sh.getRange(r + 1, 4, 1, 2).setValues([[reading, String(b.date)]]);
    }
  }

  // Take parts off stock
  const used = Array.isArray(b.parts) ? b.parts : [];
  const ps = sheet('Parts');
  const pv = ps.getDataRange().getValues();
  const partNames = [];
  used.forEach(u => {
    for (let r = 1; r < pv.length; r++) {
      if (String(pv[r][0]) === String(u.id)) {
        const qty = Math.max(0, (Number(pv[r][4]) || 0) - (Number(u.qty) || 0));
        ps.getRange(r + 1, 5).setValue(qty);
        pv[r][4] = qty;
        partNames.push((Number(u.qty) || 0) + '× ' + pv[r][1]);
      }
    }
  });

  sheet('Services').appendRow([new Date(), String(b.date), machine.id, machine.name, reading,
    done.join(', '), partNames.join(', '), String(b.notes || '').slice(0, 2000)]);
  return { ok: true };
}

function savePart(b) {
  const name = String(b.name || '').trim();
  if (!name) throw new Error('Enter the part name.');
  const sh = sheet('Parts');
  const values = sh.getDataRange().getValues();
  const id = b.id || (name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36));
  const row = [id, name, String(b.part_no || ''), String(b.used_on || 'All'), Number(b.qty) || 0, Number(b.reorder_at) || 0, String(b.unit || '')];
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(id)) {
      if (b.remove) { sh.deleteRow(r + 1); return { ok: true, removed: true }; }
      sh.getRange(r + 1, 1, 1, row.length).setValues([row]);
      return { ok: true, id: id };
    }
  }
  sh.appendRow(row);
  return { ok: true, id: id };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function requireAdmin(key) {
  const k = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!k || String(key || '') !== k) throw new Error('Wrong dashboard key.');
}

function sheet(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" is missing. Run setup() in Apps Script.');
  return sh;
}

function rows(name) {
  const values = sheet(name).getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0].map(h => String(h).trim());
  const tz = Session.getScriptTimeZone();
  return values.slice(1).map(r => {
    const o = {};
    head.forEach((h, i) => {
      let v = r[i];
      if (v instanceof Date) v = (h === 'timestamp') ? v.toISOString() : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      o[h] = v;
    });
    return o;
  });
}

function listColumns() {
  const values = sheet('Lists').getDataRange().getValues().slice(1);
  const col = i => values.map(r => String(r[i] || '').trim()).filter(Boolean);
  return { operators: col(0), sites: col(1) };
}

function lastLog(logs, id) {
  let best = null;
  logs.forEach(l => { if (l.machine_id === id && (!best || num(l.reading) >= num(best.reading))) best = l; });
  return best;
}

function savePhoto(dataUrl, name) {
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.*)$/);
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name + '.jpg');
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
  return folder.createFile(blob).getUrl();
}

function num(v) { if (v === '' || v == null) return null; const n = Number(v); return isFinite(n) ? n : null; }

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Daily report — email (and optional WhatsApp) at the end of the day  */
/*                                                                     */
/* Run installDailyReport() once to schedule it. Run testReport() to   */
/* send one now. Optional script properties:                           */
/*   NOTIFY_EMAIL      – where to send (default: your Google account)  */
/*   REPORT_HOUR       – hour of day to send, 0-23 (default 18)        */
/*   SKIP_DAYS         – days with no report, e.g. "Sun" or "Sat,Sun"  */
/*   CALLMEBOT_PHONE   – your WhatsApp number, e.g. +27821234567       */
/*   CALLMEBOT_APIKEY  – key from CallMeBot (see README)               */
/*   DASHBOARD_URL     – link added to the message                     */
/* ------------------------------------------------------------------ */

function installDailyReport() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyReport')
    .forEach(t => ScriptApp.deleteTrigger(t));
  const hour = Number(PropertiesService.getScriptProperties().getProperty('REPORT_HOUR') || 18);
  ScriptApp.newTrigger('dailyReport').timeBased().everyDays(1).atHour(hour).create();
  Logger.log('Daily report scheduled for about ' + hour + ':00 (' + Session.getScriptTimeZone() + ').');
}

function testReport() { dailyReport(true); }

function dailyReport(force) {
  const props = PropertiesService.getScriptProperties();
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const weekday = Utilities.formatDate(now, tz, 'EEE');
  const skip = String(props.getProperty('SKIP_DAYS') || 'Sun').split(',').map(s => s.trim());
  if (force !== true && skip.indexOf(weekday) !== -1) return;

  const r = buildReport(today);
  const dash = props.getProperty('DASHBOARD_URL') || 'https://jjkoch-ops.github.io/fleet-logbook/dashboard.html';
  const title = 'Fleet report ' + Utilities.formatDate(now, tz, 'EEE d MMM') + ' — ' +
    (r.missing.length ? r.missing.length + ' not logged' : 'all logged') +
    (r.problems.length ? ', ' + r.problems.length + ' issue' + (r.problems.length > 1 ? 's' : '') : '');

  const lines = [];
  lines.push(r.missing.length ? 'NOT LOGGED TODAY: ' + r.missing.join(', ') : 'All machines logged today.');
  if (r.logged.length) { lines.push(''); lines.push('Logged today:'); r.logged.forEach(x => lines.push('• ' + x)); }
  if (r.problems.length) { lines.push(''); lines.push('Needs attention:'); r.problems.forEach(x => lines.push('• ' + x)); }
  lines.push(''); lines.push('Dashboard: ' + dash);
  const text = lines.join('\n');

  const to = props.getProperty('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail();
  if (to) {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const list = arr => '<ul style="margin:6px 0 14px;padding-left:18px">' + arr.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
    const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#15191e;max-width:560px">' +
      '<div style="border-top:3px solid #d18a00;padding-top:10px;font-size:18px;font-weight:bold">Fleet report — ' + esc(Utilities.formatDate(now, tz, 'EEEE d MMMM')) + '</div>' +
      (r.missing.length ? '<p style="background:#fbe4e2;color:#b4342b;padding:10px 12px;border-radius:6px"><b>Not logged today:</b> ' + esc(r.missing.join(', ')) + '</p>'
                        : '<p style="background:#e3f3ea;color:#1f7a48;padding:10px 12px;border-radius:6px"><b>All machines logged today.</b></p>') +
      (r.logged.length ? '<b>Logged today</b>' + list(r.logged) : '') +
      (r.problems.length ? '<b>Needs attention</b>' + list(r.problems) : '') +
      '<p><a href="' + esc(dash) + '">Open the dashboard</a></p></div>';
    MailApp.sendEmail({ to: to, subject: title, body: text, htmlBody: html });
  }

  const phone = props.getProperty('CALLMEBOT_PHONE'), key = props.getProperty('CALLMEBOT_APIKEY');
  if (phone && key) {
    const msg = '*' + title + '*\n\n' + text;
    UrlFetchApp.fetch('https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(phone) +
      '&text=' + encodeURIComponent(msg.slice(0, 1500)) + '&apikey=' + encodeURIComponent(key), { muteHttpExceptions: true });
  }
}

function buildReport(today) {
  const machines = rows('Machines').filter(m => m.id);
  const logs = rows('Logs').filter(l => l.machine_id);
  const intervals = rows('Intervals').filter(i => i.machine_id);
  const parts = rows('Parts').filter(p => p.id);
  const dayNum = s => { const p = String(s).split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 864e5); };
  const missing = [], logged = [], problems = [];

  machines.forEach(m => {
    const u = m.meter === 'km' ? 'km' : 'h';
    const L = logs.filter(l => l.machine_id === m.id).sort((a, b) => num(a.reading) - num(b.reading));
    const todays = L.filter(l => l.date === today);
    const cur = L.length ? num(L[L.length - 1].reading) : num(m.baseline);
    if (!todays.length) missing.push(m.name);
    else {
      const end = Math.max.apply(null, todays.map(l => num(l.reading)));
      const before = L.filter(l => l.date < today);
      const start = before.length ? Math.max.apply(null, before.map(l => num(l.reading))) : null;
      const fuel = todays.reduce((s, l) => s + (num(l.fuel_added_l) || 0), 0);
      logged.push(m.name + ': ' + end + ' ' + u + (start != null ? ' (' + Math.round((end - start) * 10) / 10 + ' ' + u + ' today)' : '') +
        ' by ' + Array.from(new Set(todays.map(l => l.operator))).join(', ') + (fuel ? ', ' + fuel + ' L diesel' : ''));
      todays.filter(l => String(l.defect).toLowerCase() === 'yes')
        .forEach(l => problems.push('DEFECT ' + m.name + ': ' + (l.defect_note || 'no description') + ' (' + l.operator + ')'));
    }
    // average use per day over the last 30 days, for "due soon"
    const recent = L.filter(l => dayNum(today) - dayNum(l.date) <= 30);
    let avg = 0;
    if (recent.length >= 2) {
      const span = Math.max(1, dayNum(recent[recent.length - 1].date) - dayNum(recent[0].date));
      avg = (num(recent[recent.length - 1].reading) - num(recent[0].reading)) / span;
    }
    intervals.filter(i => i.machine_id === m.id && i.last_done_at !== '' && num(i.every)).forEach(i => {
      if (cur == null) return;
      const remaining = num(i.last_done_at) + num(i.every) - cur;
      if (remaining < 0) problems.push('OVERDUE ' + m.name + ': ' + i.service + ' by ' + Math.round(-remaining) + ' ' + u);
      else if (remaining <= Math.max(num(i.every) * 0.1, avg * 7)) problems.push('DUE SOON ' + m.name + ': ' + i.service + ' in ' + Math.round(remaining) + ' ' + u);
    });
  });
  parts.forEach(p => {
    if ((num(p.qty) || 0) <= (num(p.reorder_at) || 0)) problems.push('REORDER ' + p.name + ': ' + (num(p.qty) || 0) + ' ' + (p.unit || '') + ' left');
  });
  return { missing, logged, problems };
}

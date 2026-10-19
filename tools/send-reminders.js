#!/usr/bin/env node
/* BookPilot AI — day-before reminder emails via the owner's own Gmail account.
 *
 * Free channel: uses YOUR Gmail (OAuth2, gmail.send scope) — no paid email
 * service, no stored password. Credentials live in tools/gmail-config.json,
 * which is gitignored and never committed. See tools/README.md for setup.
 *
 * Usage:
 *   node tools/send-reminders.js --store <bookpilot-backup.json> [--date YYYY-MM-DD] [--dry-run] [--apply]
 *
 *   --store   A backup exported from BookPilot (Sync & transfer tab).
 *   --date    Pretend "today" is this date (default: real today).
 *   --dry-run List what would be sent without sending.
 *   --apply   Write <store>.sent.json with reminded=true for sent bookings,
 *             so you can import it back into BookPilot (Sync & transfer tab).
 *
 * First run (no refresh token yet): the script starts a tiny localhost
 * server, prints a Google consent URL, and you authorize in the browser.
 * Google redirects back to localhost with a code; the script exchanges it
 * for a refresh token and saves it to gmail-config.json (mode 0600).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const readline = require('readline');

const TOOLS_DIR = __dirname;
const CONFIG_PATH = path.join(TOOLS_DIR, 'gmail-config.json');
const LOGIC = require(path.join(TOOLS_DIR, '..', 'js', 'logic.js'));

function fail(msg) { console.error('error: ' + msg); process.exit(1); }

function parseArgs() {
  const a = { store: null, date: null, dryRun: false, apply: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--store') a.store = argv[++i];
    else if (argv[i] === '--date') a.date = argv[++i];
    else if (argv[i] === '--dry-run') a.dryRun = true;
    else if (argv[i] === '--apply') a.apply = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log([
        'BookPilot AI — day-before reminder emails via your own Gmail (OAuth2).',
        '',
        'Usage:',
        '  node tools/send-reminders.js --store <bookpilot-backup.json> [--date YYYY-MM-DD] [--dry-run] [--apply]',
        '',
        '  --store   Backup exported from BookPilot (Sync & transfer tab). Required.',
        '  --date    Pretend today is this date (default: real today).',
        '  --dry-run List what would be sent without sending.',
        '  --apply   Write <store>.sent.json with reminded=true for sent bookings,',
        '            ready to import back into BookPilot.',
        '',
        'Setup: copy tools/gmail-config.example.json to tools/gmail-config.json,',
        'fill in your Google OAuth client id/secret, and see tools/README.md.'
      ].join('\n'));
      process.exit(0);
    }
  }
  return a;
}

function loadConfig() {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch (e) {
    fail('no config found. Copy tools/gmail-config.example.json to tools/gmail-config.json and fill in your Google OAuth client id/secret.\nSee tools/README.md for the 5-minute setup.');
  }
  if (!cfg.client_id || !cfg.client_secret || /PASTE/.test(cfg.client_id)) {
    fail('gmail-config.json needs your real client_id and client_secret (see tools/README.md).');
  }
  return cfg;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function postForm(url, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(j.error_description || j.error || ('HTTP ' + res.statusCode)));
          else resolve(j);
        } catch (e) { reject(new Error('bad token response: ' + data.slice(0, 120))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function authorize(cfg) {
  // Loopback OAuth flow for installed apps (Google's current recommendation).
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>BookPilot</h1><p>' + (code ? 'Authorized — you can close this tab and go back to the terminal.' : 'Authorization failed: ' + (err || 'unknown')) + '</p>');
      server.close();
      if (code) finish(code); else reject(new Error(err || 'no code returned'));
    });
    server.listen(0, '127.0.0.1', () => {
      const redirect = 'http://127.0.0.1:' + server.address().port + '/callback';
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: cfg.client_id, redirect_uri: redirect, response_type: 'code',
        scope: 'https://www.googleapis.com/auth/gmail.send',
        access_type: 'offline', prompt: 'consent'
      }).toString();
      console.log('\nOpen this URL in your browser and authorize BookPilot:\n\n' + authUrl + '\n');
      const finish = (code) => {
        postForm('https://oauth2.googleapis.com/token', {
          code, client_id: cfg.client_id, client_secret: cfg.client_secret,
          redirect_uri: redirect, grant_type: 'authorization_code'
        }).then((tok) => {
          if (!tok.refresh_token) { reject(new Error('Google did not return a refresh token. Try again (prompt=consent is set, so it should).')); return; }
          cfg.refresh_token = tok.refresh_token;
          saveConfig(cfg);
          console.log('authorized — refresh token saved to tools/gmail-config.json (gitignored).\n');
          resolve();
        }).catch(reject);
      };
      // Manual-paste fallback if the browser can't reach localhost.
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('If the browser did not redirect automatically, paste the "code" value here (or just press Enter to wait): ', (answer) => {
        rl.close();
        if (answer && answer.trim()) { server.close(); finish(answer.trim()); }
      });
    });
  });
}

function getAccessToken(cfg) {
  return postForm('https://oauth2.googleapis.com/token', {
    refresh_token: cfg.refresh_token, client_id: cfg.client_id,
    client_secret: cfg.client_secret, grant_type: 'refresh_token'
  }).then((tok) => {
    if (!tok.access_token) throw new Error('no access token returned');
    return tok.access_token;
  });
}

function b64url(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sendGmail(accessToken, from, to, subject, body) {
  return new Promise((resolve, reject) => {
    const raw = b64url(
      'From: ' + from + '\r\n' +
      'To: ' + to + '\r\n' +
      'Subject: ' + subject + '\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n\r\n' + body
    );
    const payload = JSON.stringify({ raw });
    const req = https.request({
      hostname: 'gmail.googleapis.com', path: '/gmail/v1/users/me/messages/send',
      method: 'POST', headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error('Gmail API HTTP ' + res.statusCode + ': ' + data.slice(0, 200)));
        else resolve(JSON.parse(data).id);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const args = parseArgs();
  if (!args.store) fail('pass --store <bookpilot-backup.json> (export it from the Sync & transfer tab).');
  const cfg = loadConfig();
  if (!cfg.refresh_token) await authorize(cfg);

  let raw;
  try { raw = fs.readFileSync(args.store, 'utf8'); }
  catch (e) { fail('cannot read store file: ' + args.store); }
  const imp = LOGIC.importStore(raw);
  if (!imp.ok) fail('store file invalid: ' + imp.error);
  const state = imp.state;

  const refDate = args.date || LOGIC.todayStr();
  const due = LOGIC.dayBeforeList(state, refDate).filter((b) => b.email);
  const skippedNoEmail = LOGIC.dayBeforeList(state, refDate).length - due.length;

  console.log('BookPilot reminder run — ref date ' + refDate);
  console.log('due tomorrow with email: ' + due.length + ' | due but no email on file: ' + skippedNoEmail);

  if (!due.length) { console.log('nothing to send.'); return; }
  if (args.dryRun) {
    due.forEach((b) => {
      const m = b.staffId ? LOGIC.getStaffMember(state, b.staffId) : null;
      console.log('  WOULD SEND to ' + b.email + ': ' + b.serviceName + (m ? ' with ' + m.name : '') +
        ' on ' + LOGIC.fmtDate(b.date) + ' at ' + LOGIC.fmtTime(b.start) + ' (' + b.name + ')');
    });
    return;
  }

  const accessToken = await getAccessToken(cfg);
  const from = cfg.sender || 'me';
  let sent = 0;
  const sentIds = [];
  for (const b of due) {
    const m = b.staffId ? LOGIC.getStaffMember(state, b.staffId) : null;
    const subject = 'Reminder: ' + b.serviceName + ' tomorrow at ' + LOGIC.fmtTime(b.start);
    const body = LOGIC.reminderMessage(state.bizName || 'us', b, m ? m.name : '');
    try {
      const id = await sendGmail(accessToken, from, b.email, subject, body);
      sent++;
      sentIds.push(b.id);
      console.log('  sent to ' + b.email + ' (' + b.name + ', ref ' + (b.ref || LOGIC.bookingRef(b.id)) + ') gmail-id ' + id);
    } catch (e) {
      console.error('  FAILED ' + b.email + ': ' + e.message);
    }
  }
  console.log('\nsent ' + sent + '/' + due.length);

  if (args.apply && sentIds.length) {
    const out = args.store.replace(/\.json$/i, '') + '.sent.json';
    state.bookings.forEach((b) => { if (sentIds.indexOf(b.id) !== -1) b.reminded = true; });
    fs.writeFileSync(out, LOGIC.exportStore(state));
    console.log('wrote ' + out + ' — import it in BookPilot (Sync & transfer tab) to mark these reminded.');
  } else if (sentIds.length) {
    console.log('tip: re-run with --apply to generate a .sent.json you can import back into BookPilot.');
  }
}

main().catch((e) => fail(e.message));

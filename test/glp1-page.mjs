// Headless check of /glp1 at 390 then 1280, on the page's production path (served as atoz.test, mapped to loopback
// inside Chrome), with every request paused through CDP Fetch: the site's files go to the local server, the spine's
// public endpoints are answered by a stub here (never the live doors), anything else is refused and fails the run.
// Every request (URL and body) is logged, to prove the weight and the track pick never leave the page.
// Run: node test/glp1-page.mjs                 (needs ~/.local/bin/chrome-headless-shell; muted; no network)
//      SHOTS=/some/dir node test/glp1-page.mjs  also saves screenshots and network-log.json there.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const C = createRequire(import.meta.url)(path.join(ROOT, 'glp1/config.js'))
const WEB = 5562
const HOST = 'atoz.test'
const ORIGIN = `http://${HOST}:${WEB}`
const SPINE = 'https://clients.cannoncodeconnect.com'
const CHROME = process.env.CHROME || path.join(os.homedir(), '.local/bin/chrome-headless-shell')
const SHOTS = process.env.SHOTS || ''
const WEIGHT = '187'

const NETLIFY = (() => {
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8')
  const out = {}
  for (const line of toml.slice(toml.indexOf('[headers.values]')).split('\n').slice(1)) {
    const m = /^\s*([A-Za-z-]+)\s*=\s*"(.*)"\s*$/.exec(line)
    if (m) out[m[1]] = m[2]
    else if (/^\s*\[/.test(line)) break
  }
  return out
})()

// ---- stub spine ----
const clicks = []
const log = []       // every request the page made: { method, url, body }
const external = []  // anything not the site or the stubbed spine
const PAGE = { ok: true, profile: { name: 'A to Z Nutrition' }, words: {}, questions: [], services: [] }
function spine(pathname, body) {
  if (pathname === '/api/social-lead/page') return [200, PAGE]
  if (pathname === '/api/social-lead/click') { clicks.push(body); return ['booking', 'guide'].includes(body.link) ? [201, { ok: true }] : [400, { ok: false, error: 'invalid' }] }
  return [404, { ok: false }]
}
async function paused({ requestId, request }) {
  const u = new URL(request.url)
  const raw = request.postData ?? (request.postDataEntries || []).map((e) => Buffer.from(e.bytes || '', 'base64').toString()).join('')
  log.push({ method: request.method, url: request.url, body: raw || '' })
  if (u.protocol === 'http:' && u.host === `${HOST}:${WEB}`) return cdp('Fetch.continueRequest', { requestId })
  if (u.origin === SPINE && u.pathname.startsWith('/api/social-lead/')) {
    const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', vary: 'origin' }
    const fulfill = (code, headers, text) => cdp('Fetch.fulfillRequest', { requestId, responseCode: code,
      responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })), body: Buffer.from(text).toString('base64') })
    if (request.method === 'OPTIONS') return fulfill(204, cors, '')
    const r = spine(u.pathname, JSON.parse(raw || '{}'))
    return fulfill(r[0], { ...cors, 'content-type': 'application/json' }, JSON.stringify(r[1]))
  }
  external.push(request.method + ' ' + request.url)
  return cdp('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
}

// ---- static site with Netlify's headers; /glp1 serves glp1/index.html as Netlify does; byte ranges for video ----
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.vtt': 'text/vtt' }
const web = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, ORIGIN).pathname)
  if (p.endsWith('/')) p += 'index.html'
  let file = path.join(ROOT, p)
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404, NETLIFY); return res.end() }
  const size = fs.statSync(file).size
  const head = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=0, must-revalidate', ...NETLIFY }
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
  if (m) {
    const a = +m[1], b = m[2] ? Math.min(+m[2], size - 1) : size - 1
    res.writeHead(206, { ...head, 'content-range': `bytes ${a}-${b}/${size}`, 'content-length': b - a + 1 })
    return fs.createReadStream(file, { start: a, end: b }).pipe(res)
  }
  res.writeHead(200, { ...head, 'content-length': size })
  fs.createReadStream(file).pipe(res)
})

// ---- tiny CDP client ----
let ws, seq = 0
const waiting = new Map()
function cdp(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((ok, bad) => {
    waiting.set(id, { ok, bad, method })
    setTimeout(() => { if (waiting.delete(id)) bad(new Error(method + ' timed out')) }, 15000)
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
async function until(expr, what, ms = 5000) {
  const t = Date.now()
  while (Date.now() - t < ms) { if (await js(`return !!(${expr})`)) return; await sleep(50) }
  throw new Error('timed out waiting for ' + what)
}
async function size(w, h) { await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }) }
async function shot(name) {
  if (!SHOTS) return
  const h = await js('return document.documentElement.scrollHeight')
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await js('return innerWidth'), height: h, scale: 1 } })
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'))
}

let failed = 0
function check(ok, what, detail = '') { console.log((ok ? 'PASS ' : 'FAIL ') + what + (ok || !detail ? '' : '  (' + detail + ')')); if (!ok) failed++ }

const LAYOUT = `
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' }
  const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10, Math.round(r.left)] }
  const out = { scroll: document.documentElement.scrollWidth - innerWidth, minFont: 99, smallTaps: [], centres: [] }
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.classList.contains('sr')) continue
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) out.minFont = Math.min(out.minFont, parseFloat(getComputedStyle(el).fontSize))
  }
  for (const el of document.querySelectorAll('button, a[href], input, video')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    if (r.height < 44 || r.width < 44) out.smallTaps.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
  }
  for (const sel of ['.pubtop', '.g1-head', '#tracks', '#day', '#lessons', '.g1-calc', '.g1-next', '.pubfoot']) {
    const el = document.querySelector(sel); if (!el || !vis(el)) continue
    const r = el.getBoundingClientRect(); out.centres.push([sel, Math.round((r.left + r.right) / 2 * 10) / 10])
  }
  out.tracks = [...document.querySelectorAll('#tracks .g1-track')].map(box)
  out.lessons = [...document.querySelectorAll('#lessons .g1-lesson')].map(box)
  out.next = [...document.querySelectorAll('.g1-next .btn')].map(box)
  out.units = [...document.querySelectorAll('.g1-unit')].map(box)
  return out`
const equal = (list) => list.length > 1 && Math.max(...list.map((b) => b[0])) - Math.min(...list.map((b) => b[0])) <= 1 && Math.max(...list.map((b) => b[1])) - Math.min(...list.map((b) => b[1])) <= 1

async function open() {
  await cdp('Page.navigate', { url: ORIGIN + '/glp1' }); await sleep(200)
  await until('document.readyState === "complete" && document.querySelectorAll("#tracks .g1-track").length === 5', 'glp1 page')
}

async function pass(w, h) {
  const where = `${w}px`
  await size(w, h)
  await open()
  const fixed = await js(`const el = document.getElementById('fixed-line'); const r = el.getBoundingClientRect(); return { text: el.innerText.trim(), vis: r.width > 0 && r.height > 0 }`)
  check(fixed.vis && fixed.text === C.fixedLine, `${where}: the fixed line is visible word for word`, JSON.stringify(fixed))
  const picker = await js(`return { q: document.getElementById('pick-title').textContent, labels: [...document.querySelectorAll('#tracks .g1-track')].map((b) => b.textContent) }`)
  check(picker.q === 'Which week sounds like yours?' && JSON.stringify(picker.labels) === JSON.stringify(C.tracks.map((t) => t.label)), `${where}: the picker shows her five tracks`, JSON.stringify(picker))

  // Videos: three, playsinline, poster, a default captions track showing, no autoplay; each plays (muted).
  const vids = await js(`return [...document.querySelectorAll('#lessons video')].map((v) => ({ inline: v.hasAttribute('playsinline'), poster: !!v.getAttribute('poster'), auto: v.autoplay, track: !!v.querySelector('track[kind=captions][default][src$=".vtt"]'), sample: v.closest('li').textContent.includes(${JSON.stringify(C.sampleLabel)}) }))`)
  check(vids.length === 3 && vids.every((v) => v.inline && v.poster && !v.auto && v.track && v.sample), `${where}: three videos, playsinline, poster, captions track, no autoplay, sample label`, JSON.stringify(vids))
  const played = []
  for (let i = 0; i < 3; i++) {
    const r = await js(`const v = document.querySelectorAll('#lessons video')[${i}]; v.muted = true; v.currentTime = 6; try { await v.play() } catch (e) { return { err: String(e) } }
      const t0 = Date.now(); while (v.currentTime < 6.4 && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 50))
      const tt = v.textTracks[0]; const cue = tt && tt.activeCues && tt.activeCues[0]
      const out = { t: v.currentTime, mode: tt && tt.mode, cue: cue ? cue.text : null, muted: v.muted }; v.pause(); return out`)
    played.push(r)
  }
  check(played.every((p) => !p.err && p.t >= 6.4 && p.mode === 'showing' && p.muted && /Sample, Anne's lesson coming soon/.test(p.cue || '')), `${where}: each video plays (muted) with its captions showing`, JSON.stringify(played))

  // Pick a track: its sample day shows.
  await js(`document.querySelector('#tracks [data-track="men40"]').click()`)
  const day = await js(`return { shown: !document.getElementById('day').hidden, text: document.getElementById('day-text').textContent, checked: [...document.querySelectorAll('#tracks [aria-checked=true]')].map((b) => b.dataset.track) }`)
  check(day.shown && day.text === C.tracks[2].day && day.checked.join() === 'men40', `${where}: picking a track shows its sample day`, JSON.stringify(day))

  // Type a weight (real key input): a range shows; kg flips it.
  await js(`document.getElementById('weight').focus()`)
  await cdp('Input.insertText', { text: WEIGHT })
  await until('!document.getElementById("result").hidden', 'protein range')
  const lb = await js(`return document.getElementById('result').innerText`)
  check(/About 100 to 135 g of protein a day/.test(lb) && /About 35 to 45 g at each of 3 meals/.test(lb), `${where}: ${WEIGHT} lb shows a protein range`, lb)
  await js(`document.getElementById('unit-kg').click()`)
  const kg = await js(`return document.getElementById('result').innerText`)
  check(/About 225 to 300 g of protein a day/.test(kg), `${where}: ${WEIGHT} kg flips the range`, kg)
  await js(`document.getElementById('unit-lb').click()`)

  const L = await js(LAYOUT)
  check(L.scroll <= 0, `${where}: no sideways scroll`, 'overflow ' + L.scroll)
  check(L.minFont >= 12, `${where}: no text under 12px`, 'smallest ' + L.minFont)
  check(L.smallTaps.length === 0, `${where}: tap targets at least 44px`, L.smallTaps.join(', '))
  const cs = L.centres.map((c) => c[1])
  check(cs.length >= 7 && Math.max(...cs) - Math.min(...cs) <= 1, `${where}: one centre line`, JSON.stringify(L.centres))
  for (const k of ['tracks', 'lessons', 'next', 'units']) check(equal(L[k]), `${where}: ${k} equal in size`, JSON.stringify(L[k]))
  const cols = new Set(L.tracks.map((b) => b[2])).size
  if (w < 760) {
    check(new Set(L.tracks.slice(0, 4).map((b) => b[2])).size === 2, `${where}: picker wraps to two equal columns`, JSON.stringify(L.tracks))
    const last = L.tracks[4], mid = Math.round(last[2] + last[0] / 2)
    check(Math.abs(mid - Math.round(cs[0])) <= 1, `${where}: the odd track is centred`, JSON.stringify([mid, cs[0]]))
  } else check(cols === 5 && new Set(L.tracks.map((b) => b[1])).size === 1, `${where}: picker is one row of five`, JSON.stringify(L.tracks))
  await shot(`glp1-${w}`)

  // Nothing typed or picked is kept or in the URL.
  const kept = await js(`return { url: location.href, s: JSON.stringify(Object.assign({}, sessionStorage)), l: JSON.stringify(Object.assign({}, localStorage)), c: document.cookie }`)
  check(!kept.url.includes(WEIGHT) && !/men40|Men 40/.test(kept.url) && kept.s === '{}' && kept.l === '{}' && kept.c === '', `${where}: weight and pick are not in the URL or storage`, JSON.stringify(kept))

  // The two taps: each counted once, as its own kind, with only slug + link; both open the booking step.
  for (const [id, kind] of [['book', 'glp1-book'], ['protocol', 'glp1-protocol']]) {
    if (id === 'protocol') await open()
    const before = clicks.length
    await js(`document.getElementById('${id}').click()`)
    await until('location.pathname === "/" && location.hash === "#q1"', id + ' opens the booking step')
    const t = Date.now(); while (clicks.length === before && Date.now() - t < 3000) await sleep(50)
    const c = clicks.slice(before)
    check(c.length === 1 && JSON.stringify(Object.keys(c[0]).sort()) === '["link","slug"]' && c[0].link === kind && c[0].slug === 'atoz', `${where}: "${id}" tap counted as ${kind}`, JSON.stringify(c))
  }
}

async function main() {
  await new Promise((r) => web.listen(WEB, '127.0.0.1', r))
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'atoz-glp1-'))
  const chrome = spawn(CHROME, ['--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run',
    '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP * 127.0.0.1', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const wsUrl = await new Promise((ok, bad) => {
    let buf = ''
    chrome.stderr.on('data', (d) => { buf += d; const m = /ws:\/\/[^\s]+/.exec(buf); if (m) ok(m[0]) })
    setTimeout(() => bad(new Error('chrome did not start')), 15000)
  })
  const targets = await (await fetch(wsUrl.replace('ws://', 'http://').replace(/\/devtools\/browser\/.*/, '/json/list'))).json()
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Fetch.requestPaused') return void paused(m.params).catch((err) => { if (!/Invalid InterceptionId|timed out/.test(err.message)) console.error('intercept:', err.message) })
    const w = m.id && waiting.get(m.id); if (w) { waiting.delete(m.id); m.error ? w.bad(new Error(w.method + ': ' + m.error.message)) : w.ok(m.result) }
  })
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable')
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  try {
    await pass(390, 844)
    await pass(1280, 900)
    // The network log: nothing carries the weight or the pick; no third party at all.
    const leak = log.filter((r) => r.url.includes(WEIGHT) || r.body.includes(WEIGHT) || /men40|Men 40|weight|track/i.test(r.url.replace(/\/glp1\/.*$/, '') + r.body))
    check(leak.length === 0, 'no request carries the weight or the track pick', JSON.stringify(leak))
    check(!log.some((r) => /facebook\.|tiktok\.|google|doubleclick|cdn|fonts\./i.test(new URL(r.url).host)), 'no request to facebook.com, tiktok.com or any tracker, font or CDN')
    check(external.length === 0, 'no request left for any host but the site and the stubbed spine', external.join(' | '))
    const spineCalls = log.filter((r) => r.url.startsWith(SPINE) && r.method !== 'OPTIONS')
    check(spineCalls.filter((r) => r.url.endsWith('/click')).every((r) => /^\{"slug":"atoz","link":"glp1-(book|protocol)"\}$/.test(r.body)), 'every click beacon body is exactly {slug, link}', JSON.stringify(spineCalls))
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'network-log.json'), JSON.stringify(log, null, 1))
    console.log(`requests logged: ${log.length} (${log.filter((r) => r.url.startsWith(ORIGIN)).length} to the site, ${spineCalls.length} to the stubbed spine)`)
  } finally {
    try { await cdp('Browser.close') } catch {}
    chrome.kill()
    await new Promise((r) => { if (chrome.exitCode !== null) r(); else { chrome.once('exit', r); setTimeout(r, 3000) } })
    web.close()
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(2) })

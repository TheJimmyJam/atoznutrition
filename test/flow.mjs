// Headless check of the public page and its qualifier against a local stub of the spine's two public endpoints.
// Nothing reaches the live lead door: the page talks to http://localhost:5391 when served from localhost (see app.js).
// Run: node test/flow.mjs            (needs ~/.local/bin/chrome-headless-shell; no npm install, no network)
//      SHOTS=/some/dir node test/flow.mjs   also saves screenshots at 390 and 1280.
//      PAGE_JSON=/path/page.json node ...   serves that /page answer instead of the made-up one (for look checks).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB = 5561
const API = 5391
const ORIGIN = `http://localhost:${WEB}`
const CHROME = process.env.CHROME || path.join(os.homedir(), '.local/bin/chrome-headless-shell')
const SHOTS = process.env.SHOTS || ''

// ---- made-up practice (no real person) ----
const QUESTIONS = [
  { key: 'goal', options: ['habits', 'fitness', 'meals', 'both', 'unsure'] },
  { key: 'timeline', options: ['now', 'soon', 'later', 'browsing'] },
  { key: 'budget', options: ['low', 'mid', 'high', 'unsure'] },
  { key: 'location', options: ['local', 'online', 'elsewhere'] },
  { key: 'source', options: ['instagram', 'facebook', 'tiktok', 'friend', 'search', 'other'] },
]
const WORDS = {
  'page.work': 'Work with me', 'page.next': 'Next', 'page.back': 'Back', 'page.contact': 'Where can I reach you?',
  'page.tips': 'Send me tips by email', 'page.send': 'Send', 'page.fit.title': 'You look like a great fit.',
  'page.fit.button': 'Book a time', 'page.guide.title': 'Thanks! Start with my free guide.', 'page.guide.button': 'Get the free guide',
  'page.rate': 'Too many tries. Please try again later.', 'page.failed': "Couldn't send. Please try again.",
  'page.q.goal': "What's your main goal?", 'page.q.timeline': 'When would you like to start?', 'page.q.budget': 'What budget fits?',
  'page.q.location': 'Where are you?', 'page.q.source': 'How did you find me?',
}
const PAGE = process.env.PAGE_JSON ? JSON.parse(fs.readFileSync(process.env.PAGE_JSON, 'utf8')) : {
  ok: true, name: 'Sample Studio', owner_name: 'Robin Example, MS, CPT', tagline: 'A first line here. And a second one.',
  location: 'Sampletown', about: 'I am a made-up practitioner used only by this test. This paragraph stands in for a bio of a few sentences so the layout carries real length.',
  services: ['Plan One: A line of detail for the first plan', 'Plan Two: A line of detail for the second plan that runs a little longer', 'Plan Three: Short detail'],
  questions: QUESTIONS, words: WORDS,
}
const BOOK = 'https://booking.example.test/robin'
const GUIDE = 'https://guide.example.test/start'

// ---- stub spine ----
const posted = []
const api = http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', vary: 'origin' }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = JSON.parse(raw || '{}')
    const send = (status, data) => { res.writeHead(status, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
    if (req.url === '/api/social-lead/page') return send(200, PAGE)
    if (req.url === '/api/social-lead/submit') {
      if (body.email === 'down@example.test') return req.socket.destroy()
      if (body.email === 'slow@example.test') return send(429, { ok: false })
      posted.push(body)
      const fit = body.timeline === 'now' && body.budget === 'high'
      return send(201, { ok: true, fit, next: fit ? { kind: 'booking', url: BOOK } : { kind: 'guide', url: GUIDE } })
    }
    send(404, { ok: false })
  })
})

// ---- static site ----
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }
const web = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, ORIGIN).pathname)
  if (p.endsWith('/')) p += 'index.html'
  const file = path.join(ROOT, p)
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
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
    setTimeout(() => { if (waiting.delete(id)) bad(new Error(method + ' timed out')) }, 10000)
  })
}
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(expr, what, ms = 4000) {
  const t = Date.now()
  while (Date.now() - t < ms) { if (await js(`return !!(${expr})`)) return; await sleep(50) }
  throw new Error('timed out waiting for ' + what)
}
async function size(w, h) { await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }) }
async function nav(u) { await cdp('Page.navigate', { url: u }); await sleep(250) }
async function loaded() { await until('document.readyState === "complete"', 'load') }
async function shot(name) {
  if (!SHOTS) return
  const { result } = await cdp('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true })
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await js('return innerWidth'), height: result.value, scale: 1 } })
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'))
}

// ---- checks ----
let failed = 0
function check(ok, what, detail = '') { console.log((ok ? 'PASS ' : 'FAIL ') + what + (ok || !detail ? '' : '  (' + detail + ')')); if (!ok) failed++ }

// Layout facts for the visible page: sideways scroll, smallest text, small tap targets, centre lines, equal neighbours.
const LAYOUT = `
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' }
  const out = { scroll: document.documentElement.scrollWidth - innerWidth, minFont: 99, smallTaps: [], centres: [], cards: [], opts: [] }
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('.pot') || el.classList.contains('sr')) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (own) out.minFont = Math.min(out.minFont, parseFloat(getComputedStyle(el).fontSize))
  }
  for (const el of document.querySelectorAll('button, a[href], .opt, .check, .field input')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    if (r.height < 44 || r.width < 44) out.smallTaps.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
  }
  for (const sel of ['.pubtop', '.hero', '.services', '#flow', '.pubfoot', '#service-list', '#q-options', '#contact', '#done']) {
    const el = document.querySelector(sel); if (!el || !vis(el)) continue
    const r = el.getBoundingClientRect(); out.centres.push([sel, Math.round((r.left + r.right) / 2 * 10) / 10])
  }
  out.cards = [...document.querySelectorAll('#service-list li')].filter(vis).map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)] })
  out.opts = [...document.querySelectorAll('#q-options .opt')].filter(vis).map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })
  return out`
function layoutChecks(L, where) {
  check(L.scroll <= 0, `${where}: no sideways scroll`, 'overflow ' + L.scroll + 'px')
  check(L.minFont >= 12, `${where}: no text under 12px`, 'smallest ' + L.minFont + 'px')
  check(L.smallTaps.length === 0, `${where}: tap targets at least 44px`, L.smallTaps.join(', '))
  const cs = L.centres.map((c) => c[1])
  check(cs.length > 0 && Math.max(...cs) - Math.min(...cs) <= 1, `${where}: one centre line`, JSON.stringify(L.centres))
  for (const [name, list] of [['cards', L.cards], ['options', L.opts]]) {
    if (list.length < 2) continue
    const ws = list.map((c) => c[0]), hs = list.map((c) => c[1])
    check(Math.max(...ws) - Math.min(...ws) <= 1 && Math.max(...hs) - Math.min(...hs) <= 1, `${where}: ${name} equal in size`, JSON.stringify(list))
  }
}

async function pick(code) {
  await js(`document.querySelector('#q-options input[value="${code}"]').click()`)
  await js(`document.getElementById('next').click()`)
}
async function current() { return js(`return location.hash`) }

async function main() {
  await new Promise((r) => api.listen(API, '127.0.0.1', r))
  await new Promise((r) => web.listen(WEB, '127.0.0.1', r))
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'atoz-flow-'))
  const chrome = spawn(CHROME, ['--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const wsUrl = await new Promise((ok, bad) => {
    let buf = ''
    chrome.stderr.on('data', (d) => { buf += d; const m = /ws:\/\/[^\s]+/.exec(buf); if (m) ok(m[0]) })
    setTimeout(() => bad(new Error('chrome did not start')), 15000)
  })
  const targets = await (await fetch(wsUrl.replace('ws://', 'http://').replace(/\/devtools\/browser\/.*/, '/json/list'))).json()
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); const w = m.id && waiting.get(m.id); if (w) { waiting.delete(m.id); m.error ? w.bad(new Error(w.method + ': ' + m.error.message)) : w.ok(m.result) } })
  await cdp('Page.enable'); await cdp('Runtime.enable')

  try {
    // 1. Phone: who she is, her services, one "Work with me", no sideways scroll.
    await size(390, 844)
    await nav(ORIGIN + '/')
    await until(`document.querySelectorAll('#service-list li').length > 0`, 'services')
    const p = await js(`return { owner: document.getElementById('owner').textContent, tag: document.getElementById('tagline').textContent, about: !document.getElementById('about').hidden,
      services: [...document.querySelectorAll('#service-list li strong')].map((x) => x.textContent), work: [...document.querySelectorAll('button, a')].filter((b) => /work with me/i.test(b.textContent) && b.offsetParent).length,
      where: document.getElementById('where').textContent, portrait: !document.getElementById('portrait').hidden, plate: !document.getElementById('plate').hidden }`)
    check(p.owner === PAGE.owner_name && p.tag === PAGE.tagline && p.about, 'phone: name with credentials, tagline and bio from the page data')
    check(p.services.length === PAGE.services.length, 'phone: services from the page data', p.services.join(' | '))
    check(p.work === 1, 'phone: exactly one "Work with me" button', String(p.work))
    check(p.where === (PAGE.location || ''), 'footer: location')
    check(!p.portrait && p.plate, 'no portrait without one in the page data; the studio panel stands in')
    layoutChecks(await js(LAYOUT), 'phone page')
    await shot('390-page')

    // 2. Five questions, one at a time; none about health.
    await js(`document.getElementById('work').click()`)
    await until(`location.hash === '#q1' && !document.getElementById('question').hidden`, 'question 1')
    check(await js(`return document.activeElement && document.activeElement.id === 'q-title'`), 'focus moves to the new question')
    check(await js(`return !!document.querySelector('#question fieldset legend #q-title')`), 'question is a fieldset with a legend')
    check(await js(`return document.getElementById('step').textContent`) === 'Question 1 of 5', 'progress reads "Question 1 of 5"')
    check(await js(`return document.getElementById('next').disabled`), 'Next waits for an answer')
    layoutChecks(await js(LAYOUT), 'phone question')
    await shot('390-question')
    const keys = []
    const fitAnswers = { goal: 'both', timeline: 'now', budget: 'high', location: 'online', source: 'instagram' }
    for (let i = 0; i < 5; i++) {
      keys.push(await js(`return [...document.querySelectorAll('#q-options input')].map((x) => x.id.split('-')[1])[0]`))
      const title = await js(`return document.getElementById('q-title').textContent`)
      check(!/health|medic|diagnos|symptom|condition|pregnan|weight|pain/i.test(title), `question ${i + 1} is not about health`, title)
      await pick(fitAnswers[keys[i]])
      if (i === 2) {
        // 3. Back works: the in-page Back, the browser's Back, and a refresh mid-quiz keeps the answers.
        await until(`location.hash === '#q4'`, 'q4')
        await js(`history.back()`); await until(`location.hash === '#q3'`, 'browser back to q3')
        check(await js(`return document.querySelector('#q-options input:checked')?.value`) === 'high', 'browser Back shows the earlier answer')
        await js(`document.getElementById('back').click()`); await until(`location.hash === '#q2'`, 'in-page back to q2')
        check(await js(`return document.querySelector('#q-options input:checked')?.value`) === 'now', 'in-page Back shows the earlier answer')
        await cdp('Page.reload'); await sleep(200); await until(`location.hash === '#q2' && !document.getElementById('question').hidden`, 'reload on q2')
        check(await js(`return document.querySelector('#q-options input:checked')?.value`) === 'now', 'refresh mid-quiz keeps the answers')
        await js(`document.getElementById('next').click()`); await until(`location.hash === '#q3'`, 'q3 again')
        await js(`document.getElementById('next').click()`)
      }
      await until(`location.hash === '${i < 4 ? '#q' + (i + 2) : '#contact'}'`, 'next step after ' + (i + 1))
    }
    check(keys.join(',') === 'goal,timeline,budget,location,source', 'questions: goal, timeline, budget, location, how they found her', keys.join(','))

    // 4. Contact: opt-in unchecked by default; errors keep the answers.
    check(await js(`return !document.getElementById('f-tips').checked`), 'monthly-tips opt-in starts unchecked')
    layoutChecks(await js(LAYOUT), 'phone contact')
    await shot('390-contact')
    await js(`document.getElementById('f-name').value = 'Casey Sample'; document.getElementById('f-email').value = 'slow@example.test'; document.getElementById('send').click()`)
    await until(`!document.getElementById('send-failed').hidden`, 'rate-limit line')
    check(await js(`return document.getElementById('send-failed').textContent`) === WORDS['page.rate'] && await current() === '#contact', 'rate limit shows a plain line and stays')
    await js(`document.getElementById('f-email').value = 'down@example.test'; document.getElementById('send').click()`)
    await until(`document.getElementById('send-failed').textContent === ${JSON.stringify(WORDS['page.failed'])}`, 'network line')
    check(await current() === '#contact', 'network failure shows a plain line and stays')
    await js(`document.getElementById('f-email').value = 'casey@example.test'; document.getElementById('f-tips').click(); document.getElementById('send').click()`)
    await until(`location.hash === '#done' && !document.getElementById('done-link').hidden`, 'result')
    const good = await js(`const a = document.getElementById('done-link'); return { href: a.href, kind: a.dataset.next }`)
    check(good.href === BOOK && good.kind === 'booking', 'good fit ends on the booking link (answers kept through two errors)', JSON.stringify(good))
    const body = posted.at(-1)
    check(JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['budget', 'email', 'goal', 'location', 'name', 'phone', 'slug', 'source', 'timeline', 'tips', 'website']),
      'submit sends the same fields as before', Object.keys(body).join(','))
    check(body.website === '' && body.tips === true && body.phone === null && body.slug === 'atoz-local' && body.goal === 'both', 'submit values: honeypot empty, opt-in, answers', JSON.stringify(body))
    layoutChecks(await js(LAYOUT), 'phone result')
    await shot('390-result')

    // 5. Any other answer set ends on the free guide (new run from the page).
    await nav(ORIGIN + '/')
    await until(`document.querySelectorAll('#service-list li').length > 0`, 'services again')
    await js(`document.getElementById('work').click()`)
    await until(`location.hash === '#q1'`, 'fresh q1')
    check(await js(`return !document.querySelector('#q-options input:checked')`), 'a new run after a result starts with no answers')
    for (const code of ['unsure', 'later', 'low', 'elsewhere', 'other']) await pick(code)
    await until(`location.hash === '#contact'`, 'contact 2')
    await js(`document.getElementById('f-name').value = 'Jordan Sample'; document.getElementById('f-email').value = 'jordan@example.test'; document.getElementById('send').click()`)
    await until(`location.hash === '#done' && !document.getElementById('done-link').hidden`, 'result 2')
    check(await js(`return document.getElementById('done-link').href`) === GUIDE && posted.at(-1).tips === false, 'other answers end on the free guide; opt-in stays off unless ticked')
    check(posted.length === 2, 'two leads reached the stub (none elsewhere)', String(posted.length))

    // 6. A typed link cannot skip questions.
    await js(`sessionStorage.clear()`)
    await nav('about:blank')
    await nav(ORIGIN + '/#contact')
    await until(`location.hash === '#q1'`, 'guard to q1')
    check(true, 'a link straight to #contact with no answers starts at question 1')

    // 7. Desktop: three equal cards in one row, one centre line.
    await size(1280, 900)
    await nav(ORIGIN + '/')
    await until(`document.querySelectorAll('#service-list li').length > 0`, 'desktop services')
    const L = await js(LAYOUT)
    layoutChecks(L, 'desktop page')
    check(L.cards.length < 3 || new Set(L.cards.map((c) => c[2])).size === 1, 'desktop: the programs sit in one row', JSON.stringify(L.cards))
    await shot('1280-page')
    await js(`document.getElementById('work').click()`); await until(`location.hash === '#q1'`, 'desktop q1')
    layoutChecks(await js(LAYOUT), 'desktop question')
    await shot('1280-question')
    for (const code of ['both', 'now', 'high', 'online', 'search']) await pick(code)
    await until(`location.hash === '#contact'`, 'desktop contact')
    layoutChecks(await js(LAYOUT), 'desktop contact')
    await shot('1280-contact')

    // 8. Without JavaScript she is still named (logo + heading).
    await cdp('Emulation.setScriptExecutionDisabled', { value: true })
    await nav(ORIGIN + '/'); await sleep(500)
    const r = await cdp('Runtime.evaluate', { expression: `({ logo: document.querySelector('.brand').alt, h1: document.getElementById('name').textContent, flow: document.getElementById('flow').hidden })`, returnByValue: true }).catch(() => null)
    const nojs = r && r.result && r.result.value
    await cdp('Emulation.setScriptExecutionDisabled', { value: false })
    check(!!nojs && nojs.logo && nojs.h1 && nojs.flow, 'without JavaScript the page still names her practice', JSON.stringify(nojs))
  } finally {
    try { await cdp('Browser.close') } catch {}
    chrome.kill()
    api.close(); web.close()
    fs.rmSync(profile, { recursive: true, force: true })
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(2) })

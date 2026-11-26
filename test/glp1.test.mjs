// Unit checks for the GLP-1 "Start here" page: calculator math, config shape, copy rules, the tap beacon's body.
// Run: node --test test/glp1.test.mjs   (no network, no install)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const C = require(path.join(ROOT, 'glp1/config.js'))
const { protein, tapBody } = require(path.join(ROOT, 'glp1/glp1.js'))
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const FIXED = 'Education, not medical advice. Anne is a nutritionist, not a prescriber. Talk to your prescriber about your medication and before changing how you eat, train or take supplements.'

test('config shape', () => {
  assert.equal(C.homeLink, false, 'unlinked until Jimmy says publish')
  assert.equal(C.fixedLine, FIXED)
  assert.equal(C.protein.lowPerKg, 1.2)
  assert.equal(C.protein.highPerKg, 1.6)
  assert.equal(C.protein.roundTo, 5)
  assert.equal(C.protein.meals, 3)
  assert.equal(C.proteinCaution, 'Ask your prescriber first if you have kidney disease, are pregnant or breastfeeding.')
  assert.deepEqual(C.tracks.map((t) => t.label), ['Business professionals', 'Stay-at-home moms', 'Men 40+', 'Travellers', 'Weight training'])
  for (const t of C.tracks) assert.ok(/^[a-z0-9-]+$/.test(t.id) && t.day.length > 20 && t.day.length < 160, t.id)
  assert.deepEqual(C.lessons.map((l) => l.title), ['Start here', 'Protein across the day', 'Small meals and hard days'])
  for (const l of C.lessons) {
    for (const k of ['src', 'poster', 'captions']) {
      assert.ok(l[k].startsWith('/glp1/media/'), `${l.id} ${k} is same-site`)
      assert.ok(fs.statSync(path.join(ROOT, l[k])).size > 0, `${l[k]} exists`)
    }
    assert.ok(read(l.captions).startsWith('WEBVTT'), `${l.captions} is WebVTT`)
    assert.ok(fs.statSync(path.join(ROOT, l.src)).size < 2_000_000, `${l.src} is small`)
  }
  assert.equal(C.sampleLabel, "Sample, Anne's lesson coming soon")
  assert.ok(C.protocolUrl === null || /^https:\/\//.test(C.protocolUrl))
  assert.equal(C.bookUrl, '/#q1')
})

test('the page carries the fixed line and the caution word for word', () => {
  const html = read('glp1/index.html')
  assert.ok(html.includes(FIXED))
  assert.ok(html.includes(C.proteinCaution))
  assert.ok(html.includes('Which week sounds like yours?'))
  assert.ok(/<meta name="robots" content="noindex">/.test(html))
})

test('protein range: kg, rounding to 5 g, per meal over 3', () => {
  // 70 kg: 84 -> 85, 112 -> 110; per meal 28 -> 30, 37.3 -> 35
  assert.deepEqual(protein('70', 'kg', C.protein), { low: 85, high: 110, mealLow: 30, mealHigh: 35, meals: 3 })
  // 100 kg: 120, 160; per meal 40, 53.3 -> 55
  assert.deepEqual(protein(100, 'kg', C.protein), { low: 120, high: 160, mealLow: 40, mealHigh: 55, meals: 3 })
  // 92.5 kg (decimal comma too): 111 -> 110, 148 -> 150; per meal 37 -> 35, 49.3 -> 50
  assert.deepEqual(protein('92,5', 'kg', C.protein), { low: 110, high: 150, mealLow: 35, mealHigh: 50, meals: 3 })
})

test('protein range: lb converts to kg first', () => {
  // 200 lb = 90.718 kg: 108.86 -> 110, 145.15 -> 145; per meal 36.3 -> 35, 48.4 -> 50
  assert.deepEqual(protein('200', 'lb', C.protein), { low: 110, high: 145, mealLow: 35, mealHigh: 50, meals: 3 })
  // 154.3 lb ~ 70 kg matches 70 kg
  assert.deepEqual(protein('154.3', 'lb', C.protein), protein('70', 'kg', C.protein))
})

test('protein range: nonsense answers nothing', () => {
  for (const [w, u] of [['', 'lb'], ['abc', 'kg'], ['5', 'lb'], ['2000', 'lb'], ['500', 'kg'], ['-80', 'kg'], ['80', 'stone']]) {
    assert.equal(protein(w, u, C.protein), null, `${w} ${u}`)
  }
})

test('the multipliers come from the config', () => {
  assert.deepEqual(protein(100, 'kg', { lowPerKg: 1, highPerKg: 2, roundTo: 5, meals: 4 }), { low: 100, high: 200, mealLow: 25, mealHigh: 50, meals: 4 })
})

test('the tap beacon carries only the practice and the button kind', () => {
  for (const kind of ['glp1-book', 'glp1-protocol']) {
    const body = JSON.parse(tapBody('atoz', kind))
    assert.deepEqual(Object.keys(body).sort(), ['link', 'slug'])
    assert.equal(body.link, kind)
  }
  const html = read('glp1/index.html')
  assert.ok(html.includes('data-kind="glp1-book"') && html.includes('data-kind="glp1-protocol"'))
  // The page script never reads the weight or the track into anything it sends or keeps.
  const js = read('glp1/glp1.js')
  assert.ok(!/sessionStorage|localStorage|indexedDB|document\.cookie|history\.(push|replace)State|location\.(hash|search)\s*=/.test(js), 'nothing kept or put in the URL')
  assert.equal((js.match(/sendBeacon\(/g) || []).length, 1, 'one beacon call')
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(js), 'no other requests')
})

test('no forbidden words or asks in the page copy', () => {
  const copy = [read('glp1/index.html'), JSON.stringify(C), ...C.lessons.map((l) => read(l.captions))].join('\n')
  const banned = [
    /\bdos(e|es|ing|age)\b/i, /\bmg\b/i, /\bswitch(ing)?\b/i, /\bstop(ping)?\b/i, /\bcure[sd]?\b/i, /\btreat(s|ed|ing|ment)?\b/i,
    /\bguarantee[sd]?\b/i, /before\s*(and|&|\/|-)\s*after/i, /\blost \d+/i,
    /ozempic|wegovy|mounjaro|zepbound|saxenda|rybelsus|trulicity|victoza|semaglutide|tirzepatide|liraglutide|dulaglutide/i,
    /facebook|tiktok|fbq|pixel|gtag|googletagmanager|analytics/i, /fonts\.googleapis|cdn\.|unpkg|jsdelivr/i,
  ]
  for (const re of banned) assert.ok(!re.test(copy), `forbidden: ${re}`)
  const html = read('glp1/index.html')
  assert.ok(!/<form\b/i.test(html), 'no form')
  assert.equal((html.match(/<input\b/gi) || []).length, 1, 'one input: the weight')
  assert.ok(!/type="(email|tel)"|autocomplete="(name|email|tel)"/i.test(html))
  assert.ok(!/symptom|your name|email/i.test(html), 'never asks for name, email or symptoms')
  // every src/href on the page is same-site
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(m[1].startsWith('/'), m[1])
})

test('the home page link is off and switched only by the config', () => {
  const html = read('index.html')
  assert.ok(/<a id="glp1-link"[^>]*hidden/.test(html))
  assert.ok(read('app.js').includes('window.GLP1_CONFIG.homeLink === true'))
})

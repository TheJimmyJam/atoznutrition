// The GLP-1 "Start here" page. Everything comes from config.js. The track pick and the weight stay on the phone:
// they live in memory only, are never put in the URL or storage, and are never sent. The only request this page makes
// on its own is the tap count for "Book a session" / "Get the full protocol": {slug, link} and nothing else.
;(function (root) {
  'use strict'

  var KG_PER_LB = 0.45359237
  var LIMITS = { lb: [60, 800], kg: [27, 360] }

  function roundTo(n, step) { return Math.round(n / step) * step }

  // weight: a string or number as typed; unit: 'lb' | 'kg'. Answers null for anything that is not a plausible weight.
  function protein(weight, unit, p) {
    var w = typeof weight === 'number' ? weight : parseFloat(String(weight || '').replace(',', '.').trim())
    if (unit !== 'lb' && unit !== 'kg') return null
    if (!isFinite(w) || w < LIMITS[unit][0] || w > LIMITS[unit][1]) return null
    var kg = unit === 'lb' ? w * KG_PER_LB : w
    var step = p.roundTo || 5
    var meals = p.meals || 3
    return {
      low: roundTo(kg * p.lowPerKg, step),
      high: roundTo(kg * p.highPerKg, step),
      mealLow: roundTo(kg * p.lowPerKg / meals, step),
      mealHigh: roundTo(kg * p.highPerKg / meals, step),
      meals: meals,
    }
  }

  // The beacon body: only which practice and which button. Kept here so the tests can check it carries nothing else.
  function tapBody(slug, kind) { return JSON.stringify({ slug: slug, link: kind }) }

  if (typeof module === 'object' && module.exports) { module.exports = { protein: protein, tapBody: tapBody }; return }

  var LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  var API = LOCAL ? 'http://localhost:5391' : 'https://clients.cannoncodeconnect.com'
  var SLUG = LOCAL ? 'atoz-local' : 'atoz'
  var $ = function (id) { return document.getElementById(id) }
  var C = root.GLP1_CONFIG
  var unit = 'lb'

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function renderTracks() {
    var box = $('tracks')
    C.tracks.forEach(function (t) {
      var b = el('button', 'g1-track', t.label)
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', 'false')
      b.setAttribute('data-track', t.id)
      b.addEventListener('click', function () { pickTrack(t.id) })
      box.appendChild(b)
    })
  }

  function pickTrack(id) {
    var t = null
    C.tracks.forEach(function (x) { if (x.id === id) t = x })
    if (!t) return
    var all = $('tracks').querySelectorAll('.g1-track')
    for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-checked', all[i].getAttribute('data-track') === id ? 'true' : 'false')
    $('day-k').textContent = 'A sample day: ' + t.label
    $('day-text').textContent = t.day
    $('day').hidden = false
  }

  function renderLessons() {
    var list = $('lessons')
    C.lessons.forEach(function (l) {
      var li = el('li', 'g1-lesson')
      var v = document.createElement('video')
      v.className = 'g1-video'
      v.controls = true
      v.preload = 'metadata'
      v.playsInline = true
      v.setAttribute('playsinline', '')
      v.poster = l.poster
      v.setAttribute('aria-label', l.title)
      var s = document.createElement('source')
      s.src = l.src
      s.type = 'video/mp4'
      v.appendChild(s)
      var tr = document.createElement('track')
      tr.kind = 'captions'
      tr.srclang = 'en'
      tr.label = 'English'
      tr.src = l.captions
      tr.default = true
      v.appendChild(tr)
      // Captions on by default, whatever the browser's own choice.
      v.addEventListener('loadedmetadata', function () { if (v.textTracks[0]) v.textTracks[0].mode = 'showing' })
      li.appendChild(v)
      var body = el('div', 'g1-lesson-body')
      body.appendChild(el('strong', null, l.title))
      if (l.sample) body.appendChild(el('span', 'g1-sample', C.sampleLabel))
      li.appendChild(body)
      list.appendChild(li)
    })
  }

  function setUnit(u) {
    unit = u
    $('unit-lb').setAttribute('aria-pressed', u === 'lb' ? 'true' : 'false')
    $('unit-kg').setAttribute('aria-pressed', u === 'kg' ? 'true' : 'false')
    calc()
  }

  function calc() {
    var r = protein($('weight').value, unit, C.protein)
    if (!r) { $('result').hidden = true; return }
    $('per-day').textContent = 'About ' + r.low + ' to ' + r.high + ' g of protein a day'
    $('per-meal').textContent = 'About ' + r.mealLow + ' to ' + r.mealHigh + ' g at each of ' + r.meals + ' meals'
    $('result').hidden = false
  }

  function wireNext() {
    var book = C.bookUrl || '/#q1'
    var full = typeof C.protocolUrl === 'string' && /^https:\/\//.test(C.protocolUrl) ? C.protocolUrl : book
    $('book').href = book
    $('protocol').href = full
    if (full !== book) $('protocol').rel = 'noopener'
    ;['book', 'protocol'].forEach(function (id) {
      var a = $(id)
      a.addEventListener('click', function () {
        try {
          if (navigator.sendBeacon) navigator.sendBeacon(API + '/api/social-lead/click', tapBody(SLUG, a.getAttribute('data-kind')))
        } catch (e) { /* the link still opens */ }
      })
    })
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!C) return
    $('fixed-line').textContent = C.fixedLine
    $('caution').textContent = C.proteinCaution
    renderTracks()
    renderLessons()
    $('weight').addEventListener('input', calc)
    $('unit-lb').addEventListener('click', function () { setUnit('lb') })
    $('unit-kg').addEventListener('click', function () { setUnit('kg') })
    wireNext()
  })
})(this)

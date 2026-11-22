// A to Z Nutrition's public page. Who she is, her services and the words come from her Social Desk settings
// (POST /api/social-lead/page on the CCC spine, cross-site; only public-safe fields). "Work with me" asks the five
// questions one at a time, then a name and email, and posts them (POST /api/social-lead/submit). The spine decides
// good fit or not by her own rule and answers with where to go next: her booking link, or her free guide.
// No health questions. Each step is a history entry (#q1..#q5, #contact, #done), so the browser's Back works;
// the answers (never the name or email) are kept in sessionStorage so a refresh mid-quiz keeps them.
(function () {
  'use strict'
  var LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  // The local harness (npm run dev:local in ccc-apps with CCC_DEV_SOCIAL=1) serves the made-up client atoz-local.
  var API = LOCAL ? 'http://localhost:5391' : 'https://clients.cannoncodeconnect.com'
  var SLUG = LOCAL ? 'atoz-local' : 'atoz'
  var KEEP = 'atoz.quiz'

  var $ = function (id) { return document.getElementById(id) }
  var words = {}
  var questions = []
  var loaded = null
  var state = { answers: {}, result: null }
  var view = 'page'
  var sending = false

  function word(key, fallback) { return typeof words[key] === 'string' ? words[key] : fallback }
  function show(el, on) { el.hidden = !on }

  function keep() { try { sessionStorage.setItem(KEEP, JSON.stringify(state)) } catch (e) { /* private mode: answers stay in memory */ } }
  function recall() {
    try {
      var s = JSON.parse(sessionStorage.getItem(KEEP) || 'null')
      if (s && typeof s.answers === 'object' && s.answers) state = { answers: s.answers, result: s.result || null }
    } catch (e) { /* nothing kept */ }
  }

  function post(path, body) {
    return fetch(API + path, {
      method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (data) { return { status: r.status, data: data } })
    })
  }

  function fillWords() {
    var nodes = document.querySelectorAll('[data-word]')
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = word(nodes[i].getAttribute('data-word'), nodes[i].textContent)
  }

  function setText(id, text) {
    var el = $(id)
    el.textContent = text || ''
    show(el, !!text)
  }

  function fillProfile(p) {
    if (p.name) {
      $('name').textContent = p.name
      $('plate-name').textContent = p.name
      $('foot-name').textContent = p.name
      document.title = p.name
    }
    var owner = typeof p.owner_name === 'string' ? p.owner_name : ''
    setText('owner', owner)
    setText('who', owner.split(',')[0].trim())
    // Her tagline in two tones: the first sentence in ink, the rest in the accent (her words, unchanged).
    var tag = $('tagline')
    tag.textContent = ''
    var t = typeof p.tagline === 'string' ? p.tagline : ''
    var m = /^(.+?[.!?])\s+(\S.*)$/.exec(t)
    if (m) {
      tag.appendChild(document.createTextNode(m[1] + ' '))
      var em = document.createElement('em')
      em.textContent = m[2]
      tag.appendChild(em)
    } else tag.textContent = t
    show(tag, !!t)
    setText('about', p.about)
    // The studio panel: her own portrait only if her settings give one; otherwise a navy panel with her name.
    // Same-origin paths only (the CSP allows img-src 'self'): one leading slash, no scheme, no "//", no backslash.
    var pic = typeof p.portrait === 'string' && /^\/(?![\/\\])[^\\\s]*$/.test(p.portrait) ? p.portrait : ''
    var img = $('portrait')
    img.onerror = function () { show(img, false); show($('plate'), true) }
    if (pic) { img.alt = owner.split(',')[0].trim(); img.src = pic } else img.removeAttribute('src')
    show(img, !!pic)
    show($('plate'), !pic)
    var list = $('service-list')
    list.textContent = ''
    // Only non-empty strings become cards; anything else in her settings is skipped.
    var services = (Array.isArray(p.services) ? p.services : []).filter(function (x) { return typeof x === 'string' && x.trim() })
    for (var i = 0; i < services.length; i++) {
      var li = document.createElement('li')
      // "Name: what it is" shows as a name over a line of detail; a plain string shows as a name.
      var s = services[i].trim()
      var cut = s.indexOf(': ')
      var b = document.createElement('strong')
      b.textContent = cut > 0 ? s.slice(0, cut) : s
      li.appendChild(b)
      if (cut > 0) {
        var d = document.createElement('span')
        d.textContent = s.slice(cut + 2)
        li.appendChild(d)
      }
      list.appendChild(li)
    }
    // Equal columns on a wide screen: three, or two for 2 and 4 (never a row with an orphan where avoidable).
    var n = services.length
    list.className = 'cards' + (n === 1 ? ' one' : n % 3 !== 0 && n % 2 === 0 ? ' two' : '')
    show($('services'), n > 0)
    setText('where', p.location)
    setText('plate-where', p.location)
  }

  function load() {
    if (loaded) return loaded
    loaded = post('/api/social-lead/page', { slug: SLUG }).then(function (r) {
      if (r.status !== 200 || !r.data || !r.data.ok) throw new Error('page')
      words = r.data.words || {}
      questions = Array.isArray(r.data.questions) ? r.data.questions : []
      fillWords()
      fillProfile(r.data)
      show($('load-failed'), false)
      return true
    })
    loaded.catch(function () { loaded = null })
    return loaded
  }

  // ---- Steps and history ----
  function hashOf(v) { return v === 'page' ? '' : '#' + v }
  function viewOf(hash) {
    var h = (hash || '').replace(/^#/, '')
    if (/^q[1-9][0-9]?$/.test(h) || h === 'contact' || h === 'done') return h
    return 'page'
  }
  function qIndex(v) { return /^q\d+$/.test(v) ? parseInt(v.slice(1), 10) - 1 : -1 }
  function firstOpen() {
    for (var i = 0; i < questions.length; i++) if (!state.answers[questions[i].key]) return i
    return questions.length
  }
  // The furthest step these answers allow; a refresh or a typed link never skips a question.
  function allowed(v) {
    if (v === 'page') return v
    if (!questions.length) return 'page'
    if (v === 'done') return state.result ? v : allowed('contact')
    var open = firstOpen()
    if (v === 'contact') return open >= questions.length ? v : 'q' + (open + 1)
    var i = qIndex(v)
    if (i < 0 || i >= questions.length) return 'q1'
    return i <= open ? v : 'q' + (open + 1)
  }
  function url(v) { return location.pathname + location.search + hashOf(v) }
  function go(v) {
    history.pushState({ sd: v, from: view }, '', url(v))
    route(true)
  }
  function prevOf(v) {
    if (v === 'contact') return 'q' + questions.length
    var i = qIndex(v)
    return i > 0 ? 'q' + i : 'page'
  }
  function back() {
    var prev = prevOf(view)
    if (history.state && history.state.sd === view && history.state.from === prev) history.back()
    else { history.replaceState({ sd: prev }, '', url(prev)); route(true) }
  }

  function route(moved) {
    var want = viewOf(location.hash)
    // A finished flow (a lead was sent) has no way back into its questions or contact step: Back lands on the page.
    var v = state.result && want !== 'done' ? 'page' : allowed(want)
    if (v !== want) history.replaceState({ sd: v }, '', url(v))
    view = v
    var inFlow = v !== 'page'
    show($('profile'), !inFlow)
    show($('flow'), inFlow)
    show($('question'), qIndex(v) >= 0)
    show($('contact'), v === 'contact')
    show($('done'), v === 'done')
    show($('bar'), v !== 'done')
    if (qIndex(v) >= 0) renderQuestion(qIndex(v), moved)
    else {
      $('step').textContent = ''
      if (v === 'contact') { if (moved) $('f-name').focus({ preventScroll: true }) }
      else if (v === 'done') { renderDone(); if (moved) $('done-title').focus({ preventScroll: true }) }
      else if (moved && document.activeElement !== $('work')) $('work').focus({ preventScroll: true })
    }
    if (moved) window.scrollTo(0, 0)
  }

  function renderQuestion(i, moved) {
    var q = questions[i]
    var total = questions.length
    $('step').textContent = word('page.step', 'Question {n} of {total}').replace('{n}', i + 1).replace('{total}', total)
    var bar = $('progress')
    bar.textContent = ''
    for (var k = 0; k < total; k++) {
      var seg = document.createElement('i')
      if (k <= i) seg.className = 'on'
      bar.appendChild(seg)
    }
    $('q-title').textContent = word('page.q.' + q.key, q.key)
    var box = $('q-options')
    box.textContent = ''
    q.options.forEach(function (code, n) {
      var label = document.createElement('label')
      label.className = 'opt'
      var input = document.createElement('input')
      input.type = 'radio'
      input.name = 'answer'
      input.value = code
      input.id = 'a-' + q.key + '-' + n
      if (state.answers[q.key] === code) input.checked = true
      input.addEventListener('change', function () { $('next').disabled = false })
      var span = document.createElement('span')
      span.textContent = word('page.q.' + q.key + '.' + code, code)
      label.appendChild(input)
      label.appendChild(span)
      box.appendChild(label)
    })
    $('next').disabled = !state.answers[q.key]
    if (moved) $('q-title').focus({ preventScroll: true })
  }

  function answer(e) {
    e.preventDefault()
    var i = qIndex(view)
    if (i < 0) return
    var picked = $('question').querySelector('input[name="answer"]:checked')
    if (!picked) return
    state.answers[questions[i].key] = picked.value
    keep()
    go(i + 1 < questions.length ? 'q' + (i + 2) : 'contact')
  }

  function busy(on) {
    var b = $('work')
    if (on) { b.setAttribute('aria-busy', 'true'); b.setAttribute('aria-disabled', 'true') }
    else { b.removeAttribute('aria-busy'); b.removeAttribute('aria-disabled') }
  }
  function open() {
    var start = function () {
      if (state.result) { state = { answers: {}, result: null }; keep(); $('contact').reset() }
      go('q1')
    }
    if (questions.length) return start()
    if ($('work').getAttribute('aria-busy') === 'true') return
    busy(true)
    load().then(function () { busy(false); start() }, function () {
      busy(false)
      setText('load-failed', word('page.failed', "Couldn't load. Please try again."))
    })
  }

  function renderDone() {
    var data = state.result || {}
    var next = data.next || {}
    var booking = data.fit === true && next.kind === 'booking'
    $('done-title').textContent = booking ? word('page.fit.title', 'You look like a great fit.') : word('page.guide.title', 'Thanks!')
    var link = $('done-link')
    if (typeof next.url === 'string' && /^https:\/\//.test(next.url)) {
      link.href = next.url
      link.rel = 'noopener'
      link.textContent = booking ? word('page.fit.button', 'Book a time') : word('page.guide.button', 'Get the free guide')
      link.appendChild($('work').querySelector('.arrow').cloneNode(true))
      link.setAttribute('data-next', booking ? 'booking' : 'guide')
      // Stage 6A: the tap is counted (the Monday report's booking clicks) by a beacon to the spine; text/plain, so no
      // preflight. Never waited on and never in the link's way: it opens whatever the beacon does.
      link.onclick = function () {
        try {
          var kind = link.getAttribute('data-next')
          if (kind && navigator.sendBeacon) navigator.sendBeacon(API + '/api/social-lead/click', JSON.stringify({ slug: SLUG, link: kind }))
        } catch (e) { /* the link still opens */ }
      }
      show(link, true)
      show($('done-later'), false)
    } else {
      show(link, false)
      link.removeAttribute('data-next')
      setText('done-later', booking ? word('page.fit.later', "Thanks. I'll be in touch soon.") : word('page.guide.later', 'Thanks.'))
    }
  }

  function send(e) {
    e.preventDefault()
    if (sending || state.result) return // one lead per finished flow; "Work with me" starts a new one
    var body = {
      slug: SLUG,
      name: $('f-name').value.trim(),
      email: $('f-email').value.trim(),
      phone: $('f-phone').value.trim() || null,
      tips: $('f-tips').checked,
      website: $('f-website').value,
    }
    questions.forEach(function (q) { body[q.key] = state.answers[q.key] })
    if (body.name.length < 2 || !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(body.email)) {
      setText('send-failed', word('page.invalid', 'Check your name and email, then try again.'))
      return
    }
    sending = true
    $('send').disabled = true
    setText('send-failed', '')
    post('/api/social-lead/submit', body).then(function (r) {
      if (r.status === 201 && r.data && r.data.ok) {
        // Finished: keep only the result, clear the answers and the contact fields, and let the result take the
        // contact step's place in history so Back and Forward never come back to a filled-in Send.
        state = { answers: {}, result: { fit: r.data.fit === true, next: r.data.next || {} } }
        keep()
        $('contact').reset()
        history.replaceState({ sd: 'done' }, '', url('done'))
        return route(true)
      }
      var key = r.status === 429 ? 'page.rate' : r.status === 400 ? 'page.invalid' : 'page.failed'
      setText('send-failed', word(key, "Couldn't send. Please try again."))
    }, function () {
      setText('send-failed', word('page.failed', "Couldn't send. Please try again."))
    }).then(function () { sending = false; $('send').disabled = false })
  }

  document.addEventListener('DOMContentLoaded', function () {
    recall()
    $('work').addEventListener('click', open)
    $('back').addEventListener('click', back)
    $('question').addEventListener('submit', answer)
    $('contact').addEventListener('submit', send)
    window.addEventListener('popstate', function () { route(true) })
    // Back/forward-cache restore: pick up what this tab kept (a lead sent here stays sent) and show the right step.
    window.addEventListener('pageshow', function (e) { if (e.persisted) { recall(); if (questions.length) route(false) } })
    var deep = viewOf(location.hash) !== 'page'
    load().then(function () { if (deep) route(true) }, function () {
      if (deep) { history.replaceState(null, '', url('page')); route(false) }
      /* the button tries again */
    })
  })
})()

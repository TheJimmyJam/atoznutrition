// A to Z Nutrition's public page. Who she is, her services and the words come from her Social Desk settings
// (POST /api/social-lead/page on the CCC spine, cross-site; only public-safe fields). "Work with me" asks the five
// questions, then a name and email, and posts them (POST /api/social-lead/submit). The spine decides good fit or not
// by her own rule and answers with where to go next: her booking link, or her free guide. No health questions.
(function () {
  'use strict'
  var LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  // The local harness (npm run dev:local in ccc-apps with CCC_DEV_SOCIAL=1) serves the made-up client atoz-local.
  var API = LOCAL ? 'http://localhost:5391' : 'https://clients.cannoncodeconnect.com'
  var SLUG = LOCAL ? 'atoz-local' : 'atoz'

  var $ = function (id) { return document.getElementById(id) }
  var words = {}
  var questions = []
  var answers = {}
  var step = 0
  var sending = false

  function word(key, fallback) { return typeof words[key] === 'string' ? words[key] : fallback }
  function show(el, on) { el.hidden = !on }

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
    if (p.name) { $('name').textContent = p.name; document.title = p.name }
    setText('owner', p.owner_name)
    setText('tagline', p.tagline)
    setText('about', p.about)
    var list = $('service-list')
    list.textContent = ''
    var services = Array.isArray(p.services) ? p.services : []
    for (var i = 0; i < services.length; i++) {
      var li = document.createElement('li')
      li.textContent = services[i]
      list.appendChild(li)
    }
    // Equal columns on a wide screen: two for an even count, three otherwise; one column on a phone.
    list.className = 'grid' + (services.length < 2 ? '' : services.length % 2 === 0 && services.length % 3 !== 0 ? ' two' : ' three')
    show($('services'), services.length > 0)
    var where = $('where')
    where.textContent = p.location || ''
    show(where, !!p.location)
  }

  function load() {
    return post('/api/social-lead/page', { slug: SLUG }).then(function (r) {
      if (r.status !== 200 || !r.data || !r.data.ok) throw new Error('page')
      words = r.data.words || {}
      questions = Array.isArray(r.data.questions) ? r.data.questions : []
      fillWords()
      fillProfile(r.data)
      show($('load-failed'), false)
      return true
    })
  }

  function render() {
    var total = questions.length
    $('step').textContent = step < total ? (step + 1) + ' / ' + total : ''
    show($('back'), step > 0 && step <= total)
    show($('question'), step < total)
    show($('contact'), step === total)
    show($('done'), step > total)
    if (step < total) {
      var q = questions[step]
      $('q-title').textContent = word('page.q.' + q.key, q.key)
      var ul = $('q-options')
      ul.textContent = ''
      q.options.forEach(function (code) {
        var li = document.createElement('li')
        var b = document.createElement('button')
        b.type = 'button'
        b.textContent = word('page.q.' + q.key + '.' + code, code)
        b.setAttribute('data-answer', code)
        if (answers[q.key] === code) b.setAttribute('aria-pressed', 'true')
        b.addEventListener('click', function () { answers[q.key] = code; step++; render() })
        li.appendChild(b)
        ul.appendChild(li)
      })
      var first = ul.querySelector('button')
      if (first) first.focus({ preventScroll: true })
    } else if (step === total) {
      $('f-name').focus({ preventScroll: true })
    }
    window.scrollTo(0, 0)
  }

  function open() {
    var start = function () {
      answers = {}
      step = 0
      show($('profile'), false)
      show($('flow'), true)
      render()
    }
    if (questions.length) return start()
    load().then(start, function () { setText('load-failed', word('page.failed', "Couldn't load. Please try again.")) })
  }

  function close() {
    show($('flow'), false)
    show($('profile'), true)
    $('contact').reset()
    setText('send-failed', '')
    $('work').focus({ preventScroll: true })
  }

  function finish(data) {
    step = questions.length + 1
    var next = data.next || {}
    var booking = data.fit === true && next.kind === 'booking'
    $('done-title').textContent = booking ? word('page.fit.title', 'You look like a great fit.') : word('page.guide.title', 'Thanks!')
    var link = $('done-link')
    if (typeof next.url === 'string' && /^https:\/\//.test(next.url)) {
      link.href = next.url
      link.rel = 'noopener'
      link.textContent = booking ? word('page.fit.button', 'Book a time') : word('page.guide.button', 'Get the free guide')
      link.setAttribute('data-next', booking ? 'booking' : 'guide')
      show(link, true)
      show($('done-later'), false)
    } else {
      show(link, false)
      setText('done-later', booking ? word('page.fit.later', "Thanks. I'll be in touch soon.") : word('page.guide.later', 'Thanks.'))
    }
    render()
  }

  function send(e) {
    e.preventDefault()
    if (sending) return
    var body = {
      slug: SLUG,
      name: $('f-name').value.trim(),
      email: $('f-email').value.trim(),
      phone: $('f-phone').value.trim() || null,
      tips: $('f-tips').checked,
      website: $('f-website').value,
    }
    questions.forEach(function (q) { body[q.key] = answers[q.key] })
    if (body.name.length < 2 || !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(body.email)) {
      setText('send-failed', word('page.invalid', 'Check your name and email, then try again.'))
      return
    }
    sending = true
    $('send').disabled = true
    setText('send-failed', '')
    post('/api/social-lead/submit', body).then(function (r) {
      if (r.status === 201 && r.data && r.data.ok) return finish(r.data)
      var key = r.status === 429 ? 'page.rate' : r.status === 400 ? 'page.invalid' : 'page.failed'
      setText('send-failed', word(key, "Couldn't send. Please try again."))
    }, function () {
      setText('send-failed', word('page.failed', "Couldn't send. Please try again."))
    }).then(function () { sending = false; $('send').disabled = false })
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('work').addEventListener('click', open)
    $('close').addEventListener('click', close)
    $('back').addEventListener('click', function () { if (step > 0) { step--; render() } })
    $('contact').addEventListener('submit', send)
    load().catch(function () { /* the button tries again */ })
  })
})()

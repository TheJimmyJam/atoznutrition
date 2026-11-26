// The GLP-1 "Start here" page's content, in one place: real lessons, a new track or the home-page link are a data
// change here, not a code change. Loaded as a script (the site's CSP allows no same-origin fetch), and read by the
// node tests. Nothing here is personal; nothing typed on the page is ever written back.
;(function (root) {
  'use strict'
  var config = {
    practice: 'A to Z Nutrition',
    // false: /glp1 is unlinked from the home page (and noindex). Set true when Jimmy says to publish it.
    homeLink: false,
    // Her Practice Better program link (https). Until it exists, "Get the full protocol" opens the booking step.
    protocolUrl: null,
    // The booking step on the home page: the qualifier, which ends at her booking link for a good fit.
    bookUrl: '/#q1',
    fixedLine: 'Education, not medical advice. Anne is a nutritionist, not a prescriber. Talk to your prescriber about your medication and before changing how you eat, train or take supplements.',
    // Grams of protein per kg of body weight per day (Anne to confirm her formula), rounded to the nearest roundTo g.
    protein: { lowPerKg: 1.2, highPerKg: 1.6, roundTo: 5, meals: 3 },
    proteinCaution: 'Ask your prescriber first if you have kidney disease, are pregnant or breastfeeding.',
    tracks: [
      { id: 'business', label: 'Business professionals', day: 'Protein at breakfast, a packed lunch for meeting days and a 20-minute lift before work.' },
      { id: 'moms', label: 'Stay-at-home moms', day: 'Protein prepped in one batch on Sunday, small meals alongside the kids and a short workout at nap time.' },
      { id: 'men40', label: 'Men 40+', day: 'Protein at every meal, heavier lifts twice a week and a full rest day for recovery.' },
      { id: 'travel', label: 'Travellers', day: 'Protein snacks in your bag, an airport meal built around protein and a hotel-room workout.' },
      { id: 'weights', label: 'Weight training', day: 'A full-body routine three days a week, protein after each session and water through the day.' },
    ],
    // Stand-ins until Anne records: sample: true shows sampleLabel on the card.
    sampleLabel: "Sample, Anne's lesson coming soon",
    lessons: [
      { id: 'start-here', title: 'Start here', src: '/glp1/media/start-here.mp4', poster: '/glp1/media/start-here.jpg', captions: '/glp1/media/start-here.vtt', sample: true },
      { id: 'protein', title: 'Protein across the day', src: '/glp1/media/protein.mp4', poster: '/glp1/media/protein.jpg', captions: '/glp1/media/protein.vtt', sample: true },
      { id: 'hard-days', title: 'Small meals and hard days', src: '/glp1/media/hard-days.mp4', poster: '/glp1/media/hard-days.jpg', captions: '/glp1/media/hard-days.vtt', sample: true },
    ],
  }
  if (typeof module === 'object' && module.exports) module.exports = config
  else root.GLP1_CONFIG = config
})(this)

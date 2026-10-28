// Chili dog meter: the energy and water of making Blast Grid with Claude, against making chili dogs.
// Shared by footprint/index.html (pick the parts of each life cycle to count) and tools/footprint.py (via node:
// draws footprint/chilidogs.svg and the README figures). Ranges are [low, middle, high]; sources in README.md.
(function (root) {
  const KWH_MJ = 1 / 3.6;
  // electricity counted at the power station: EU default primary energy factor (2024-25 average, delegated act 2022)
  const PEF = 1.9;
  // water consumed generating a kWh (Shehabi et al. 2016: US average, 2003 generation mix)
  const GEN_WATER = 7.6;
  // Google, median Gemini prompt: 0.26 mL of cooling water for 0.24 Wh
  const SITE_WATER = 0.26 / 0.24;
  // mWh per token [low, mid, high]: new input, cache writes, cache reads, output
  const TOKEN_MWH = { inp: [0.10, 0.17, 0.25], cw: [0.10, 0.17, 0.25], cr: [0.001, 0.004, 0.01], out: [0.5, 1.5, 5] };

  function inferenceKwh(ledger) {
    const b = ledger.baseline, m = ledger.measured;
    return [0, 1, 2].map(i => (b.calls[i] * b.whPerCall[i] + ['inp', 'cw', 'cr', 'out'].reduce((s, k) => s + (m[k] || 0) * TOKEN_MWH[k][i], 0) / 1000) / 1000);
  }

  // Each part gives electricity (kWh, delivered), other energy (kWh primary, already at the source), blue water (L),
  // and green + grey water (L: rain on fields and water to dilute run-off), as [low, mid, high] or numbers.
  function parts(ledger) {
    const inf = inferenceKwh(ledger), tr = inf.map(x => x * 2 / 3);
    return {
      ai: [
        { id: 'inference', name: 'Running the model', note: 'every call Claude made, with the data centre around it',
          elec: inf, water: inf.map(x => x * SITE_WATER), on: true },
        { id: 'training', name: 'Training the model (its share)', note: "Google's machine learning energy: 2/5 training, 3/5 use",
          elec: tr, water: tr.map(x => x * SITE_WATER), on: true },
        { id: 'hardware', name: 'Making the chips and servers', note: "rough: Mistral's life cycle study (11% of emissions, 5% of water)",
          elec: inf.map((x, i) => (x + tr[i]) * 11 / 85.5), water: inf.map((x, i) => (x + tr[i]) * SITE_WATER * 5 / 91), on: true },
        { id: 'tests', name: 'The cloud machine running the emulator and tests', note: 'about 40 hours',
          elec: [1, 1.5, 2], water: [1, 1.5, 2].map(x => x * SITE_WATER), on: true },
      ],
      // one chili dog, ingredient by ingredient (grams; per kg of the food as eaten: energy MJ [low, mid, high], water
      // drawn L, rain and run-off L). `veg` is the vegan swap.
      dog: [
        { id: 'bun', name: 'Bun', g: 50, e: [8.9, 10, 13], drawn: 647.5, rain: 1447, on: true,
          note: 'wheat bread; usually vegan already' },
        { id: 'sausage', name: 'Beef frank', g: 50, e: [70, 72, 75], drawn: 1451.2, rain: 14798, on: true,
          note: 'beef, cooked', veg: { name: 'Plant-based sausage', e: [38, 39, 41], drawn: 396.6, rain: 4548,
            note: 'pea protein: 46% less energy than beef (Beyond Burger study); water as peas (rough)' } },
        { id: 'meat', name: 'Beef in the chili', g: 25, e: [70, 72, 75], drawn: 1451.2, rain: 14798, on: true,
          note: 'minced beef, cooked', veg: { name: 'Plant mince in the chili', e: [38, 39, 41], drawn: 396.6, rain: 4548,
            note: 'as the plant-based sausage' } },
        { id: 'beans', name: 'Beans in the chili', g: 20, e: [16, 18, 20], drawn: 174.3, rain: 1819, on: true,
          note: 'canned kidney beans (2.5 times the weight of dry)' },
        { id: 'tomato', name: 'Tomato in the chili', g: 15, e: [14, 14, 14], drawn: 369.8, rain: 193, on: true,
          note: 'canned tomato' },
        { id: 'chiliOnion', name: 'Onion in the chili', g: 5, e: [3, 5.4, 8], drawn: 14.3, rain: 308, on: true,
          note: 'energy assumed as fresh field vegetables' },
        { id: 'cheese', name: 'Grated cheese on top', g: 15, e: [60, 62, 65], drawn: 5605.2, rain: 2860, on: false,
          note: 'cheddar', veg: { name: 'Vegan cheese on top', e: [20, 21, 22], drawn: 3363, rain: 1716,
            note: 'coconut oil and starch: 40% less water than dairy (Violife study); energy a third of dairy, as its emissions (rough)' } },
        { id: 'onion', name: 'Chopped onion on top', g: 10, e: [3, 5.4, 8], drawn: 14.3, rain: 308, on: false,
          note: 'raw onion' },
      ],
      options: [
        { id: 'vegan', name: 'Make it vegan', note: 'plant-based sausage and mince, and vegan cheese if it has cheese', on: false },
        { id: 'pef', name: 'Count electricity at the power station', note: `times ${PEF}: the fuel burned for each kWh delivered, as the food figures count it`, on: true },
        { id: 'genwater', name: 'Water used at the power station', note: `${GEN_WATER} L a kWh, both sides`, on: true },
        { id: 'green', name: 'Rain on the fields and water to dilute run-off', note: 'only the food has these, so they make each chili dog thirstier and the game worth fewer chili dogs of water', on: false },
      ],
    };
  }

  const at = (v, i) => Array.isArray(v) ? v[i] : (v || 0);
  // an ingredient as eaten, vegan or not: the energy (kWh at the source), water drawn and rain and run-off (L)
  function food(p, vegan) {
    const q = vegan && p.veg ? p.veg : p, kg = p.g / 1000;
    return { name: q.name, note: q.note, other: q.e.map(x => kg * x * KWH_MJ), water: kg * q.drawn, green: kg * q.rain };
  }
  // totals for one side, i = 0 low, 1 mid, 2 high
  function side(list, opt, i) {
    let e = 0, w = 0;
    for (const p0 of list) {
      if (!p0.on) continue;
      const p = p0.g ? food(p0, opt.vegan) : p0, el = at(p.elec, i);
      e += el * (opt.pef ? PEF : 1) + at(p.other, i);
      w += at(p.water, i) + (opt.genwater ? el * GEN_WATER : 0) + (opt.green ? at(p.green, i) : 0);
    }
    return { e, w };
  }
  function compute(P) {
    const opt = Object.fromEntries(P.options.map(o => [o.id, o.on]));
    const dog = side(P.dog, opt, 1);
    return [0, 1, 2].map(i => {
      const ai = side(P.ai, opt, i);
      return { aiKwh: ai.e, aiL: ai.w, dogKwh: dog.e, dogL: dog.w, energyDogs: dog.e > 0 ? ai.e / dog.e : 0, waterDogs: dog.w > 0 ? ai.w / dog.w : 0, opt };
    });
  }

  // one chili dog, our own drawing: 64 x 36
  const DOG = '<path d="M4 18c0 9 12 15 28 15s28-6 28-15z" fill="#d9a05a" stroke="#7a4a1f" stroke-width="2"/>' +
    '<rect x="1" y="11" width="62" height="10" rx="5" fill="#b8432c" stroke="#6e2414" stroke-width="2"/>' +
    '<path d="M9 13c3-6 7-2 10-5s6 1 9-2 7 2 10-1 6 1 9-1 5 3 8 4c1 3-2 5-4 5H12c-3 0-5-2-3-5z" fill="#7b3a1c" stroke="#4a200c" stroke-width="1.5"/>' +
    '<circle cx="18" cy="12" r="1.6" fill="#c9673a"/><circle cx="31" cy="10" r="1.6" fill="#c9673a"/><circle cx="44" cy="11" r="1.6" fill="#c9673a"/>' +
    '<path d="M14 15l2-1M26 14l2 1M38 15l2-1M49 14l2 1" stroke="#fff3c4" stroke-width="1.6" stroke-linecap="round"/>';

  // a row of dogs, the last one cut to its fraction; returns [svg, height]
  function dogRow(n, x0, y0, per, size, id) {
    let s = '', k = 0;
    const whole = Math.floor(n + 1e-9), frac = n - whole, sc = size / 64, h = 36 * sc;
    const place = j => [x0 + (j % per) * (size + 6), y0 + Math.floor(j / per) * (h + 8)];
    for (; k < whole; k++) { const [x, y] = place(k); s += `<g transform="translate(${x} ${y}) scale(${sc})">${DOG}</g>`; }
    if (frac > 0.005) {
      const [x, y] = place(k);
      s += `<clipPath id="${id}"><rect x="0" y="-2" width="${(64 * frac).toFixed(1)}" height="40"/></clipPath>` +
        `<g transform="translate(${x} ${y}) scale(${sc})"><g clip-path="url(#${id})">${DOG}</g></g>`;
      k++;
    }
    const rows = Math.max(1, Math.ceil(k / per));
    return [s, rows * (h + 8)];
  }
  const fmt = x => x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2);
  const plural = x => Math.abs(x - 1) < 0.05 ? 'chili dog' : 'chili dogs';

  function chartSvg(r, opts = {}) {
    const W = opts.width || 640, size = 54, per = Math.floor((W - 40) / (size + 6));
    const m = r[1];
    let y = opts.noTitle ? 30 : 58, body = '';
    const rows = [
      ['Energy', m.energyDogs, `${fmt(m.aiKwh)} kWh${m.opt.pef ? ' of fuel' : ''} against ${fmt(m.dogKwh)} kWh a chili dog (${fmt(r[0].energyDogs)} to ${fmt(r[2].energyDogs)})`],
      ['Water', m.waterDogs, `${fmt(m.aiL)} L${m.opt.green ? '' : ' drawn'} against ${fmt(m.dogL)} L a chili dog (${fmt(r[0].waterDogs)} to ${fmt(r[2].waterDogs)})`],
    ];
    rows.forEach(([label, n, sub], q) => {
      body += `<text x="20" y="${y}" class="l">${label}: ${fmt(n)} ${plural(n)}</text>`;
      body += `<text x="20" y="${y + 18}" class="s">${sub}</text>`;
      const [s, h] = dogRow(Math.min(n, 200), 20, y + 30, per, size, 'c' + q + (opts.idSuffix || ''));
      body += s; y += 30 + h + 22;
    });
    const H = y + (opts.footer ? 10 : -4);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Making this game has cost ${fmt(m.energyDogs)} chili dogs of energy and ${fmt(m.waterDogs)} of water">` +
      `<style>.t{font:700 20px Helvetica,Arial,sans-serif;fill:#ffd34d}.l{font:700 16px Helvetica,Arial,sans-serif;fill:#fff}.s{font:13px Helvetica,Arial,sans-serif;fill:#b9c3e6}</style>` +
      `<rect width="${W}" height="${H}" rx="14" fill="#1b2142"/>` +
      (opts.noTitle ? '' : `<text x="20" y="32" class="t">Chili dog meter</text>`) +
      (opts.updated ? `<text x="${W - 20}" y="32" class="s" text-anchor="end">updated ${opts.updated}</text>` : '') +
      body + '</svg>';
  }

  // The meter's own cost: the calls spent making it (ledger `meter`) taken out, the difference with the parts and
  // options as given. Returns [low, mid, high].
  function meterEffect(ledger, P0) {
    const less = JSON.parse(JSON.stringify(ledger)), mt = ledger.meter || {};
    for (const k of ['inp', 'cw', 'cr', 'out']) less.measured[k] = (less.measured[k] || 0) - (mt[k] || 0);
    const keep = P => { const Q = parts(less); for (const k of ['ai', 'dog', 'options']) Q[k].forEach((p, j) => { p.on = P[k][j].on; }); return Q; };
    const full = compute(P0 || parts(ledger)), cut = compute(keep(P0 || parts(ledger)));
    return full.map((f, i) => ({ calls: mt.calls || 0, kwh: f.aiKwh - cut[i].aiKwh, litres: f.aiL - cut[i].aiL,
      energyDogs: f.energyDogs - cut[i].energyDogs, waterDogs: f.waterDogs - cut[i].waterDogs }));
  }

  const api = { parts, compute, food, chartSvg, inferenceKwh, meterEffect, fmt, PEF, GEN_WATER, SITE_WATER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FootprintModel = api;

  // node footprint/model.js tools/footprint.json footprint/chilidogs.svg -> prints the default figures as JSON
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    const fs = require('fs'), [ledgerPath, svgPath] = process.argv.slice(2);
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')), r = compute(parts(ledger));
    const day = new Date(ledger.measured.until).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Adelaide' });
    fs.writeFileSync(svgPath, chartSvg(r, { updated: day }));
    const pe = meterEffect(ledger)[1];
    console.log(JSON.stringify({ r, day, page: { dogs: pe.energyDogs, water: pe.waterDogs, kwh: pe.kwh, litres: pe.litres, calls: pe.calls } }));
  }
})(typeof window !== 'undefined' ? window : globalThis);

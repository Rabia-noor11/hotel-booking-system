// Bonus feature: seasonal / dynamic pricing + discount codes.
// Mounted from app.js:  const pricing = require('./pricing-rules')(app, { db, auth, wrap, err });
const { nights, validateDates, TAX_RATE } = require('./pricing');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const addDay = (s, i) => new Date(Date.parse(s + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10);

module.exports = function (app, { db, auth, wrap, err }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_rules(id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN('weekend','season')), multiplier REAL NOT NULL,
      start_date TEXT, end_date TEXT, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS discount_codes(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      percent REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1);
  `);
  // Keep the price breakdown on the booking so invoices never change when rules change later.
  const have = db.prepare('PRAGMA table_info(bookings)').all().map(c => c.name);
  [['room_subtotal', 'REAL'], ['discount', 'REAL DEFAULT 0'], ['promo_code', 'TEXT']]
    .forEach(([n, t]) => { if (!have.includes(n)) db.exec(`ALTER TABLE bookings ADD COLUMN ${n} ${t}`); });

  // Price multiplier for one night. Weekend = Friday and Saturday nights.
  // If several rules match, the highest multiplier wins.
  function multiplierFor(day, rules) {
    const dow = new Date(day + 'T00:00:00Z').getUTCDay();
    let m = null;
    for (const r of rules) {
      const hit = r.kind === 'weekend' ? (dow === 5 || dow === 6) : (day >= r.start_date && day <= r.end_date);
      if (hit && (m === null || r.multiplier > m)) m = r.multiplier;
    }
    return m ?? 1;
  }

  // Full price breakdown. Each night is priced separately, then the discount applies to the
  // room subtotal, and tax applies to (room - discount + services).
  function quote(rate, ci, co, services = [], code) {
    const n = nights(ci, co);
    const rules = db.prepare('SELECT * FROM price_rules WHERE active=1').all();
    let subtotal = 0;
    for (let i = 0; i < n; i++) subtotal += rate * multiplierFor(addDay(ci, i), rules);
    subtotal = +subtotal.toFixed(2);
    let percent = 0, applied = null;
    if (code) {
      const c = db.prepare('SELECT * FROM discount_codes WHERE code=? AND active=1').get(String(code).trim().toUpperCase());
      if (!c) throw err(400, 'Invalid or inactive discount code');
      percent = c.percent; applied = c.code;
    }
    const discount = +(subtotal * percent / 100).toFixed(2);
    const extra = +services.reduce((s, x) => s + x.price * x.qty, 0).toFixed(2);
    const tax = +((subtotal - discount + extra) * TAX_RATE).toFixed(2);
    return { nights: n, subtotal, discount, extra, tax, total: +(subtotal - discount + extra + tax).toFixed(2), code: applied };
  }

  // Breakdown of an existing booking (uses the saved subtotal/discount, falls back for old rows).
  function fromBooking(b, services = []) {
    const n = nights(b.check_in, b.check_out);
    const subtotal = b.room_subtotal ?? +(b.rate * n).toFixed(2);
    const discount = b.discount || 0;
    const extra = +services.reduce((s, x) => s + x.price * x.qty, 0).toFixed(2);
    const tax = +((subtotal - discount + extra) * TAX_RATE).toFixed(2);
    return { nights: n, subtotal, discount, extra, tax, total: +(subtotal - discount + extra + tax).toFixed(2), code: b.promo_code || null };
  }

  // ---- live price preview for the booking summary page ----
  app.post('/api/quote', wrap((q, r) => {
    const b = q.body || {};
    const room = db.prepare('SELECT price FROM rooms WHERE id=?').get(+b.room_id);
    if (!room) throw err(404, 'Room not found');
    const e = validateDates(b.check_in, b.check_out); if (e) throw err(400, e);
    const svc = (b.services || []).map(s => {
      const row = db.prepare('SELECT price FROM services WHERE id=?').get(+s.id); const qty = +s.qty || 1;
      if (!row || qty < 1 || qty > 10) throw err(400, 'Invalid service'); return { price: row.price, qty };
    });
    r.json(quote(room.price, b.check_in, b.check_out, svc, b.promo_code));
  }));

  // ---- admin: price rules ----
  function ruleBody(b) {
    const x = { name: String(b.name || '').trim(), kind: b.kind, multiplier: +b.multiplier, start_date: b.start_date || null, end_date: b.end_date || null, active: b.active === false || b.active === 0 ? 0 : 1 };
    if (!x.name) throw err(400, 'Rule name required');
    if (!['weekend', 'season'].includes(x.kind)) throw err(400, 'Rule type must be weekend or season');
    if (!(x.multiplier >= 0.5 && x.multiplier <= 5)) throw err(400, 'Multiplier must be between 0.5 and 5');
    if (x.kind === 'season') {
      if (!ISO.test(x.start_date || '') || !ISO.test(x.end_date || '')) throw err(400, 'Season needs start and end dates');
      if (x.end_date < x.start_date) throw err(400, 'End date must not be before start date');
    } else { x.start_date = x.end_date = null; }
    return x;
  }
  app.get('/api/price-rules', auth('admin'), wrap((q, r) => r.json(db.prepare('SELECT * FROM price_rules ORDER BY id DESC').all())));
  app.post('/api/price-rules', auth('admin'), wrap((q, r) => {
    const x = ruleBody(q.body);
    r.status(201).json({ id: db.prepare('INSERT INTO price_rules(name,kind,multiplier,start_date,end_date,active) VALUES(?,?,?,?,?,?)').run(x.name, x.kind, x.multiplier, x.start_date, x.end_date, x.active).lastInsertRowid });
  }));
  app.put('/api/price-rules/:id', auth('admin'), wrap((q, r) => {
    const x = ruleBody(q.body);
    if (!db.prepare('UPDATE price_rules SET name=?,kind=?,multiplier=?,start_date=?,end_date=?,active=? WHERE id=?').run(x.name, x.kind, x.multiplier, x.start_date, x.end_date, x.active, +q.params.id).changes) throw err(404, 'Rule not found');
    r.json({ ok: true });
  }));
  app.delete('/api/price-rules/:id', auth('admin'), wrap((q, r) => { db.prepare('DELETE FROM price_rules WHERE id=?').run(+q.params.id); r.json({ ok: true }); }));

  // ---- admin: discount codes ----
  function codeBody(b) {
    const x = { code: String(b.code || '').trim().toUpperCase(), percent: +b.percent, active: b.active === false || b.active === 0 ? 0 : 1 };
    if (!/^[A-Z0-9]{3,20}$/.test(x.code)) throw err(400, 'Code must be 3-20 letters or digits');
    if (!(x.percent >= 1 && x.percent <= 90)) throw err(400, 'Discount must be between 1 and 90 percent');
    return x;
  }
  app.get('/api/discount-codes', auth('admin'), wrap((q, r) => r.json(db.prepare('SELECT * FROM discount_codes ORDER BY id DESC').all())));
  app.post('/api/discount-codes', auth('admin'), wrap((q, r) => {
    const x = codeBody(q.body);
    r.status(201).json({ id: db.prepare('INSERT INTO discount_codes(code,percent,active) VALUES(?,?,?)').run(x.code, x.percent, x.active).lastInsertRowid });
  }));
  app.put('/api/discount-codes/:id', auth('admin'), wrap((q, r) => {
    const x = codeBody(q.body);
    if (!db.prepare('UPDATE discount_codes SET code=?,percent=?,active=? WHERE id=?').run(x.code, x.percent, x.active, +q.params.id).changes) throw err(404, 'Code not found');
    r.json({ ok: true });
  }));
  app.delete('/api/discount-codes/:id', auth('admin'), wrap((q, r) => { db.prepare('DELETE FROM discount_codes WHERE id=?').run(+q.params.id); r.json({ ok: true }); }));

  return { quote, fromBooking };
};

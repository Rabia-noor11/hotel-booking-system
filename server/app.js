require('dotenv').config();
const express = require('express'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'),
  multer = require('multer'), PDF = require('pdfkit'), path = require('path'), fs = require('fs');
const db = require('./db');
const { nights, validateDates, total, todayStr } = require('./pricing');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const UP = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UP, { recursive: true });
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const err = (s, m) => Object.assign(new Error(m), { status: s });
const wrap = f => (q, r, n) => { try { f(q, r, n); } catch (e) { n(e); } };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const token = u => jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '7d' });
const auth = (...roles) => (q, r, n) => {
  try { q.user = jwt.verify((q.headers.authorization || '').slice(7), SECRET); }
  catch { return r.status(401).json({ error: 'Please login first' }); }
  if (roles.length && !roles.includes(q.user.role)) return r.status(403).json({ error: 'You do not have permission' });
  n();
};
const STAFF = ['receptionist', 'admin'];
require('./reviews')(app, { db, auth, wrap, err });
const pricing = require('./pricing-rules')(app, { db, auth, wrap, err });

// ---------- seed ----------
if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) {
  const u = db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)');
  u.run('Admin', 'admin@hotel.com', bcrypt.hashSync('Admin@123', 10), 'admin');
  u.run('Reception', 'reception@hotel.com', bcrypt.hashSync('Reception@123', 10), 'receptionist');
  const rm = db.prepare('INSERT INTO rooms(number,type,price,capacity,amenities) VALUES(?,?,?,?,?)');
  rm.run('101', 'Single', 60, 1, 'WiFi, TV, AC'); rm.run('102', 'Double', 95, 2, 'WiFi, TV, AC, Mini bar');
  rm.run('201', 'Deluxe', 140, 3, 'WiFi, TV, AC, Balcony'); rm.run('301', 'Suite', 260, 4, 'WiFi, TV, AC, Jacuzzi, Lounge');
  const sv = db.prepare('INSERT INTO services(name,price) VALUES(?,?)');
  sv.run('Room service', 15); sv.run('Laundry', 10); sv.run('Spa session', 45);
}

// ---------- auth ----------
app.post('/api/auth/signup', wrap((q, r) => {
  const { name, email, password, phone } = q.body;
  if (!name || name.trim().length < 2) throw err(400, 'Name must be at least 2 characters');
  if (!EMAIL.test(email || '')) throw err(400, 'Valid email required');
  if (!password || password.length < 6) throw err(400, 'Password must be at least 6 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) throw err(409, 'Email already registered');
  const id = db.prepare('INSERT INTO users(name,email,phone,password) VALUES(?,?,?,?)')
    .run(name.trim(), email.toLowerCase(), phone || '', bcrypt.hashSync(password, 10)).lastInsertRowid;
  const user = { id, name: name.trim(), role: 'guest' };
  r.status(201).json({ token: token(user), user });
}));
app.post('/api/auth/login', wrap((q, r) => {
  const { email, password } = q.body;
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password)) throw err(401, 'Invalid email or password');
  const user = { id: u.id, name: u.name, role: u.role };
  r.json({ token: token(user), user });
}));

// ---------- rooms ----------
const COLS = `id,number,type,price,capacity,amenities,images,
 CASE WHEN rooms.status='Available' AND EXISTS(SELECT 1 FROM bookings b WHERE b.room_id=rooms.id AND b.status='Confirmed' AND date('now')>=b.check_in AND date('now')<b.check_out)
 THEN 'Booked' ELSE rooms.status END AS status`;
const parse = r => ({ ...r, images: JSON.parse(r.images || '[]') });

app.get('/api/rooms', wrap((q, r) => {
  const { check_in, check_out, type, min, max, capacity } = q.query;
  let sql = `SELECT ${COLS} FROM rooms WHERE 1=1`; const p = [];
  if (check_in || check_out) {
    const e = validateDates(check_in, check_out); if (e) throw err(400, e);
    sql += ` AND rooms.status!='Maintenance' AND id NOT IN(SELECT room_id FROM bookings WHERE status IN('Confirmed','CheckedIn') AND check_in<? AND check_out>?)`;
    p.push(check_out, check_in);
  }
  if (type) { sql += ' AND type=?'; p.push(type); }
  if (min) { sql += ' AND price>=?'; p.push(+min); }
  if (max) { sql += ' AND price<=?'; p.push(+max); }
  if (capacity) { sql += ' AND capacity>=?'; p.push(+capacity); }
  r.json(db.prepare(sql + ' ORDER BY price').all(...p).map(parse));
}));
app.get('/api/rooms/:id', wrap((q, r) => {
  const x = db.prepare(`SELECT ${COLS} FROM rooms WHERE id=?`).get(+q.params.id);
  if (!x) throw err(404, 'Room not found'); r.json(parse(x));
}));
function roomBody(b) {
  const x = { number: String(b.number || '').trim(), type: b.type, price: +b.price, capacity: +b.capacity, amenities: b.amenities || '' };
  if (!x.number) throw err(400, 'Room number required');
  if (!['Single', 'Double', 'Deluxe', 'Suite'].includes(x.type)) throw err(400, 'Invalid room type');
  if (!(x.price > 0)) throw err(400, 'Price must be greater than 0');
  if (!Number.isInteger(x.capacity) || x.capacity < 1) throw err(400, 'Capacity must be at least 1');
  return x;
}
app.post('/api/rooms', auth('admin'), wrap((q, r) => {
  const x = roomBody(q.body);
  const id = db.prepare('INSERT INTO rooms(number,type,price,capacity,amenities) VALUES(?,?,?,?,?)').run(x.number, x.type, x.price, x.capacity, x.amenities).lastInsertRowid;
  r.status(201).json({ id });
}));
app.put('/api/rooms/:id', auth('admin'), wrap((q, r) => {
  const x = roomBody(q.body);
  if (!db.prepare('UPDATE rooms SET number=?,type=?,price=?,capacity=?,amenities=? WHERE id=?').run(x.number, x.type, x.price, x.capacity, x.amenities, +q.params.id).changes) throw err(404, 'Room not found');
  r.json({ ok: true });
}));
app.delete('/api/rooms/:id', auth('admin'), wrap((q, r) => {
  if (!db.prepare('DELETE FROM rooms WHERE id=?').run(+q.params.id).changes) throw err(404, 'Room not found'); r.json({ ok: true });
}));
app.patch('/api/rooms/:id/status', auth(...STAFF), wrap((q, r) => {
  if (!['Available', 'Occupied', 'Cleaning', 'Maintenance'].includes(q.body.status)) throw err(400, 'Invalid status');
  if (!db.prepare('UPDATE rooms SET status=? WHERE id=?').run(q.body.status, +q.params.id).changes) throw err(404, 'Room not found');
  r.json({ ok: true });
}));
const upload = multer({
  storage: multer.diskStorage({ destination: UP, filename: (q, f, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(f.originalname).toLowerCase()) }),
  limits: { fileSize: 2 * 1024 * 1024, files: 5 },
  fileFilter: (q, f, cb) => /^image\/(jpeg|png|webp)$/.test(f.mimetype) ? cb(null, true) : cb(err(400, 'Only JPG, PNG or WEBP images are allowed'))
});
app.post('/api/rooms/:id/images', auth('admin'), upload.array('images', 5), wrap((q, r) => {
  const room = db.prepare('SELECT images FROM rooms WHERE id=?').get(+q.params.id);
  if (!room) throw err(404, 'Room not found');
  const imgs = [...JSON.parse(room.images), ...q.files.map(f => '/uploads/' + f.filename)];
  db.prepare('UPDATE rooms SET images=? WHERE id=?').run(JSON.stringify(imgs), +q.params.id);
  r.json({ images: imgs });
}));

// ---------- services ----------
app.get('/api/services', wrap((q, r) => r.json(db.prepare('SELECT * FROM services ORDER BY name').all())));
function svcBody(b) {
  if (!b.name || !String(b.name).trim()) throw err(400, 'Service name required');
  if (!(+b.price > 0)) throw err(400, 'Price must be greater than 0');
  return [String(b.name).trim(), +b.price];
}
app.post('/api/services', auth('admin'), wrap((q, r) => { const [n, p] = svcBody(q.body); r.status(201).json({ id: db.prepare('INSERT INTO services(name,price) VALUES(?,?)').run(n, p).lastInsertRowid }); }));
app.put('/api/services/:id', auth('admin'), wrap((q, r) => { const [n, p] = svcBody(q.body); db.prepare('UPDATE services SET name=?,price=? WHERE id=?').run(n, p, +q.params.id); r.json({ ok: true }); }));
app.delete('/api/services/:id', auth('admin'), wrap((q, r) => { db.prepare('DELETE FROM services WHERE id=?').run(+q.params.id); r.json({ ok: true }); }));

// ---------- bookings ----------
const BK = `SELECT b.*,r.number room_number,r.type room_type,u.name guest_name,u.email guest_email FROM bookings b JOIN rooms r ON r.id=b.room_id JOIN users u ON u.id=b.user_id`;
// Insert (id undefined) or update (id given). better-sqlite3 is synchronous and this runs in a
// transaction, so the overlap check and the write cannot be interleaved with another request.
const save = db.transaction((uid, b, id) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(+b.room_id);
  if (!room) throw err(404, 'Room not found');
  const e = validateDates(b.check_in, b.check_out); if (e) throw err(400, e);
  const guests = +b.guests;
  if (!Number.isInteger(guests) || guests < 1) throw err(400, 'Guests must be at least 1');
  if (guests > room.capacity) throw err(400, `Room capacity is ${room.capacity}`);
  if (room.status === 'Maintenance') throw err(409, 'Room is under maintenance');
  const clash = db.prepare(`SELECT 1 FROM bookings WHERE room_id=? AND status IN('Confirmed','CheckedIn') AND check_in<? AND check_out>? AND id!=?`)
    .get(room.id, b.check_out, b.check_in, id || 0);
  if (clash) throw err(409, 'Room is already booked for these dates');
  const svc = (b.services || []).map(s => {
    const row = db.prepare('SELECT * FROM services WHERE id=?').get(+s.id); const qty = +s.qty || 1;
    if (!row || qty < 1 || qty > 10) throw err(400, 'Invalid service'); return { id: row.id, price: row.price, qty };
  });
  const t = pricing.quote(room.price, b.check_in, b.check_out, svc, b.promo_code ?? (id ? db.prepare('SELECT promo_code FROM bookings WHERE id=?').get(id).promo_code : null));
  if (id) {
    db.prepare('UPDATE bookings SET room_id=?,check_in=?,check_out=?,guests=?,rate=?,total=? WHERE id=?').run(room.id, b.check_in, b.check_out, guests, room.price, t.total, id);
    db.prepare('DELETE FROM booking_services WHERE booking_id=?').run(id);
  } else {
    id = db.prepare('INSERT INTO bookings(user_id,room_id,check_in,check_out,guests,rate,total) VALUES(?,?,?,?,?,?,?)').run(uid, room.id, b.check_in, b.check_out, guests, room.price, t.total).lastInsertRowid;
  }
  svc.forEach(s => db.prepare('INSERT INTO booking_services VALUES(?,?,?)').run(id, s.id, s.qty));
  db.prepare('UPDATE bookings SET room_subtotal=?,discount=?,promo_code=? WHERE id=?').run(t.subtotal, t.discount, t.code, id);
  return id;
});
function owned(q) {
  const b = db.prepare(BK + ' WHERE b.id=?').get(+q.params.id);
  if (!b) throw err(404, 'Booking not found');
  if (q.user.role === 'guest' && b.user_id !== q.user.id) throw err(403, 'You do not have permission');
  return b;
}
app.post('/api/bookings', auth(), wrap((q, r) => {
  let uid = q.user.id;
  if (STAFF.includes(q.user.role)) { // walk-in booking
    const email = String(q.body.guest_email || '').toLowerCase();
    if (!EMAIL.test(email)) throw err(400, 'Guest email required for walk-in booking');
    let g = db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (!g) g = { id: db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(q.body.guest_name || email, email, bcrypt.hashSync(Math.random().toString(36), 10)).lastInsertRowid };
    uid = g.id;
  }
  r.status(201).json({ id: save(uid, q.body) });
}));
app.get('/api/bookings/mine', auth(), wrap((q, r) => r.json(db.prepare(BK + ' WHERE b.user_id=? ORDER BY b.id DESC').all(q.user.id))));
app.get('/api/bookings', auth(...STAFF), wrap((q, r) => r.json(db.prepare(BK + ' ORDER BY b.id DESC').all())));
app.put('/api/bookings/:id', auth(), wrap((q, r) => {
  const old = owned(q);
  if (old.status !== 'Confirmed') throw err(409, 'Only confirmed bookings can be modified');
  const sv = q.body.services ?? db.prepare('SELECT service_id id,qty FROM booking_services WHERE booking_id=?').all(old.id);
  save(old.user_id, { room_id: old.room_id, guests: old.guests, ...q.body, services: sv }, old.id);
  r.json({ ok: true });
}));
app.delete('/api/bookings/:id', auth(), wrap((q, r) => { // cancel: availability queries ignore Cancelled, so the dates are freed
  const b = owned(q);
  if (b.status !== 'Confirmed') throw err(409, 'Only confirmed bookings can be cancelled');
  db.prepare("UPDATE bookings SET status='Cancelled' WHERE id=?").run(b.id); r.json({ ok: true });
}));
app.post('/api/bookings/:id/check-in', auth(...STAFF), wrap((q, r) => {
  const b = owned(q);
  if (b.status !== 'Confirmed') throw err(409, 'Booking is not in Confirmed state');
  if (b.check_in > todayStr()) throw err(409, 'Too early: check-in date has not arrived');
  db.transaction(() => { db.prepare("UPDATE bookings SET status='CheckedIn' WHERE id=?").run(b.id); db.prepare("UPDATE rooms SET status='Occupied' WHERE id=?").run(b.room_id); })();
  r.json({ ok: true });
}));
app.post('/api/bookings/:id/check-out', auth(...STAFF), wrap((q, r) => {
  const b = owned(q);
  if (b.status !== 'CheckedIn') throw err(409, 'Guest is not checked in');
  db.transaction(() => { db.prepare("UPDATE bookings SET status='CheckedOut' WHERE id=?").run(b.id); db.prepare("UPDATE rooms SET status='Cleaning' WHERE id=?").run(b.room_id); })();
  r.json({ ok: true });
}));
app.get('/api/bookings/:id/invoice', auth(), wrap((q, r) => {
  const b = owned(q);
  if (b.status !== 'CheckedOut') throw err(409, 'Invoice is available after check-out');
  const sv = db.prepare('SELECT s.name,s.price,bs.qty FROM booking_services bs JOIN services s ON s.id=bs.service_id WHERE bs.booking_id=?').all(b.id);
  const n = nights(b.check_in, b.check_out), t = pricing.fromBooking(b, sv);
  const d = new PDF({ margin: 50 });
  r.setHeader('Content-Type', 'application/pdf'); r.setHeader('Content-Disposition', `attachment; filename=invoice-${b.id}.pdf`);
  d.pipe(r);
  d.fontSize(22).text('Grand Hotel - Invoice').fontSize(11).moveDown()
    .text(`Invoice #${b.id}`).text(`Guest: ${b.guest_name} (${b.guest_email})`).text(`Room ${b.room_number} (${b.room_type})`)
    .text(`Stay: ${b.check_in} to ${b.check_out} (${n} nights)`).moveDown()
    .text(`Room (${n} nights): ${t.subtotal}`);
  sv.forEach(s => d.text(`${s.name}: ${s.qty} x ${s.price}`));
  if (t.discount) d.text(`Discount${t.code ? ' (' + t.code + ')' : ''}: -${t.discount}`);
  d.text(`Tax (10%): ${t.tax}`).moveDown().fontSize(14).text(`Total: ${t.total}`).end();
}));

// ---------- guests / staff management (admin) ----------
app.get('/api/admin/users', auth('admin'), wrap((q, r) => r.json(db.prepare('SELECT u.id,u.name,u.email,u.phone,u.role,(SELECT COUNT(*) FROM bookings WHERE user_id=u.id) bookings FROM users u ORDER BY u.id').all())));
app.post('/api/admin/users', auth('admin'), wrap((q, r) => {
  const { name, email, password, role } = q.body;
  if (!name || name.trim().length < 2) throw err(400, 'Name must be at least 2 characters');
  if (!EMAIL.test(email || '')) throw err(400, 'Valid email required');
  if (!password || password.length < 6) throw err(400, 'Password must be at least 6 characters');
  if (!['guest', 'receptionist', 'admin'].includes(role)) throw err(400, 'Invalid role');
  r.status(201).json({ id: db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run(name.trim(), email.toLowerCase(), bcrypt.hashSync(password, 10), role).lastInsertRowid });
}));
app.put('/api/admin/users/:id', auth('admin'), wrap((q, r) => {
  const { name, phone, role } = q.body;
  if (!name || name.trim().length < 2) throw err(400, 'Name must be at least 2 characters');
  if (!['guest', 'receptionist', 'admin'].includes(role)) throw err(400, 'Invalid role');
  db.prepare('UPDATE users SET name=?,phone=?,role=? WHERE id=?').run(name.trim(), phone || '', role, +q.params.id); r.json({ ok: true });
}));
app.delete('/api/admin/users/:id', auth('admin'), wrap((q, r) => {
  if (+q.params.id === q.user.id) throw err(400, 'You cannot delete yourself');
  db.prepare('DELETE FROM users WHERE id=?').run(+q.params.id); r.json({ ok: true });
}));

// ---------- analytics ----------
app.get('/api/admin/stats', auth('admin'), wrap((q, r) => {
  const ISO = /^\d{4}-\d{2}-\d{2}$/, day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const from = ISO.test(q.query.from || '') ? q.query.from : day(-30), to = ISO.test(q.query.to || '') ? q.query.to : day(30);
  if (to < from) throw err(400, 'End date must be after start date');
  const ok = "b.status IN('Confirmed','CheckedIn','CheckedOut')";
  const revenue = db.prepare(`SELECT substr(b.check_in,1,7) month,ROUND(SUM(b.total),2) revenue FROM bookings b WHERE ${ok} AND b.check_in BETWEEN ? AND ? GROUP BY month ORDER BY month`).all(from, to);
  const byType = db.prepare(`SELECT r.type,COUNT(*) count FROM bookings b JOIN rooms r ON r.id=b.room_id WHERE ${ok} AND b.check_in BETWEEN ? AND ? GROUP BY r.type`).all(from, to);
  const nRooms = db.prepare('SELECT COUNT(*) c FROM rooms').get().c || 1;
  const bs = db.prepare(`SELECT b.check_in,b.check_out FROM bookings b WHERE ${ok} AND b.check_in<=? AND b.check_out>?`).all(to, from);
  const occupancy = [];
  for (let d = new Date(from + 'T00:00:00Z'), i = 0; d <= new Date(to + 'T00:00:00Z') && i < 366; d.setUTCDate(d.getUTCDate() + 1), i++) {
    const s = d.toISOString().slice(0, 10);
    occupancy.push({ date: s, rate: Math.round(bs.filter(b => b.check_in <= s && b.check_out > s).length / nRooms * 100) });
  }
  r.json({ from, to, revenue, byType, occupancy });
}));

// ---------- errors ----------
app.use((e, q, r, n) => {
  if (e.code === 'LIMIT_FILE_SIZE') { e.status = 400; e.message = 'Each image must be under 2MB'; }
  else if (e.code === 'LIMIT_FILE_COUNT' || e.code === 'LIMIT_UNEXPECTED_FILE') { e.status = 400; e.message = 'Maximum 5 images allowed'; }
  else if (String(e.code).startsWith('SQLITE_CONSTRAINT')) { e.status = 409; e.message = 'Duplicate or in-use record'; }
  if (!e.status) console.error(e);
  r.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
});
module.exports = app;

// Bonus feature: reviews and ratings. Only a guest with a completed (checked-out) stay can review,
// once per booking. Mounted from app.js:  require('./reviews')(app, { db, auth, wrap, err });
module.exports = function (app, { db, auth, wrap, err }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY,
      booking_id INTEGER UNIQUE NOT NULL REFERENCES bookings(id),
      room_id INTEGER NOT NULL REFERENCES rooms(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_rv_room ON reviews(room_id);
  `);

  // { "<room_id>": { avg: 4.5, count: 2 } } for the room cards
  app.get('/api/ratings', wrap((q, r) => {
    const out = {};
    db.prepare('SELECT room_id, ROUND(AVG(rating),1) avg, COUNT(*) count FROM reviews GROUP BY room_id').all()
      .forEach(x => { out[x.room_id] = { avg: x.avg, count: x.count }; });
    r.json(out);
  }));

  // Reviews + average for the room details page
  app.get('/api/rooms/:id/reviews', wrap((q, r) => {
    const id = +q.params.id;
    const s = db.prepare('SELECT ROUND(AVG(rating),1) avg, COUNT(*) count FROM reviews WHERE room_id=?').get(id);
    const reviews = db.prepare('SELECT v.id,v.rating,v.comment,v.created_at,u.name guest FROM reviews v JOIN users u ON u.id=v.user_id WHERE v.room_id=? ORDER BY v.id DESC').all(id);
    r.json({ avg: s.count ? s.avg : null, count: s.count, reviews: reviews.map(v => ({ ...v, guest: String(v.guest).split(' ')[0] })) });
  }));

  // Booking ids the current guest already reviewed (so My Bookings can hide the review button)
  app.get('/api/reviews/mine', auth(), wrap((q, r) =>
    r.json(db.prepare('SELECT booking_id FROM reviews WHERE user_id=?').all(q.user.id).map(x => x.booking_id))));

  app.post('/api/bookings/:id/review', auth('guest'), wrap((q, r) => {
    const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(+q.params.id);
    if (!b || b.user_id !== q.user.id) throw err(404, 'Booking not found');
    if (b.status !== 'CheckedOut') throw err(409, 'You can review a room only after your stay is completed');
    if (db.prepare('SELECT 1 FROM reviews WHERE booking_id=?').get(b.id)) throw err(409, 'You already reviewed this stay');
    const rating = +q.body.rating, comment = String(q.body.comment || '').trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw err(400, 'Rating must be 1 to 5 stars');
    if (comment.length > 500) throw err(400, 'Comment must be 500 characters or fewer');
    const id = db.prepare('INSERT INTO reviews(booking_id,room_id,user_id,rating,comment) VALUES(?,?,?,?,?)').run(b.id, b.room_id, q.user.id, rating, comment).lastInsertRowid;
    r.status(201).json({ id });
  }));
};

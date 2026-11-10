process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
const test = require('node:test'), assert = require('node:assert');
const { nights, overlaps, validateDates, total } = require('../server/pricing');
const app = require('../server/app');

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let srv, base;
const call = async (method, path, body, tok) => {
  const r = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body && JSON.stringify(body) });
  const ct = r.headers.get('content-type') || '';
  return { s: r.status, ct, j: ct.includes('json') ? await r.json() : null };
};
const login = async (email, password) => (await call('POST', '/auth/login', { email, password })).j.token;

test.before(() => new Promise(res => { srv = app.listen(0, () => { base = `http://127.0.0.1:${srv.address().port}`; res(); }); }));
test.after(() => { srv.closeAllConnections?.(); srv.close(); });

// ---- pure logic ----
test('nights counts the difference in days', () => assert.equal(nights('2030-01-01', '2030-01-04'), 3));
test('total = nights x rate + services + 10% tax', () => assert.deepEqual(total(100, 2, [{ price: 10, qty: 2 }]), { nights: 2, subtotal: 200, extra: 20, tax: 22, total: 242 }));
test('overlap: partially intersecting ranges clash', () => assert.ok(overlaps('2030-01-01', '2030-01-05', '2030-01-04', '2030-01-08')));
test('overlap: back-to-back stays (checkout = next check-in) do not clash', () => assert.ok(!overlaps('2030-01-01', '2030-01-05', '2030-01-05', '2030-01-08')));
test('validateDates rejects past dates', () => assert.match(validateDates('2000-01-01', '2000-01-03'), /Past/));
test('validateDates rejects check-out not after check-in', () => assert.match(validateDates(day(5), day(5)), /after/));
test('validateDates accepts a valid future range', () => assert.equal(validateDates(day(5), day(7)), null));

// ---- API ----
test('signup rejects a short password (server-side validation)', async () => assert.equal((await call('POST', '/auth/signup', { name: 'Ali', email: 'a@x.com', password: '123' })).s, 400));
test('signup then login works; duplicate email is rejected', async () => {
  assert.equal((await call('POST', '/auth/signup', { name: 'Guest One', email: 'g1@x.com', password: 'secret1' })).s, 201);
  assert.equal((await call('POST', '/auth/signup', { name: 'Guest One', email: 'g1@x.com', password: 'secret1' })).s, 409);
  assert.ok(await login('g1@x.com', 'secret1'));
});
test('login with wrong password fails', async () => assert.equal((await call('POST', '/auth/login', { email: 'g1@x.com', password: 'nope123' })).s, 401));
test('guest cannot access admin routes; no token gets 401', async () => {
  const g = await login('g1@x.com', 'secret1');
  assert.equal((await call('GET', '/admin/stats', null, g)).s, 403);
  assert.equal((await call('GET', '/bookings/mine')).s, 401);
});
test('overlapping booking is rejected; cancelling frees the dates', async () => {
  const g = await login('g1@x.com', 'secret1');
  const body = { room_id: 1, check_in: day(10), check_out: day(13), guests: 1 };
  const first = await call('POST', '/bookings', body, g);
  assert.equal(first.s, 201);
  assert.equal((await call('POST', '/bookings', { ...body, check_in: day(12), check_out: day(15) }, g)).s, 409);
  assert.equal((await call('POST', '/bookings', { ...body, check_in: day(13), check_out: day(15) }, g)).s, 201); // back-to-back is fine
  assert.equal((await call('DELETE', '/bookings/' + first.j.id, null, g)).s, 200);
  assert.equal((await call('POST', '/bookings', { ...body, check_in: day(11), check_out: day(12) }, g)).s, 201);
});
test('booking in the past or with bad dates is rejected', async () => {
  const g = await login('g1@x.com', 'secret1');
  assert.equal((await call('POST', '/bookings', { room_id: 2, check_in: '2000-01-01', check_out: '2000-01-02', guests: 1 }, g)).s, 400);
  assert.equal((await call('POST', '/bookings', { room_id: 2, check_in: day(3), check_out: day(2), guests: 1 }, g)).s, 400);
});
test('FULL FLOW: search -> book -> check-in -> check-out -> invoice PDF', async () => {
  const g = await login('g1@x.com', 'secret1'), rec = await login('reception@hotel.com', 'Reception@123');
  const found = await call('GET', `/rooms?check_in=${day(0)}&check_out=${day(2)}&type=Double`);
  assert.equal(found.j.length, 1);
  const b = await call('POST', '/bookings', { room_id: found.j[0].id, check_in: day(0), check_out: day(2), guests: 2, services: [{ id: 1, qty: 1 }] }, g);
  assert.equal(b.s, 201);
  const after = await call('GET', `/rooms?check_in=${day(0)}&check_out=${day(2)}&type=Double`);
  assert.equal(after.j.length, 0); // booked room is no longer offered
  assert.equal((await call('GET', `/bookings/${b.j.id}/invoice`, null, g)).s, 409); // not checked out yet
  assert.equal((await call('POST', `/bookings/${b.j.id}/check-in`, null, g)).s, 403); // guests cannot check in
  assert.equal((await call('POST', `/bookings/${b.j.id}/check-in`, null, rec)).s, 200);
  assert.equal((await call('GET', '/rooms/' + found.j[0].id)).j.status, 'Occupied');
  assert.equal((await call('POST', `/bookings/${b.j.id}/check-out`, null, rec)).s, 200);
  assert.equal((await call('GET', '/rooms/' + found.j[0].id)).j.status, 'Cleaning');
  const inv = await call('GET', `/bookings/${b.j.id}/invoice`, null, g);
  assert.equal(inv.s, 200); assert.match(inv.ct, /pdf/);
});

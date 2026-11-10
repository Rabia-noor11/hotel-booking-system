const TAX_RATE = 0.1;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const toDate = s => new Date(s + 'T00:00:00Z');
const todayStr = () => new Date().toISOString().slice(0, 10);
const nights = (ci, co) => Math.round((toDate(co) - toDate(ci)) / 864e5);
// Half-open ranges [start, end): a guest leaving on the day another arrives is NOT an overlap.
const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
function validateDates(ci, co, today = todayStr()) {
  if (!ISO.test(ci || '') || !ISO.test(co || '') || isNaN(toDate(ci)) || isNaN(toDate(co))) return 'Valid check-in and check-out dates are required';
  if (ci < today) return 'Past dates are not allowed';
  if (co <= ci) return 'Check-out must be after check-in';
  return null;
}
function total(rate, n, services = []) {
  const subtotal = +(rate * n).toFixed(2);
  const extra = +services.reduce((s, x) => s + x.price * x.qty, 0).toFixed(2);
  const tax = +((subtotal + extra) * TAX_RATE).toFixed(2);
  return { nights: n, subtotal, extra, tax, total: +(subtotal + extra + tax).toFixed(2) };
}
module.exports = { TAX_RATE, nights, overlaps, validateDates, total, todayStr };

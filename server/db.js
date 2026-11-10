const Database = require('better-sqlite3');
const db = new Database(process.env.DB_FILE || 'hotel.db');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT DEFAULT '', password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'guest');
CREATE TABLE IF NOT EXISTS rooms(id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL, type TEXT NOT NULL, price REAL NOT NULL, capacity INTEGER NOT NULL, amenities TEXT DEFAULT '', images TEXT DEFAULT '[]', status TEXT NOT NULL DEFAULT 'Available');
CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL);
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), room_id INTEGER NOT NULL REFERENCES rooms(id), check_in TEXT NOT NULL, check_out TEXT NOT NULL, guests INTEGER NOT NULL, rate REAL NOT NULL, total REAL NOT NULL, status TEXT NOT NULL DEFAULT 'Confirmed', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS booking_services(booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE, service_id INTEGER NOT NULL REFERENCES services(id), qty INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_bk_room ON bookings(room_id, check_in, check_out);
`);
module.exports = db;

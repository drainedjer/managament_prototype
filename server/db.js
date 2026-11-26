/**
 * db.js - tiny JSON-file data layer.
 * All reads/writes go through this file, so swapping in MySQL (mysql2)
 * later only means rewriting these helpers.
 * On Vercel the disk is read-only except /tmp, so demo data lives there
 * (it resets whenever the serverless function restarts).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SEED_FILE = path.join(__dirname, 'seed.json');
const DATA_DIR = process.env.VERCEL ? os.tmpdir() : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

let store = null;

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function reset() {
  store = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  recalcRooms();
  save();
  return store;
}

function get() {
  if (!store) {
    if (fs.existsSync(DATA_FILE)) store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    else reset();
  }
  store.reviews ||= [];
  store.messages ||= [];
  store.counters ||= {};
  store.counters.review ||= 1;
  store.counters.message ||= 1;
  return store;
}

/** Returns the next auto-increment id for a collection key (e.g. 'room'). */
function nextId(key) {
  const s = get();
  const id = s.counters[key] || 1;
  s.counters[key] = id + 1;
  return id;
}

/** Recomputes occupied/available beds and status of every room from active tenants. */
function recalcRooms() {
  const s = get();
  for (const room of s.rooms) {
    const occupied = s.tenants.filter((t) => t.roomId === room.id && t.status === 'Active').length;
    room.occupiedBeds = Math.min(occupied, room.capacity);
    room.availableBeds = room.capacity - room.occupiedBeds;
    if (room.status === 'Maintenance') continue; // owner-controlled
    const hasReservation = s.applications.some(
      (a) => a.assignedRoomId === room.id && ['Approved', 'Reserved'].includes(a.status)
    );
    if (room.availableBeds === 0) room.status = 'Occupied';
    else if (hasReservation && room.occupiedBeds === 0) room.status = 'Reserved';
    else room.status = 'Available';
  }
}

module.exports = { get, save, reset, nextId, recalcRooms };

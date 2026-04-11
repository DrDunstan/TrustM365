// time.js - Always use UTC or local time for timestamps
function nowUtc() {
  return new Date().toISOString();
}

module.exports = { nowUtc };

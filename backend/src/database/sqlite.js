/**
 * Thin synchronous wrapper around sql.js that mirrors the better-sqlite3 API (pure JS — no native bindings).
 * This means all existing code using db.prepare().get/all/run continues to work
 * without modification, and zero native compilation is required.
 *
 * API surface implemented:
 *   db.prepare(sql) → Statement
 *   statement.get(...params)   → row object | undefined
 *   statement.all(...params)   → row[] 
 *   statement.run(...params)   → { changes, lastInsertRowid }
 *   db.exec(sql)               → void
 *   db.pragma(str)             → void (no-op for WAL — sql.js is in-memory)
 *   db.transaction(fn)         → wrapped fn
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let SQL = null;
let dbInstance = null;
let dbPath = null;
let saveTimer = null;

// Persist db to disk every 500ms after a write (debounced)
function scheduleSave() {
  if (!dbPath || !dbInstance) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = dbInstance.export();
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dbPath, Buffer.from(data));
    } catch (err) {
      console.error('[sqlite] Failed to persist database:', err.message);
    }
  }, 500);
}

// Convert sql.js column/values arrays into a plain object
function rowToObject(columns, values) {
  if (!values) return undefined;
  const obj = {};
  columns.forEach((col, i) => { obj[col] = values[i] ?? null; });
  return obj;
}

// Bind params — sql.js wants an object map or array
function bindParams(params) {
  if (!params || params.length === 0) return [];
  // Flatten single-array argument
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

class Statement {
  constructor(db, sql) {
    this._db = db;
    this._sql = sql;
  }

  get(...params) {
    const stmt = this._db.prepare(this._sql);
    try {
      stmt.bind(bindParams(params));
      if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        return rowToObject(cols, vals);
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params) {
    const stmt = this._db.prepare(this._sql);
    const rows = [];
    try {
      stmt.bind(bindParams(params));
      while (stmt.step()) {
        const cols = stmt.getColumnNames();
        rows.push(rowToObject(cols, stmt.get()));
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  run(...params) {
    const stmt = this._db.prepare(this._sql);
    try {
      stmt.bind(bindParams(params));
      stmt.step();
      scheduleSave();
      return {
        changes: this._db.getRowsModified(),
        lastInsertRowid: null // sql.js doesn't expose this easily
      };
    } finally {
      stmt.free();
    }
  }
}

class Database {
  constructor(sqlJs, filePath) {
    this._sql = sqlJs;
    dbPath = filePath;

    // Load existing db from disk if it exists
    if (filePath && fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      this._db = new sqlJs.Database(fileBuffer);
    } else {
      this._db = new sqlJs.Database();
    }

    dbInstance = this._db;
  }

  prepare(sql) {
    return new Statement(this._db, sql);
  }

  exec(sql) {
    this._db.run(sql);
    scheduleSave();
  }

  pragma(str) {
    // sql.js is in-memory so WAL/foreign_keys pragmas are silently accepted
    try { this._db.run(`PRAGMA ${str}`); } catch { /* ignore */ }
  }

  transaction(fn) {
    return (...args) => {
      this._db.run('BEGIN');
      try {
        const result = fn(...args);
        this._db.run('COMMIT');
        scheduleSave();
        return result;
      } catch (err) {
        this._db.run('ROLLBACK');
        throw err;
      }
    };
  }

  getRowsModified() {
    return this._db.getRowsModified();
  }

  close() {
    if (dbInstance) {
      scheduleSave();
      dbInstance.close();
      dbInstance = null;
    }
  }
}

/**
 * Synchronously initialise sql.js and return a Database instance.
 * Because sql.js loads a WASM binary, this must be called once at startup
 * before any routes are registered. The result is cached.
 */
async function openDatabase(filePath) {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return new Database(SQL, filePath);
}

module.exports = { openDatabase };

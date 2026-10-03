'use strict';
// 偽の Google Apps Script 実行環境。テスト専用。
// ここにある GAS の機能だけが、アプリのコードから使ってよい機能である（docs/impl/INSTRUCTIONS.md「使ってよい GAS の機能」）。
// 実装役はこのファイルを変更してはならない。

const crypto = require('node:crypto');

function jstToEpochMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error('clock format must be "YYYY-MM-DD HH:MM" (JST): ' + s);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 9 * 3600 * 1000;
}

function toBuffer(x) {
  if (Array.isArray(x)) return Buffer.from(x.map((b) => b & 255));
  if (typeof x === 'string') return Buffer.from(x, 'utf8');
  throw new Error('Utilities: value must be a string or a byte array');
}
function toSignedBytes(buf) {
  return Array.from(buf, (b) => (b > 127 ? b - 256 : b));
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    if (!(row >= 1 && col >= 1 && numRows >= 1 && numCols >= 1)) {
      throw new Error(`Range: invalid coordinates (${row}, ${col}, ${numRows}, ${numCols})`);
    }
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const src = this.sheet._rows[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = src[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.numRows ||
        values.some((l) => !Array.isArray(l) || l.length !== this.numCols)) {
      throw new Error('The number of rows or columns in the data does not match the range.');
    }
    for (let r = 0; r < this.numRows; r++) {
      const idx = this.row - 1 + r;
      while (this.sheet._rows.length <= idx) this.sheet._rows.push([]);
      const line = this.sheet._rows[idx];
      for (let c = 0; c < this.numCols; c++) line[this.col - 1 + c] = FakeSheet.cell(values[r][c]);
    }
    this.sheet._ss._writes++;
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat() { return this; }
  setNumberFormats() { return this; }
  getNumRows() { return this.numRows; }
  getNumColumns() { return this.numCols; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
}

class FakeSheet {
  // 実際のシートを書式「書式なしテキスト」にした状態を模す: 書いた値はすべて文字列として読み戻る。
  static cell(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date || (v && typeof v.getTime === 'function')) {
      throw new Error('Do not write Date objects to sheets. Write "YYYY-MM-DD" / "YYYY-MM-DD HH:MM" strings.');
    }
    if (typeof v === 'object') throw new Error('Do not write objects to sheets. Use JSON.stringify.');
    return String(v);
  }
  constructor(ss, name) { this._ss = ss; this._name = name; this._rows = []; }
  getName() { return this._name; }
  _trim() {
    while (this._rows.length && this._rows[this._rows.length - 1].every((v) => v === '' || v === undefined)) this._rows.pop();
  }
  getLastRow() { this._trim(); return this._rows.length; }
  getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return Math.max(1000, this.getLastRow()); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  getRange(row, col, numRows, numCols) {
    if (typeof row === 'string') throw new Error('A1 notation is not supported. Use getRange(row, column, numRows, numColumns).');
    return new FakeRange(this, row, col, numRows === undefined ? 1 : numRows, numCols === undefined ? 1 : numCols);
  }
  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
  appendRow(values) {
    this._trim();
    this._rows.push(values.map(FakeSheet.cell));
    this._ss._writes++;
    return this;
  }
  deleteRow(r) { this._rows.splice(r - 1, 1); return this; }
  deleteRows(r, n) { this._rows.splice(r - 1, n); return this; }
  setFrozenRows() { return this; }
  clear() { this._rows = []; return this; }
}

class FakeSpreadsheet {
  constructor(id, name) { this._id = id; this._name = name; this._sheets = []; this._writes = 0; }
  getId() { return this._id; }
  getName() { return this._name; }
  getSheets() { return this._sheets.slice(); }
  getSheetByName(n) { return this._sheets.find((s) => s._name === n) || null; }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error('A sheet with the name "' + n + '" already exists.');
    const s = new FakeSheet(this, n);
    this._sheets.push(s);
    return s;
  }
  deleteSheet(s) { this._sheets = this._sheets.filter((x) => x !== s); }
}

function createGasEnv(options) {
  const opts = options || {};
  const state = {
    nowMs: jstToEpochMs(opts.now || '2026-09-01 10:00'),
    spreadsheets: new Map(),
    properties: new Map(),
    logs: [],
    lockBusy: false,
    lockHeld: false,
    nextId: 1,
    hmacCalls: 0,
  };

  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(state.nowMs);
      else super(...args);
    }
    static now() { return state.nowMs; }
  }

  const SpreadsheetApp = {
    create(name) {
      const id = 'ss_' + state.nextId++;
      const ss = new FakeSpreadsheet(id, name);
      ss.insertSheet('Sheet1');
      state.spreadsheets.set(id, ss);
      return ss;
    },
    openById(id) {
      const ss = state.spreadsheets.get(String(id));
      if (!ss) throw new Error('Spreadsheet not found: ' + id);
      return ss;
    },
    flush() {},
  };

  const lock = {
    tryLock() {
      if (state.lockBusy) return false;
      state.lockHeld = true;
      return true;
    },
    waitLock() {
      if (state.lockBusy) throw new Error('Lock timeout: another process was holding the lock for too long.');
      state.lockHeld = true;
    },
    releaseLock() { state.lockHeld = false; },
    hasLock() { return state.lockHeld; },
  };
  const LockService = { getScriptLock() { return lock; } };

  const scriptProps = {
    getProperty(k) { return state.properties.has(k) ? state.properties.get(k) : null; },
    setProperty(k, v) { state.properties.set(k, String(v)); return scriptProps; },
    deleteProperty(k) { state.properties.delete(k); return scriptProps; },
    getProperties() { return Object.fromEntries(state.properties); },
  };
  const PropertiesService = { getScriptProperties() { return scriptProps; } };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    getUuid() { return crypto.randomUUID(); },
    computeHmacSha256Signature(value, key) {
      state.hmacCalls++;
      return toSignedBytes(crypto.createHmac('sha256', toBuffer(key)).update(toBuffer(value)).digest());
    },
    computeDigest(algorithm, value) {
      if (algorithm !== 'SHA_256') throw new Error('Only Utilities.DigestAlgorithm.SHA_256 is available');
      return toSignedBytes(crypto.createHash('sha256').update(toBuffer(value)).digest());
    },
    base64Encode(x) { return toBuffer(x).toString('base64'); },
    base64EncodeWebSafe(x) { return toBuffer(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'); },
    sleep() {},
    formatDate() {
      throw new Error('Utilities.formatDate is not allowed. Convert with the fixed +9h offset (INSTRUCTIONS.md).');
    },
  };

  const Logger = {
    log(fmt, ...rest) {
      let s = String(fmt);
      rest.forEach((v) => { s = s.replace('%s', String(v)); });
      state.logs.push(s);
      return Logger;
    },
  };

  // バックアップ用（Backup.js だけが使う）。driveFail を立てると、ドライブの操作が失敗する
  const drive = { folders: [], copies: [], triggers: [], driveFail: false };
  const DriveApp = {
    createFolder(name) {
      if (drive.driveFail) throw new Error('Drive unavailable');
      const f = { id: 'folder_' + state.nextId++, name, getId() { return this.id; } };
      drive.folders.push(f);
      return f;
    },
    getFolderById(id) {
      if (drive.driveFail) throw new Error('Drive unavailable');
      const f = drive.folders.find((x) => x.id === id);
      if (!f) throw new Error('Folder not found: ' + id);
      return f;
    },
    getFileById(id) {
      if (drive.driveFail) throw new Error('Drive unavailable');
      return { makeCopy(name, folder) { drive.copies.push({ id, name, folder: folder.id }); } };
    },
  };
  const ScriptApp = {
    getProjectTriggers() { return drive.triggers.map((h) => ({ getHandlerFunction: () => h })); },
    newTrigger(h) {
      const b = { timeBased: () => b, onMonthDay: () => b, atHour: () => b, create: () => { drive.triggers.push(h); return {}; } };
      return b;
    },
  };

  const quietConsole = { log() {}, info() {}, warn() {}, error() {} };

  return {
    globals: { SpreadsheetApp, DriveApp, ScriptApp, LockService, PropertiesService, Utilities, Logger, console: quietConsole, Date: FakeDate },
    clock: {
      set(s) { state.nowMs = jstToEpochMs(s); },
      advanceMinutes(n) { state.nowMs += n * 60 * 1000; },
    },
    setLockBusy(b) { state.lockBusy = !!b; },
    get lockHeld() { return state.lockHeld; },
    get hmacCalls() { return state.hmacCalls; },
    logs: state.logs,
    drive,
    properties: state.properties,
    spreadsheets: state.spreadsheets,
  };
}

module.exports = { createGasEnv, jstToEpochMs };

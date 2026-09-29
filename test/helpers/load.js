'use strict';
// src/ の *.js を、GAS と同じく「1つの共有の場所」に順に読み込む。テスト専用。
// 実装役はこのファイルを変更してはならない。

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGasEnv } = require('./gas-fake');

const SRC_DIR = process.env.APP_SRC_DIR
  ? path.resolve(process.env.APP_SRC_DIR)
  : path.resolve(__dirname, '..', '..', 'src');

function load(options) {
  const env = createGasEnv(options);
  const context = vm.createContext({ ...env.globals });
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();
  if (files.length === 0) throw new Error('src/ に .js ファイルがありません: ' + SRC_DIR);
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    vm.runInContext(code, context, { filename: f });
  }
  const get = (name) => {
    const v = vm.runInContext(`typeof ${name} === 'undefined' ? undefined : ${name}`, context);
    if (v === undefined) throw new Error(`src/ に ${name} が定義されていません`);
    return v;
  };
  // vm の中で作られた値は、テスト側の assert.deepStrictEqual でプロトタイプが食い違う。JSON を通して素の値にする。
  const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const call = (name, ...args) => plain(get(name)(...args));
  return { env, context, get, call, plain };
}

module.exports = { load, SRC_DIR };

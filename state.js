/**
 * state.js — グローバル状態をsessionStorageで共有
 * キャラクターデータ、マッチリスト、設定を保存・取得
 */

const State = (() => {
  const KEY = 'coc_battle_v3';

  function load() {
    try {
      const raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : defaultState();
    } catch { return defaultState(); }
  }

  function save(data) {
    sessionStorage.setItem(KEY, JSON.stringify(data));
  }

  function defaultState() {
    return {
      roster: [],        // { id, name, job, ... parsed char data }
      mode: 'tournament',// 'tournament' | '1v1'
      speed: 100,        // ms per action
      matches: [],       // { id, l, r, winner, loser, isBye, round }
      matchIdx: 0,
      currentMatch: null,// live battle state
    };
  }

  function get() { return load(); }

  function update(patch) {
    const s = load();
    Object.assign(s, patch);
    save(s);
    return s;
  }

  function updateRoster(roster) {
    update({ roster });
  }

  function reset() {
    sessionStorage.removeItem(KEY);
  }

  return { get, update, updateRoster, reset, load, save };
})();

// Make available globally
window.State = State;

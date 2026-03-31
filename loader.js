/**
 * loader.js — キャラクター保管所 API 読み込み・解析
 *
 * API: https://charasheet.vampire-blood.net/{ID}.js?callback={fn}
 * JSONP形式。フィールド名はシステムによって異なる。
 *
 * クトゥルフ神話TRPGのキーフィールド（調査済み）:
 *   pc_name          : キャラクター名
 *   shokugyou        : 職業
 *   str/con/pow/dex/app/siz/int/edu : 能力値（数値文字列）
 *   HP/MP            : 現在HP/MP（未設定の場合は計算）
 *   SAN              : 現在SAN
 *   arms_name1~10    : 武器名
 *   arms_hit1~10     : 命中%
 *   arms_damage1~10  : ダメージ
 *   fighting_punch等 : 格闘技能（サイトによって異なる）
 *   game             : "coc" など（ゲームシステム識別）
 */

const Loader = (() => {

  // ── URL → ID 変換 ──────────────────────────────────
  function extractId(input) {
    input = input.trim();
    // Full URL
    const m = input.match(/charasheet\.vampire-blood\.net\/([a-zA-Z0-9]+)/);
    if (m) return m[1];
    // Just an ID (alphanumeric, 4+ chars)
    if (/^[a-zA-Z0-9]{4,}$/.test(input)) return input;
    return null;
  }

  // ── JSONP fetch ─────────────────────────────────────
  function fetchChar(id) {
    return new Promise((resolve, reject) => {
      // Unique callback name
      const cb = '__coc_load_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

      // Cleanup helper
      const cleanup = (script) => {
        if (script && document.head.contains(script)) document.head.removeChild(script);
        delete window[cb];
      };

      window[cb] = (data) => {
        clearTimeout(timer);
        cleanup(script);
        if (!data || typeof data !== 'object') {
          reject(new Error('データが空または不正です'));
          return;
        }
        resolve(data);
      };

      const script = document.createElement('script');

      // Use https always (GitHub Pages is https, mixed content blocks http)
      script.src = `https://charasheet.vampire-blood.net/${id}.js?callback=${cb}`;

      script.onerror = () => {
        clearTimeout(timer);
        cleanup(script);
        reject(new Error(`読み込み失敗 (ID: ${id})\nURLが正しいか確認してください`));
      };

      const timer = setTimeout(() => {
        cleanup(script);
        reject(new Error(`タイムアウト (10秒) — ID: ${id}`));
      }, 10000);

      document.head.appendChild(script);
    });
  }

  // ── データ解析 ───────────────────────────────────────
  function parseChar(raw, id) {
    // 数値取得ヘルパー（複数キーを順に試す）
    const num = (...keys) => {
      for (const k of keys) {
        const v = raw[k];
        if (v !== undefined && v !== null && v !== '') {
          const n = parseFloat(v);
          if (!isNaN(n)) return Math.round(n);
        }
      }
      return 0;
    };

    // 文字列取得ヘルパー
    const str = (...keys) => {
      for (const k of keys) {
        const v = raw[k];
        if (v && String(v).trim()) return String(v).trim();
      }
      return '';
    };

    // ── 能力値 ──
    // キャラクター保管所 CoC シートの実フィールド名
    // 能力値は "str" / "con" 等（小文字）が基本
    // 一部シートでは "NP_STR" 等の形式もある
    const STR = num('str', 'STR', 'NP_STR', 'str_point');
    const CON = num('con', 'CON', 'NP_CON', 'con_point');
    const POW = num('pow', 'POW', 'NP_POW', 'pow_point');
    const DEX = num('dex', 'DEX', 'NP_DEX', 'dex_point');
    const APP = num('app', 'APP', 'NP_APP', 'app_point');
    const SIZ = num('siz', 'SIZ', 'NP_SIZ', 'siz_point');
    const INT = num('int', 'INT', 'NP_INT', 'int_point');
    const EDU = num('edu', 'EDU', 'NP_EDU', 'edu_point');

    // HP/MP/SAN: シートに入力されている場合はそれを、なければ計算
    const hpMax = num('HP', 'hp', 'maxhp', 'NP_HP') || Math.max(1, Math.round((CON + SIZ) / 2));
    const mpMax = num('MP', 'mp', 'maxmp', 'NP_MP') || Math.max(1, POW);
    const sanMax = num('SAN', 'san', 'maxsan', 'NP_SAN', 'init_san') || Math.max(1, POW * 5);

    // ── ダメージボーナス ──
    const db = calcDB(STR, SIZ);

    // ── 武器データ ──
    const weapons = [];
    for (let i = 1; i <= 10; i++) {
      const name   = str(`arms_name${i}`, `weapon_name${i}`, `武器名${i}`);
      const hitStr = raw[`arms_hit${i}`] || raw[`weapon_hit${i}`] || raw[`命中${i}`] || '';
      const dmg    = str(`arms_damage${i}`, `weapon_damage${i}`, `ダメージ${i}`);
      const hitNum = parseInt(hitStr);
      if (name && !isNaN(hitNum) && hitNum > 0) {
        weapons.push({ name, hit: hitNum, dmg: dmg || '1d6' });
      }
    }

    // ── 格闘技能（フォールバック武器） ──
    // キャラクター保管所では各技能に専用フィールドがある場合と
    // 全技能を配列で持つ場合がある。両方対応。
    const skillFist    = num('fighting_punch', 'skill_fist',   'こぶしパンチ')   || 50;
    const skillKick    = num('fighting_kick',  'skill_kick',   'キック')         || 25;
    const skillMartial = num('fighting_martial','skill_martial','マーシャルアーツ')|| 1;
    const skillDodge   = num('dodge', 'skill_dodge', '回避')
                       || Math.max(1, DEX * 2);

    // 武器がなければ素手を追加
    if (weapons.length === 0) {
      weapons.push({ name: 'こぶし（パンチ）', hit: skillFist,    dmg: '1d3' });
      weapons.push({ name: 'キック',           hit: skillKick,    dmg: '1d6' });
      if (skillMartial > 10) {
        weapons.push({ name: 'マーシャルアーツ', hit: skillMartial, dmg: '1d4' });
      }
    } else {
      // 武器があっても素手は常に持つ
      weapons.push({ name: 'こぶし（パンチ）', hit: skillFist, dmg: '1d3', unarmed: true });
    }

    // ── 名前・職業 ──
    const name = str('pc_name', 'キャラクター名', 'name', 'chara_name') || `探索者 #${id.slice(-4)}`;
    const job  = str('shokugyou', '職業', 'job', 'occupation') || '';

    return {
      id,
      name,
      job,
      STR, CON, POW, DEX, APP, SIZ, INT, EDU,
      hpMax, hp: hpMax,
      mpMax, mp: mpMax,
      sanMax, san: sanMax,
      db,
      weapons,
      dodge: skillDodge,
      wins:   0,
      losses: 0,
      // raw data preserved for debugging
      _raw_game: raw.game || raw.data_title || '?',
    };
  }

  // ── ダメージボーナス計算 ──────────────────────────────
  function calcDB(str, siz) {
    const n = str + siz;
    if (n <=  12) return { label: '-1d4', roll: () => -roll(4) };
    if (n <=  16) return { label: '0',    roll: () => 0 };
    if (n <=  24) return { label: '+1d4', roll: () => +roll(4) };
    if (n <=  32) return { label: '+1d6', roll: () => +roll(6) };
    if (n <=  40) return { label: '+2d6', roll: () => roll(6) + roll(6) };
    return { label: '+3d6', roll: () => roll(6) + roll(6) + roll(6) };
  }

  function roll(n) { return Math.floor(Math.random() * n) + 1; }

  // ── Public API ───────────────────────────────────────
  return { extractId, fetchChar, parseChar, calcDB };
})();

window.Loader = Loader;

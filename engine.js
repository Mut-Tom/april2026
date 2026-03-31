/**
 * engine.js — クトゥルフ神話TRPG 戦闘エンジン
 *
 * ルール準拠:
 *   - DEX比較による先攻
 *   - 1d100 vs 技能値% で命中判定
 *   - クリティカル: 技能÷5 以下
 *   - スペシャル:   技能÷2 以下
 *   - ファンブル:   96 以上（技能が96以上なら99以上）
 *   - 回避:         DEX×2% ロール、クリティカルは貫通
 *   - ダメージ: ダイス + ダメージボーナス
 *   - SAN値: 毎アクション一定確率で減少
 */

const Engine = (() => {

  // ── ダイス ──────────────────────────────────────────
  const d = n => Math.floor(Math.random() * n) + 1;
  const d100 = () => d(100);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ── ダメージダイス文字列をパース ──────────────────────
  function rollDmgStr(dmgStr) {
    if (!dmgStr) return { total: 1, expr: '1' };
    const s = String(dmgStr).toUpperCase().replace(/\s/g, '');
    let total = 0;
    // Split on + or - (keeping the sign)
    const parts = s.split(/(?=[+\-])/g).filter(Boolean);
    for (const p of parts) {
      const mDice = p.match(/^([+\-]?)(\d+)[D](\d+)$/);
      const mConst = p.match(/^([+\-]?\d+)$/);
      if (mDice) {
        const sign  = mDice[1] === '-' ? -1 : 1;
        const count = parseInt(mDice[2]);
        const sides = parseInt(mDice[3]);
        for (let i = 0; i < count; i++) total += sign * d(sides);
      } else if (mConst) {
        total += parseInt(mConst[1]);
      }
    }
    return { total, expr: s };
  }

  // ── 命中グレード判定 ──────────────────────────────────
  function hitGrade(roll, skill) {
    if (roll >= 96 && skill < 96) return 'fumble';
    if (roll === 100)              return 'fumble';
    if (roll > skill)              return 'miss';
    if (roll <= Math.floor(skill / 5))  return 'critical';
    if (roll <= Math.floor(skill / 2))  return 'special';
    return 'success';
  }

  // ── 1ターン攻撃処理（ログHTML返却） ───────────────────
  function doAttack(att, def, attSide, defSide) {
    const logs = [];

    // 武器選択: unarmedを後回しにして最強を選ぶ
    const realWeapons = att.weapons.filter(w => !w.unarmed);
    const unarmed     = att.weapons.filter(w => w.unarmed);
    const pool = realWeapons.length > 0 ? realWeapons : unarmed;
    // 最も命中率が高い武器を選ぶ（乱数でブレさせない）
    const weapon = pool.reduce((best, w) => w.hit > best.hit ? w : best, pool[0]);

    if (!weapon) return logs; // 武器なし（エラー）

    const atkRoll = d100();
    const grade   = hitGrade(atkRoll, weapon.hit);

    // ── ファンブル ──
    if (grade === 'fumble') {
      logs.push({ cls: `log-attack-${attSide}`,
        html: `<span class="cn-${attSide}">${att.name}</span>が「${weapon.name}」で攻撃 <span class="t-roll">[${atkRoll}/${weapon.hit}%]</span> → <span class="t-miss">ファンブル！体勢を崩した…</span>` });
      return logs;
    }

    // ── ミス ──
    if (grade === 'miss') {
      logs.push({ cls: `log-attack-${attSide}`,
        html: `<span class="cn-${attSide}">${att.name}</span>が「${weapon.name}」で攻撃 <span class="t-roll">[${atkRoll}/${weapon.hit}%]</span> → <span class="t-miss">外れた</span>` });
      return logs;
    }

    // ── グレードラベル ──
    const gradeTag = grade === 'critical'
      ? '<span class="t-crit">【クリティカル！】</span>'
      : grade === 'special'
        ? '<span style="color:var(--gold)">【スペシャル】</span>'
        : '';

    // ── 回避（クリティカルは貫通） ──
    if (grade !== 'critical') {
      const dodgeRoll = d100();
      if (dodgeRoll <= def.dodge) {
        logs.push({ cls: `log-attack-${attSide}`,
          html: `<span class="cn-${attSide}">${att.name}</span>が「${weapon.name}」で攻撃 ${gradeTag} <span class="t-roll">[${atkRoll}/${weapon.hit}%]</span> → <span class="cn-${defSide}">${def.name}</span><span class="t-evade">が回避！</span> <span class="t-roll">[${dodgeRoll}/${def.dodge}%]</span>` });
        return logs;
      }
    } else {
      logs.push({ cls: 'log-sys',
        html: `クリティカルヒット — 回避不可！` });
    }

    // ── ダメージ計算 ──
    const dmgRes = rollDmgStr(weapon.dmg);
    const dbVal  = att.db.roll();
    let total    = Math.max(1, dmgRes.total + dbVal);

    if (grade === 'special')   total = Math.max(1, Math.ceil(total * 1.5));
    if (grade === 'critical')  total = Math.max(1, total * 2);

    const prevHp = def.hp;
    def.hp = clamp(def.hp - total, 0, def.hpMax);

    const dbNote   = dbVal !== 0 ? ` <span class="t-roll">(DB:${dbVal >= 0 ? '+' : ''}${dbVal})</span>` : '';
    const multNote = grade === 'special' ? ' <span class="t-roll">(×1.5)</span>'
                   : grade === 'critical'? ' <span class="t-roll">(×2)</span>' : '';

    logs.push({ cls: `log-attack-${attSide}`,
      html: `<span class="cn-${attSide}">${att.name}</span>が「${weapon.name}」で攻撃 ${gradeTag} <span class="t-roll">[${atkRoll}/${weapon.hit}%]</span> → <span class="t-hit">ヒット！</span> ダメージ: <span class="t-dmg">${total}</span>${dbNote}${multNote} <span class="t-roll">(${dmgRes.expr}${att.db.label !== '0' ? att.db.label : ''})</span> ／ <span class="cn-${defSide}">${def.name}</span> HP: ${prevHp}→<b>${def.hp}</b>` });

    return logs;
  }

  // ── SAN チェック（毎アクション一定確率） ─────────────
  function doSanCheck(victim, side) {
    // 約12%の確率で発動
    if (Math.random() > 0.12) return null;
    const loss = d(4);
    const prev = victim.san;
    victim.san = clamp(victim.san - loss, 0, victim.sanMax);
    const insane = victim.san === 0;
    return {
      cls: 'log-san',
      html: `<span class="cn-${side}">${victim.name}</span>に恐怖が忍び寄る… <span class="t-san">SAN -${loss}</span> (${prev}→<b>${victim.san}</b>)`
            + (insane ? ' <span class="t-crit">—— 発狂！！</span>' : ''),
      insane
    };
  }

  // ── 1ターン処理（全まとめ） ──────────────────────────
  // 返値: { logs: [...], dead: bool, stats変化 }
  function doTurn(battle) {
    const { L, R, turn, stats } = battle;
    const attSide = turn === 0 ? 'l' : 'r';
    const defSide = turn === 0 ? 'r' : 'l';
    const att = turn === 0 ? L : R;
    const def = turn === 0 ? R : L;

    const allLogs = [];
    stats.attacks++;

    // 攻撃
    const atkLogs = doAttack(att, def, attSide, defSide);
    allLogs.push(...atkLogs);

    // ダメージ統計
    // (HPの変化分から計算)
    // → doAttack内でdef.hp変更済み

    // SAN チェック (防御者)
    const sanLog = doSanCheck(def, defSide);
    if (sanLog) {
      allLogs.push(sanLog);
      stats.sanLost += 0; // 別途追跡が必要なら
    }

    // 死亡チェック
    const dead = def.hp <= 0;
    // 発狂チェック
    const insane = sanLog && sanLog.insane && Math.random() < 0.3;

    return { logs: allLogs, dead, insane, att, def, attSide, defSide };
  }

  // ── シャッフル ────────────────────────────────────────
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── トーナメント組み合わせ生成 ───────────────────────
  function buildTournament(chars) {
    const shuffled = shuffle([...chars]);
    const matches  = [];

    for (let i = 0; i < shuffled.length - 1; i += 2) {
      matches.push({
        id:    matches.length,
        l:     JSON.parse(JSON.stringify(shuffled[i])),
        r:     JSON.parse(JSON.stringify(shuffled[i + 1])),
        winner: null, loser: null,
        isBye:  false, round: 1
      });
    }
    // 奇数の場合は最後の1人を不戦勝
    if (shuffled.length % 2 === 1) {
      const bye = JSON.parse(JSON.stringify(shuffled[shuffled.length - 1]));
      matches.push({ id: matches.length, l: bye, r: null,
        winner: bye, loser: null, isBye: true, round: 1 });
    }
    return matches;
  }

  // ── 次ラウンドのマッチを生成 ─────────────────────────
  function buildNextRound(prevMatches) {
    const winners = prevMatches.filter(m => m.winner).map(m =>
      JSON.parse(JSON.stringify(m.winner))
    );
    if (winners.length <= 1) return null; // 優勝者決定

    const shuffled = shuffle(winners);
    const round    = (prevMatches[0]?.round || 1) + 1;
    const matches  = [];

    for (let i = 0; i < shuffled.length - 1; i += 2) {
      matches.push({ id: matches.length, l: shuffled[i], r: shuffled[i + 1],
        winner: null, loser: null, isBye: false, round });
    }
    if (shuffled.length % 2 === 1) {
      const bye = shuffled[shuffled.length - 1];
      matches.push({ id: matches.length, l: bye, r: null,
        winner: bye, loser: null, isBye: true, round });
    }
    return matches;
  }

  return {
    doTurn, doAttack, doSanCheck,
    buildTournament, buildNextRound,
    shuffle, rollDmgStr, hitGrade,
    d, d100, clamp
  };
})();

window.Engine = Engine;

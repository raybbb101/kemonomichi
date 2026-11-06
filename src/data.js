// ゲームデータ：動物・スキル・融合種・アイテム・敵・ステージ設定
// スキルは「ステップ」の並びで表現する。
//   自分側で処理: dash / leap / blink / selfbuff / shield
//   ホスト側で処理: melee / aoe / proj / line / party / rain / pull
//   at = 直前のステップからの遅延(秒)

const rep = (n, gap, step) => Array.from({ length: n }, (_, i) => ({ ...step, at: i ? gap : (step.at || 0) }));

export const TAGS_JP = {
  dig: '穴掘り', smell: '嗅覚', climb: '木登り', leap: '大跳躍', narrow: 'すき間くぐり',
  swim: '泳ぎ', push: '怪力押し', fly: '飛行', strong: '剛力',
};

export const SLOT_JP = { normal: '通常攻撃', skill: 'スキル', special: '特殊スキル', ult: '必殺技' };

export const ANIMALS = {
  dog: {
    name: 'イヌ', role: 'バランス・突撃', color: '#e09447',
    stats: { hp: 110, atk: 10, spd: 5.0 }, tags: ['dig', 'smell'],
    passive: { name: '嗅覚', desc: '宝の匂いを嗅ぎつけ、掘り場を一瞬で掘れる。ゴールド+10%', mods: { gold: 0.10 } },
    kit: {
      normal: { name: '噛みつき', desc: '前方に素早くかみつく', cd: 0.42, steps: [{ t: 'melee', range: 1.5, arc: 110, dmg: 1 }] },
      skill: { name: '遠吠え', desc: '周りの仲間の攻撃力を8秒間30%上げる', cd: 12, steps: [{ t: 'party', r: 7, buff: { stat: 'atk', mult: 1.3, dur: 8 }, fx: 'howl' }] },
      special: { name: '疾風突進', desc: '前方へ駆け抜け、通り道の敵を吹き飛ばす', cd: 6, steps: [{ t: 'dash', dist: 5, dur: 0.22 }, { t: 'line', w: 1.3, dmg: 1.8, kb: 4 }] },
      ult: { name: 'ウルフ・ラッシュ', desc: '6連続でかみつき、最後に衝撃波を放つ', steps: [...rep(6, 0.09, { t: 'melee', range: 2, arc: 160, dmg: 1.1 }), { t: 'aoe', r: 3.2, dmg: 3, kb: 5, at: 0.12, fx: 'boom', col: '#ffb860' }] },
    },
  },
  cat: {
    name: 'ネコ', role: '会心・機動', color: '#7d84a0',
    stats: { hp: 90, atk: 11, spd: 5.4 }, tags: ['climb'],
    passive: { name: 'しなやか', desc: '20%の確率で攻撃を回避。会心率+10%。木に登れる', mods: { evade: 0.2, crit: 0.1 } },
    kit: {
      normal: { name: 'ひっかき', desc: '扇状に素早くひっかく', cd: 0.3, steps: [{ t: 'melee', range: 1.4, arc: 130, dmg: 0.75 }] },
      skill: { name: '影渡り', desc: '影のように前へ瞬間移動し、着地点を切り裂く', cd: 5, steps: [{ t: 'blink', dist: 4 }, { t: 'aoe', r: 1.8, dmg: 1.6, fx: 'slashring', col: '#b9a3ff' }] },
      special: { name: '九生の構え', desc: '6秒間、会心率+50%・移動速度+30%', cd: 14, steps: [{ t: 'selfbuff', buff: { stat: 'crit', add: 0.5, dur: 6 } }, { t: 'selfbuff', buff: { stat: 'spd', mult: 1.3, dur: 6 } }] },
      ult: { name: '百裂爪', desc: '周囲を目にも止まらぬ速さで10回切り裂く', steps: rep(10, 0.06, { t: 'melee', range: 2.6, arc: 360, dmg: 0.75 }) },
    },
  },
  rabbit: {
    name: 'ウサギ', role: '跳躍・回復', color: '#f2ece2',
    stats: { hp: 95, atk: 9, spd: 5.6 }, tags: ['leap'],
    passive: { name: '脱兎', desc: '移動速度+15%、回避のクールダウン-40%。大跳躍で谷を越えられる', mods: { spd: 0.15, dodge: 0.4 } },
    kit: {
      normal: { name: '後ろ蹴り', desc: '力強いキックで敵を押し返す', cd: 0.4, steps: [{ t: 'melee', range: 1.4, arc: 100, dmg: 1, kb: 1.5 }] },
      skill: { name: '大跳躍', desc: '大きく跳んで着地の衝撃で敵をひるませる（谷も越えられる）', cd: 5, steps: [{ t: 'leap', dist: 5, dur: 0.5 }, { t: 'aoe', r: 2, dmg: 1.6, st: { stun: 0.6 }, fx: 'boom', col: '#fff3c0' }] },
      special: { name: '月見団子', desc: '周りの仲間の体力を25%回復', cd: 15, steps: [{ t: 'party', r: 6, heal: 0.25, fx: 'heal' }] },
      ult: { name: '月兎の舞', desc: '月の光が雨のように降り注ぐ', steps: [{ t: 'rain', n: 12, area: 5, r: 1.8, dmg: 1.8, gap: 0.08, col: '#fff3c0' }] },
    },
  },
  snake: {
    name: 'ヘビ', role: '毒・拘束', color: '#5fae5a',
    stats: { hp: 95, atk: 9, spd: 4.8 }, tags: ['narrow'],
    passive: { name: '脱皮', desc: '毎秒体力を1%回復。細いすき間に入れる', mods: { regen: 0.01 } },
    kit: {
      normal: { name: '毒牙', desc: 'かみついて毒を与える', cd: 0.45, steps: [{ t: 'melee', range: 1.6, arc: 90, dmg: 0.7, st: { poison: [0.35, 4] } }] },
      skill: { name: '毒液', desc: '毒液を3方向に吐く', cd: 4, steps: [{ t: 'proj', n: 3, spread: 24, spd: 11, dmg: 0.8, range: 8, kind: 'poison', st: { poison: [0.4, 4] } }] },
      special: { name: '締め付け', desc: '前方の敵を締め上げ、2秒間動けなくする', cd: 9, steps: [{ t: 'aoe', r: 2.2, off: 1.3, dmg: 1.2, st: { stun: 2 }, fx: 'coil', col: '#8fe07a' }] },
      ult: { name: '八岐の毒霧', desc: '巨大な毒霧を広げ、8匹の毒蛇を放つ', steps: [{ t: 'aoe', r: 5, dmg: 1, st: { poison: [1, 6], slow: [0.5, 4] }, fx: 'mist', col: '#8fe07a' }, { t: 'proj', ring: true, n: 8, spd: 9, dmg: 1, range: 9, kind: 'poison', st: { poison: [0.6, 4] }, at: 0.1 }] },
    },
  },
  crab: {
    name: 'カニ', role: '守り・タンク', color: '#e2553e',
    stats: { hp: 140, atk: 9, spd: 4.4 }, tags: ['swim', 'push'],
    passive: { name: '硬い甲羅', desc: '受けるダメージ-25%。水の中を泳げる', mods: { dmgTaken: 0.25 } },
    kit: {
      normal: { name: 'はさみ', desc: '大きなはさみで挟む', cd: 0.5, steps: [{ t: 'melee', range: 1.5, arc: 110, dmg: 1.1, kb: 1 }] },
      skill: { name: '甲羅の守り', desc: '自分に大きな盾(最大体力40%)、仲間に小さな盾を張る', cd: 10, steps: [{ t: 'shield', amt: 0.4, dur: 6 }, { t: 'party', r: 5, shield: 0.15, fx: 'shield' }] },
      special: { name: '泡しぶき', desc: '泡を扇状に飛ばし、敵を遅くする', cd: 6, steps: [{ t: 'proj', n: 5, spread: 50, spd: 9, dmg: 0.7, range: 6, kind: 'bubble', st: { slow: [0.5, 3] } }] },
      ult: { name: '大海嘯', desc: '前方に三段の大波を起こす', steps: [{ t: 'aoe', r: 2.2, off: 2, dmg: 2.2, kb: 3, fx: 'wave', col: '#7fd3ff' }, { t: 'aoe', r: 2.4, off: 4, dmg: 2.2, kb: 3, at: 0.15, fx: 'wave', col: '#7fd3ff' }, { t: 'aoe', r: 2.6, off: 6, dmg: 2.6, kb: 4, at: 0.15, fx: 'wave', col: '#7fd3ff' }] },
    },
  },
  monkey: {
    name: 'サル', role: '遠距離・商売上手', color: '#9a6440',
    stats: { hp: 95, atk: 9, spd: 5.0 }, tags: ['climb'],
    passive: { name: '器用', desc: 'お店の値段-20%、ゴールド+15%。木に登れる', mods: { discount: 0.2, gold: 0.15 } },
    kit: {
      normal: { name: '木の実投げ', desc: '木の実を投げつける', cd: 0.38, steps: [{ t: 'proj', n: 1, spd: 14, dmg: 0.85, range: 9, kind: 'nut' }] },
      skill: { name: 'バナナの皮', desc: '前方にバナナの皮をばらまき、敵を転ばせる', cd: 7, steps: [{ t: 'aoe', r: 2.2, off: 3, dmg: 0.5, st: { stun: 1.6 }, fx: 'banana', col: '#ffe066' }] },
      special: { name: '枝渡り', desc: '素早く移動しながら木の実をばらまく', cd: 6, steps: [{ t: 'dash', dist: 4, dur: 0.2 }, { t: 'proj', n: 5, spread: 70, spd: 13, dmg: 0.7, range: 7, kind: 'nut' }] },
      ult: { name: '猿軍団の大宴会', desc: '仲間の猿たちが木の実を雨のように降らせる', steps: [{ t: 'rain', n: 16, area: 6, r: 1.3, dmg: 1.5, gap: 0.06, col: '#ffcc66' }] },
    },
  },
  butterfly: {
    name: 'チョウ', role: '支援・回復', color: '#6fb8f5',
    stats: { hp: 80, atk: 9, spd: 5.2 }, tags: ['fly'],
    passive: { name: '飛翔', desc: '空を飛び、谷や水の上も移動できる。回復量+30%', mods: { heal: 0.3 } },
    kit: {
      normal: { name: '鱗粉弾', desc: '敵を追いかける鱗粉の弾', cd: 0.4, steps: [{ t: 'proj', n: 1, spd: 10, dmg: 0.8, range: 9, kind: 'dust', homing: 4 }] },
      skill: { name: '癒しの鱗粉', desc: '周りの仲間の体力を20%回復', cd: 9, steps: [{ t: 'party', r: 6, heal: 0.2, fx: 'heal' }] },
      special: { name: '幻惑の羽ばたき', desc: '周りの敵を惑わせて動きを遅くする', cd: 10, steps: [{ t: 'aoe', r: 3.2, dmg: 0.6, st: { slow: [0.4, 4] }, fx: 'mist', col: '#c9a6ff' }] },
      ult: { name: '胡蝶の夢', desc: '広い範囲の敵を眠らせ、仲間を大きく回復', steps: [{ t: 'aoe', r: 9, dmg: 0.5, st: { sleep: 3.5 }, fx: 'dream', col: '#e7c6ff' }, { t: 'party', r: 12, heal: 0.4, fx: 'heal' }] },
    },
  },
  beetle: {
    name: 'カブトムシ', role: 'パワー・吹き飛ばし', color: '#5a3f8a',
    stats: { hp: 125, atk: 12, spd: 4.4 }, tags: ['push', 'strong'],
    passive: { name: '剛力', desc: '攻撃力+10%、吹き飛ばし力+50%。重い岩を楽に押せる', mods: { atk: 0.1, kb: 0.5 } },
    kit: {
      normal: { name: '角突き', desc: '角で力強く突く', cd: 0.6, steps: [{ t: 'melee', range: 1.6, arc: 80, dmg: 1.3, kb: 1.5 }] },
      skill: { name: '投げ飛ばし', desc: '前方の敵をすくい上げて投げ飛ばす', cd: 6, steps: [{ t: 'melee', range: 2.1, arc: 100, dmg: 2, kb: 6, st: { stun: 0.6 } }] },
      special: { name: '鋼の甲殻', desc: '盾(最大体力30%)を張り、攻撃力を6秒間20%上げる', cd: 12, steps: [{ t: 'shield', amt: 0.3, dur: 6 }, { t: 'selfbuff', buff: { stat: 'atk', mult: 1.2, dur: 6 } }] },
      ult: { name: '大角衝', desc: '一直線に突進し、すべてを跳ね飛ばす', steps: [{ t: 'dash', dist: 7, dur: 0.3 }, { t: 'line', w: 1.8, dmg: 3.5, kb: 7 }, { t: 'aoe', r: 3, dmg: 2, kb: 4, fx: 'boom', col: '#d6b3ff' }] },
    },
  },
};

export const ANIMAL_KEYS = Object.keys(ANIMALS);

// ---- 融合種（ステージ50で誕生）----
// 組み合わせは順不同で28種。最初の動物の「通常攻撃・スキル」、二体目の「特殊スキル」、
// 両方のパッシブと得意技を受け継ぎ、融合種だけの「融合特性」と「必殺技」を持つ。
export const FUSIONS = {
  'dog+cat': { name: 'ニャルフ', title: '犬猫の王', desc: '犬の忠誠と猫の気まぐれを併せ持つ、群れの頂点。', trait: { name: '王者の気品', desc: '会心率+15%、攻撃力+15%', mods: { crit: 0.15, atk: 0.15 } }, ult: { name: '狩猟本能', desc: '瞬時に背後へ回り込み8連撃、仲間の攻撃力も上げる', steps: [{ t: 'blink', dist: 4 }, ...rep(8, 0.06, { t: 'melee', range: 2.4, arc: 360, dmg: 0.9 }), { t: 'party', r: 8, buff: { stat: 'atk', mult: 1.3, dur: 8 }, fx: 'howl' }] } },
  'dog+rabbit': { name: 'ラビドッグ', title: '跳ね駆ける猟犬', desc: '長い耳で遠くの獲物の足音も聞き逃さない。', trait: { name: '跳ね足', desc: '移動速度+15%、回避クールダウン-30%', mods: { spd: 0.15, dodge: 0.3 } }, ult: { name: '月下の遠吠え', desc: '天高く跳び、着地と同時に咆哮。仲間を加速', steps: [{ t: 'leap', dist: 5, dur: 0.6 }, { t: 'aoe', r: 4, dmg: 3, kb: 4, st: { stun: 1 }, fx: 'boom', col: '#fff3c0' }, { t: 'party', r: 9, buff: { stat: 'spd', mult: 1.3, dur: 8 }, fx: 'howl' }] } },
  'dog+snake': { name: 'ヴァイパーハウンド', title: '毒牙の番犬', desc: 'かまれた者は眠れぬ夜を過ごすという。', trait: { name: '猛毒の牙', desc: '毒ダメージ+60%、攻撃力+10%', mods: { poison: 0.6, atk: 0.1 } }, ult: { name: '毒狼の連牙', desc: '毒の牙で6連撃し、毒の衝撃波を放つ', steps: [...rep(6, 0.08, { t: 'melee', range: 2, arc: 180, dmg: 1, st: { poison: [0.6, 5] } }), { t: 'aoe', r: 4, dmg: 1.5, st: { poison: [1, 6] }, fx: 'mist', col: '#8fe07a' }] } },
  'dog+crab': { name: 'シェルケルベロス', title: '甲殻の門番', desc: '三つの頭と鋼の甲羅で、仲間の前に立ちはだかる。', trait: { name: '番犬の甲羅', desc: '被ダメージ-15%、最大体力+20%', mods: { dmgTaken: 0.15, hp: 0.2 } }, ult: { name: '三首の大鋏', desc: '三方向を同時に挟み、仲間全員に盾を張る', steps: [{ t: 'aoe', r: 2, off: 2, dmg: 2.5, kb: 3, fx: 'boom', col: '#ff8a6a' }, { t: 'aoe', r: 2.6, dmg: 2.5, kb: 3, fx: 'boom', col: '#ff8a6a' }, { t: 'party', r: 10, shield: 0.35, fx: 'shield' }] } },
  'dog+monkey': { name: 'エテイヌ', title: '森の悪戯番長', desc: '宝物と悪戯が大好き。どこにでも鼻を突っ込む。', trait: { name: '宝探しの勘', desc: 'ゴールド+30%', mods: { gold: 0.3 } }, ult: { name: '縦横無尽', desc: '駆け回りながら木の実の雨を降らせる', steps: [{ t: 'dash', dist: 5, dur: 0.2 }, { t: 'line', w: 1.4, dmg: 2, kb: 3 }, { t: 'rain', n: 14, area: 6, r: 1.4, dmg: 1.6, gap: 0.05, col: '#ffcc66' }] } },
  'dog+butterfly': { name: 'パピヨンロウ', title: '蝶翼の聖犬', desc: '蝶の羽を持つ聖なる犬。空を駆け、傷を癒す。', trait: { name: '聖なる守護', desc: '回復量+40%、毎秒0.5%回復', mods: { heal: 0.4, regen: 0.005 } }, ult: { name: '聖翼の咆哮', desc: '仲間を50%回復し、敵をまとめてひるませる', steps: [{ t: 'party', r: 12, heal: 0.5, fx: 'heal' }, { t: 'aoe', r: 5, dmg: 1.5, st: { stun: 1.5 }, fx: 'dream', col: '#fff6c9' }] } },
  'dog+beetle': { name: 'カブトイヌ', title: '鋼角の猛犬', desc: '額に輝く大角。その突進は岩をも砕く。', trait: { name: '鋼の角', desc: '攻撃力+20%、吹き飛ばし+40%', mods: { atk: 0.2, kb: 0.4 } }, ult: { name: '鋼牙突進', desc: '長距離を突進し、通り道を粉砕する', steps: [{ t: 'dash', dist: 8, dur: 0.3 }, { t: 'line', w: 2, dmg: 4, kb: 7 }, { t: 'aoe', r: 3, dmg: 2, fx: 'boom', col: '#ffb860' }] } },
  'cat+rabbit': { name: 'ミミニャン', title: '月夜の踊り子', desc: '長い耳と尻尾で、月明かりの下を舞い踊る。', trait: { name: '月光の足取り', desc: '回避率+15%、移動速度+10%', mods: { evade: 0.15, spd: 0.1 } }, ult: { name: '月影乱舞', desc: '三度瞬間移動し、そのたびに斬撃の輪を放つ', steps: [{ t: 'blink', dist: 3 }, { t: 'aoe', r: 2.2, dmg: 2, fx: 'slashring', col: '#b9a3ff' }, { t: 'blink', dist: 3, at: 0.15 }, { t: 'aoe', r: 2.2, dmg: 2, fx: 'slashring', col: '#b9a3ff' }, { t: 'blink', dist: 3, at: 0.15 }, { t: 'aoe', r: 3, dmg: 3, fx: 'boom', col: '#fff3c0' }] } },
  'cat+snake': { name: 'ナーガキャット', title: '妖しき蛇猫', desc: '金色の瞳に睨まれた者は石のように固まる。', trait: { name: '妖眼', desc: '会心率+10%、毒ダメージ+40%', mods: { crit: 0.1, poison: 0.4 } }, ult: { name: '邪眼', desc: '広範囲の敵を金縛りにし、毒を浴びせる', steps: [{ t: 'aoe', r: 7, dmg: 1.2, st: { stun: 2.5, poison: [0.8, 5] }, fx: 'dream', col: '#d6ff7a' }] } },
  'cat+crab': { name: 'クラブキャット', title: '鋏爪の剣豪', desc: '二本の鋏を刀のように操る、海辺の剣士。', trait: { name: '剣豪の構え', desc: '攻撃力+15%、被ダメージ-10%', mods: { atk: 0.15, dmgTaken: 0.1 } }, ult: { name: '双鋏十字斬', desc: '全方位を4度、重く斬り裂く', steps: rep(4, 0.12, { t: 'melee', range: 3, arc: 360, dmg: 2.2, kb: 2 }) } },
  'cat+monkey': { name: 'サルネコ', title: '樹上の怪盗', desc: '音もなく忍び寄り、宝も獲物もさらっていく。', trait: { name: '怪盗の手際', desc: 'ゴールド+25%、会心率+10%', mods: { gold: 0.25, crit: 0.1 } }, ult: { name: '怪盗の夜', desc: '姿を消して移動し、周囲に木の実の雨', steps: [{ t: 'blink', dist: 5 }, { t: 'rain', n: 14, area: 5, r: 1.4, dmg: 1.8, gap: 0.05, col: '#ffcc66' }] } },
  'cat+butterfly': { name: 'フェアリーキャット', title: '夢見る妖精猫', desc: '蝶の羽で夢の中を飛び回る。気まぐれな妖精。', trait: { name: '夢の翅', desc: '回避率+10%、回復量+30%', mods: { evade: 0.1, heal: 0.3 } }, ult: { name: '夢幻爪', desc: '敵を眠らせ、夢の中で切り裂く', steps: [{ t: 'aoe', r: 6, dmg: 0.5, st: { sleep: 2 }, fx: 'dream', col: '#e7c6ff' }, ...rep(6, 0.08, { t: 'melee', range: 3, arc: 360, dmg: 1 })] } },
  'cat+beetle': { name: 'ホーンキャット', title: '甲冑の猫騎士', desc: '甲殻の鎧をまとった誇り高き騎士猫。', trait: { name: '騎士の誓い', desc: '被ダメージ-15%、攻撃力+10%', mods: { dmgTaken: 0.15, atk: 0.1 } }, ult: { name: '騎士の一閃', desc: '一瞬で駆け抜け、一直線に斬る', steps: [{ t: 'dash', dist: 7, dur: 0.15 }, { t: 'line', w: 1.6, dmg: 5, kb: 3 }] } },
  'rabbit+snake': { name: 'ウロボラビット', title: '輪廻の白蛇兎', desc: '尾をくわえた白い蛇兎。命の輪を巡らせる。', trait: { name: '輪廻', desc: '毎秒1%回復、回復量+20%', mods: { regen: 0.01, heal: 0.2 } }, ult: { name: '輪廻の環', desc: '仲間を30%回復し、毒の輪を広げる', steps: [{ t: 'party', r: 10, heal: 0.3, fx: 'heal' }, { t: 'proj', ring: true, n: 12, spd: 9, dmg: 1.2, range: 9, kind: 'poison', st: { poison: [0.6, 4] } }] } },
  'rabbit+crab': { name: 'カニウサギ', title: '浜辺の跳躍者', desc: '砂浜を跳ね回る、鋏を持ったウサギ。', trait: { name: '潮風の甲羅', desc: '被ダメージ-15%、移動速度+10%', mods: { dmgTaken: 0.15, spd: 0.1 } }, ult: { name: '潮跳び', desc: '二度跳躍し、着地のたびに波を起こす', steps: [{ t: 'leap', dist: 4, dur: 0.4 }, { t: 'aoe', r: 2.8, dmg: 2.2, kb: 3, fx: 'wave', col: '#7fd3ff' }, { t: 'leap', dist: 4, dur: 0.4 }, { t: 'aoe', r: 3.2, dmg: 2.6, kb: 4, fx: 'wave', col: '#7fd3ff' }] } },
  'rabbit+monkey': { name: 'ハネザル', title: '跳ね猿', desc: '木から木へ、雲から雲へ。止まることを知らない。', trait: { name: '跳ね回り', desc: '移動速度+20%', mods: { spd: 0.2 } }, ult: { name: '天まで跳べ', desc: '高く跳び上がり、上空から木の実を降らせる', steps: [{ t: 'leap', dist: 3, dur: 0.6 }, { t: 'rain', n: 14, area: 6, r: 1.4, dmg: 1.8, gap: 0.05, col: '#ffcc66' }] } },
  'rabbit+butterfly': { name: 'ルナフライ', title: '月光の舞い手', desc: '月の光を羽に集め、仲間に分け与える。', trait: { name: '月の加護', desc: '回復量+50%', mods: { heal: 0.5 } }, ult: { name: '月光の祝福', desc: '仲間を60%回復し、攻撃力と速度を上げる', steps: [{ t: 'party', r: 14, heal: 0.6, buff: { stat: 'atk', mult: 1.25, dur: 8 }, fx: 'heal' }, { t: 'party', r: 14, buff: { stat: 'spd', mult: 1.2, dur: 8 }, fx: 'howl' }] } },
  'rabbit+beetle': { name: 'ツノウサギ', title: '一角の月兎', desc: '額の角は月の欠片でできているという。', trait: { name: '一角', desc: '攻撃力+15%、吹き飛ばし+30%', mods: { atk: 0.15, kb: 0.3 } }, ult: { name: '流星角', desc: '流星のように落下して大爆発を起こす', steps: [{ t: 'leap', dist: 7, dur: 0.7 }, { t: 'aoe', r: 3.8, dmg: 4, kb: 6, st: { stun: 1 }, fx: 'boom', col: '#fff3c0' }] } },
  'snake+crab': { name: 'ヒドラクラブ', title: '深海の毒甲', desc: '深海に潜む、毒と甲羅の怪物。', trait: { name: '深海の殻', desc: '被ダメージ-15%、毒ダメージ+30%', mods: { dmgTaken: 0.15, poison: 0.3 } }, ult: { name: '深淵の渦', desc: '敵を渦に引き込み、毒で縛る', steps: [{ t: 'pull', r: 7, str: 5 }, { t: 'aoe', r: 3.5, dmg: 2, at: 0.25, st: { poison: [1, 5], slow: [0.4, 4] }, fx: 'wave', col: '#5fe0b0' }] } },
  'snake+monkey': { name: 'ジャングルナーガ', title: '密林の支配者', desc: 'つるのように枝を這い、密林を自在に操る。', trait: { name: '密林の知恵', desc: 'お店の値段-15%、毒ダメージ+30%', mods: { discount: 0.15, poison: 0.3 } }, ult: { name: '密林の罠', desc: '一帯につるの罠を張り巡らせる', steps: [{ t: 'rain', n: 12, area: 6, r: 1.6, dmg: 1.2, gap: 0.06, st: { stun: 1.2, poison: [0.5, 4] }, col: '#8fe07a' }] } },
  'snake+butterfly': { name: 'ククルカン', title: '羽ある蛇神', desc: '虹色の羽を持つ蛇の神。古き祭壇に祀られていた。', trait: { name: '神性', desc: '攻撃力+15%、回復量+30%', mods: { atk: 0.15, heal: 0.3 } }, ult: { name: '羽蛇神の降臨', desc: '追尾する光の羽を16枚放ち、仲間を癒す', steps: [{ t: 'proj', ring: true, n: 16, spd: 8, dmg: 1.3, range: 10, kind: 'dust', homing: 5 }, { t: 'party', r: 10, heal: 0.3, fx: 'heal' }] } },
  'snake+beetle': { name: 'ヨロイヘビ', title: '鎧の大蛇', desc: '甲殻の鎧に覆われた大蛇。その締め付けは鋼をも曲げる。', trait: { name: '鉄の鱗', desc: '被ダメージ-20%', mods: { dmgTaken: 0.2 } }, ult: { name: '鉄鎖締め', desc: '周囲の敵を3秒間締め上げる', steps: [{ t: 'aoe', r: 4, dmg: 3, st: { stun: 3 }, fx: 'coil', col: '#d6b3ff' }] } },
  'crab+monkey': { name: 'ヤシガニザル', title: '椰子の島の主', desc: '椰子の実を素手で割る、南の島の主。', trait: { name: '島の主', desc: 'ゴールド+20%、被ダメージ-10%', mods: { gold: 0.2, dmgTaken: 0.1 } }, ult: { name: 'ヤシの実爆撃', desc: '重いヤシの実を雨のように落とす', steps: [{ t: 'rain', n: 14, area: 6, r: 1.6, dmg: 2, kb: 2, gap: 0.06, col: '#c9a36a' }] } },
  'crab+butterfly': { name: 'マリンフェアリー', title: '珊瑚礁の妖精', desc: '珊瑚礁を守る妖精。泡の盾で仲間を包む。', trait: { name: '泡の加護', desc: '回復量+30%、被ダメージ-10%', mods: { heal: 0.3, dmgTaken: 0.1 } }, ult: { name: '珊瑚の楯', desc: '仲間全員に大きな盾を張り、回復する', steps: [{ t: 'party', r: 14, shield: 0.5, heal: 0.2, fx: 'shield' }] } },
  'crab+beetle': { name: 'ギガントシェル', title: '不動の要塞', desc: '二重の甲殻を持つ、歩く要塞。', trait: { name: '要塞', desc: '被ダメージ-25%、最大体力+25%', mods: { dmgTaken: 0.25, hp: 0.25 } }, ult: { name: '要塞化', desc: '自分に巨大な盾を張り、周囲を吹き飛ばす', steps: [{ t: 'shield', amt: 0.8, dur: 8 }, { t: 'aoe', r: 4, dmg: 2.5, kb: 7, fx: 'boom', col: '#ff8a6a' }] } },
  'monkey+butterfly': { name: 'ソラザル', title: '雲上の仙猿', desc: '雲に乗って空を翔ける、仙人のような猿。', trait: { name: '仙術', desc: 'クールダウン-15%、回復量+20%', mods: { cdr: 0.15, heal: 0.2 } }, ult: { name: '雲渡り', desc: '雲に乗って移動し、15発の仙術弾を放つ', steps: [{ t: 'blink', dist: 4 }, { t: 'proj', n: 15, spread: 160, spd: 12, dmg: 1.2, range: 9, kind: 'dust', homing: 3 }] } },
  'monkey+beetle': { name: 'ヘラクレスエイプ', title: '怪力の大猿', desc: '角と剛腕を持つ大猿。大地をも割る。', trait: { name: '怪力', desc: '攻撃力+25%', mods: { atk: 0.25 } }, ult: { name: '大地割り', desc: '地面を叩き割り、周囲の敵をひるませる', steps: [{ t: 'aoe', r: 5, dmg: 4, kb: 5, st: { stun: 1.5 }, fx: 'boom', col: '#ffb860' }] } },
  'butterfly+beetle': { name: 'ハネカブト', title: '天翔ける甲虫王', desc: '虹色の羽と黄金の角。森の虫たちの王。', trait: { name: '虫の王', desc: '攻撃力+15%、回復量+20%', mods: { atk: 0.15, heal: 0.2 } }, ult: { name: '天空落とし', desc: '上空から8度、角を突き立てる', steps: [{ t: 'rain', n: 8, area: 5, r: 2.2, dmg: 3, kb: 4, gap: 0.12, col: '#d6b3ff' }] } },
};

export function fusionKey(a, b) {
  const ia = ANIMAL_KEYS.indexOf(a), ib = ANIMAL_KEYS.indexOf(b);
  return ia < ib ? `${a}+${b}` : `${b}+${a}`;
}

// 「dog」または「dog+cat」(並び順=ベース+相方) から完全な種族定義を作る
export function speciesOf(key) {
  if (!key.includes('+')) {
    const a = ANIMALS[key];
    return { key, base: key, mate: null, name: a.name, title: a.role, color: a.color, stats: a.stats, tags: a.tags, passives: [a.passive], kit: a.kit, fusion: null };
  }
  const [base, mate] = key.split('+');
  const A = ANIMALS[base], B = ANIMALS[mate];
  const F = FUSIONS[fusionKey(base, mate)];
  const avg = (k) => Math.round(((A.stats[k] + B.stats[k]) / 2) * 1.3 * 10) / 10;
  return {
    key, base, mate, name: F.name, title: F.title, desc: F.desc, color: A.color,
    stats: { hp: Math.round(avg('hp')), atk: avg('atk'), spd: Math.max(A.stats.spd, B.stats.spd) },
    tags: [...new Set([...A.tags, ...B.tags])],
    passives: [A.passive, B.passive, F.trait],
    kit: { normal: A.kit.normal, skill: A.kit.skill, special: B.kit.special, ult: F.ult },
    fusion: F,
  };
}

// ---- アイテム ----
export const ITEMS = {
  herb: { name: '回復の木の実', desc: '体力を50%回復する', price: 25, heal: 0.5 },
  fang: { name: '鋭い牙', desc: '攻撃力+15%', price: 60, mods: { atk: 0.15 } },
  acorn: { name: 'どんぐりの殻', desc: '受けるダメージ-10%', price: 55, mods: { dmgTaken: 0.1 } },
  feather: { name: '疾風の羽', desc: '移動速度+10%', price: 45, mods: { spd: 0.1 } },
  hourglass: { name: '小さな砂時計', desc: 'スキルのクールダウン-12%', price: 70, mods: { cdr: 0.12 } },
  seed: { name: '命の種', desc: '最大体力+20%', price: 55, mods: { hp: 0.2 } },
  bell: { name: '招き猫の鈴', desc: 'ゴールド獲得+25%', price: 45, mods: { gold: 0.25 } },
  clover: { name: '四つ葉', desc: '会心率+10%', price: 60, mods: { crit: 0.1 } },
  honey: { name: 'ハチミツ壺', desc: '毎秒体力0.6%回復', price: 65, mods: { regen: 0.006 } },
  phoenix: { name: '不死鳥の羽根', desc: '倒れた時に一度だけ自力で復活する', price: 120, revive: 1 },
  // 動物専用（覚醒アイテム）
  wolfcollar: { for: 'dog', name: '古狼の首輪', desc: '【覚醒】疾風突進の終わりに衝撃波が起き、敵をひるませる', price: 110, awaken: { slot: 'special', add: [{ t: 'aoe', r: 2.6, dmg: 1.5, st: { stun: 0.8 }, fx: 'boom', col: '#ffb860' }] } },
  bone: { for: 'dog', name: '骨のお守り', desc: '攻撃力+20%、必殺ゲージ増加+20%', price: 80, mods: { atk: 0.2, ultGain: 0.2 } },
  catbell: { for: 'cat', name: '妖猫の鈴', desc: '【覚醒】影渡りの後、8方向に爪の衝撃波を放つ', price: 110, awaken: { slot: 'skill', add: [{ t: 'proj', ring: true, n: 8, spd: 12, dmg: 0.9, range: 6, kind: 'claw' }] } },
  matatabi: { for: 'cat', name: 'またたび', desc: '会心率+20%', price: 75, mods: { crit: 0.2 } },
  moonear: { for: 'rabbit', name: '月の耳飾り', desc: '【覚醒】大跳躍の着地範囲が広がり、威力が2倍に', price: 110, awaken: { slot: 'skill', patch: { type: 'aoe', r: 3.2, dmg: 3.2 } } },
  carrot: { for: 'rabbit', name: 'にんじんの束', desc: '移動速度+15%、毎秒0.5%回復', price: 75, mods: { spd: 0.15, regen: 0.005 } },
  snakescale: { for: 'snake', name: '蛇神の鱗', desc: '【覚醒】毒液が5方向・貫通になる', price: 110, awaken: { slot: 'skill', patch: { type: 'proj', n: 5, spread: 50, pierce: 3 } } },
  slough: { for: 'snake', name: '抜け殻の衣', desc: '毒ダメージ+50%', price: 75, mods: { poison: 0.5 } },
  coral: { for: 'crab', name: '珊瑚の冠', desc: '【覚醒】甲羅の守りで仲間の攻撃力も上がる', price: 110, awaken: { slot: 'skill', add: [{ t: 'party', r: 6, buff: { stat: 'atk', mult: 1.25, dur: 6 }, fx: 'howl' }] } },
  pearl: { for: 'crab', name: '真珠', desc: '受けるダメージ-15%', price: 75, mods: { dmgTaken: 0.15 } },
  goldstaff: { for: 'monkey', name: '金の如意棒', desc: '【覚醒】木の実投げが3つ同時・貫通になる', price: 110, awaken: { slot: 'normal', patch: { type: 'proj', n: 3, spread: 20, pierce: 2 } } },
  goldbanana: { for: 'monkey', name: '黄金バナナ', desc: 'ゴールド+30%', price: 60, mods: { gold: 0.3 } },
  rainbow: { for: 'butterfly', name: '虹色の鱗粉', desc: '【覚醒】鱗粉弾が3発同時になる', price: 110, awaken: { slot: 'normal', patch: { type: 'proj', n: 3, spread: 30 } } },
  nectar: { for: 'butterfly', name: '花の蜜', desc: '回復量+40%', price: 75, mods: { heal: 0.4 } },
  kinghorn: { for: 'beetle', name: '王者の角', desc: '【覚醒】投げ飛ばしが全方位攻撃になる', price: 110, awaken: { slot: 'skill', patch: { type: 'melee', arc: 360, range: 2.8 } } },
  sap: { for: 'beetle', name: 'クヌギの樹液', desc: '攻撃力+15%、吹き飛ばし+50%', price: 75, mods: { atk: 0.15, kb: 0.5 } },
};
export const GENERAL_ITEMS = Object.keys(ITEMS).filter((k) => !ITEMS[k].for);

// ---- レベルアップ時の成長 ----
export const PERKS = [
  { id: 'atk', name: '鋭い爪', desc: '攻撃力+12%', mods: { atk: 0.12 } },
  { id: 'hp', name: '厚い毛皮', desc: '最大体力+15%', mods: { hp: 0.15 } },
  { id: 'spd', name: '俊足', desc: '移動速度+8%', mods: { spd: 0.08 } },
  { id: 'cdr', name: '集中', desc: 'クールダウン-10%', mods: { cdr: 0.1 } },
  { id: 'crit', name: '急所狙い', desc: '会心率+8%', mods: { crit: 0.08 } },
  { id: 'ls', name: '吸血', desc: '与ダメージの3%を回復', mods: { ls: 0.03 } },
  { id: 'regen', name: '自然治癒', desc: '毎秒体力0.5%回復', mods: { regen: 0.005 } },
  { id: 'ult', name: '魂の共鳴', desc: '必殺ゲージ増加+25%', mods: { ultGain: 0.25 } },
  { id: 'def', name: '守りの心得', desc: '受けるダメージ-8%', mods: { dmgTaken: 0.08 } },
  { id: 'aoe', name: '大きな体', desc: '攻撃範囲+12%', mods: { aoe: 0.12 } },
];

// ---- 敵 ----
export const ENEMIES = {
  mouse: { name: '野ネズミ', hp: 26, atk: 6, spd: 3.4, r: 0.35, ai: 'chase', range: 1.0, scale: 0.75, xp: 4, gold: 2 },
  boar: { name: 'イノシシ', hp: 60, atk: 11, spd: 2.4, r: 0.5, ai: 'charge', scale: 1.1, xp: 8, gold: 4 },
  wasp: { name: 'スズメバチ', hp: 24, atk: 7, spd: 3.0, r: 0.35, ai: 'ranged', fly: true, scale: 0.8, xp: 6, gold: 3 },
  shroom: { name: '毒キノコ', hp: 45, atk: 6, spd: 0, r: 0.45, ai: 'turret', scale: 0.9, xp: 6, gold: 3 },
  lizard: { name: 'トカゲ兵', hp: 50, atk: 9, spd: 2.8, r: 0.45, ai: 'chase', range: 1.2, scale: 1, xp: 7, gold: 4 },
  crow: { name: 'カラス', hp: 30, atk: 8, spd: 4.0, r: 0.4, ai: 'swoop', fly: true, scale: 0.9, xp: 6, gold: 3 },
  bear: { name: '森の主・オオグマ', boss: true, hp: 950, atk: 16, spd: 2.3, r: 1.1, scale: 2.6, attacks: ['slam', 'charge', 'summon', 'slam'], summon: 'mouse', xp: 120, gold: 80 },
  queen: { name: '女王スズメバチ', boss: true, hp: 850, atk: 13, spd: 2.8, r: 0.9, fly: true, scale: 2.3, attacks: ['ring', 'barrage', 'summon'], summon: 'wasp', xp: 140, gold: 100 },
  croc: { name: '沼の大ワニ', boss: true, hp: 1150, atk: 18, spd: 2.1, r: 1.2, scale: 2.7, attacks: ['charge', 'sweep', 'slam'], xp: 160, gold: 120 },
  owl: { name: '夜の大フクロウ', boss: true, hp: 1000, atk: 15, spd: 3.0, r: 1, fly: true, scale: 2.5, attacks: ['blink', 'ring', 'barrage', 'blink'], xp: 180, gold: 140 },
  dragon: { name: '黒炎竜', boss: true, hp: 1600, atk: 20, spd: 2.3, r: 1.3, scale: 3.1, attacks: ['cone', 'rain', 'charge', 'ring'], xp: 250, gold: 200 },
};
export const BOSS_ORDER = ['bear', 'queen', 'croc', 'owl', 'dragon'];

// ---- 地域（10ステージごとに変化）----
export const BIOMES = [
  { name: '木漏れ日の森', top: ['#5f9e46', '#6fb050', '#4f8a3c'], side: ['#7a5a3c', '#6a4c32', '#8a6a48'], rock: '#8b8a85', sky: '#a9d4f0', fog: '#b9dcc0', sun: '#fff1d0', sunI: 2.6, amb: 0.9, deco: ['tree', 'bush', 'flower'], particles: 'pollen', enemies: ['mouse', 'mouse', 'boar', 'wasp'] },
  { name: 'さざなみの浜辺', top: ['#e6d29a', '#efdcaa', '#d8c088'], side: ['#c2a26a', '#b08f5a', '#d0b27c'], rock: '#a89d8a', sky: '#bfe8ff', fog: '#cdeefa', sun: '#fff8e6', sunI: 2.9, amb: 1.0, deco: ['palm', 'shell', 'bush'], particles: 'pollen', water: true, enemies: ['mouse', 'crow', 'lizard', 'boar'] },
  { name: '水晶の洞窟', top: ['#5d6070', '#676a7c', '#535665'], side: ['#3c3d4c', '#34354a', '#46475a'], rock: '#6f6a86', sky: '#1a1830', fog: '#23203a', sun: '#a9a4ff', sunI: 0.9, amb: 0.45, deco: ['crystal', 'shroomdeco', 'torch'], particles: 'motes', enemies: ['shroom', 'lizard', 'crow', 'wasp'] },
  { name: '紅葉の山道', top: ['#c98a3c', '#d79a48', '#b97a32'], side: ['#7a5236', '#6a462c', '#8a5e40'], rock: '#8e857a', sky: '#f2d2a8', fog: '#f0d2b0', sun: '#ffd9a0', sunI: 2.4, amb: 0.85, deco: ['autumn', 'bush', 'flower'], particles: 'leaves', enemies: ['boar', 'lizard', 'crow', 'shroom'] },
  { name: '白銀の雪原', top: ['#e8eef5', '#f4f7fb', '#d8e1ec'], side: ['#9aa6b8', '#8a96aa', '#aab6c8'], rock: '#9aa3b0', sky: '#dfe9f5', fog: '#e6eef7', sun: '#f2f6ff', sunI: 2.2, amb: 1.0, deco: ['pine', 'snowbush', 'crystal'], particles: 'snow', enemies: ['wasp', 'boar', 'crow', 'lizard'] },
  { name: '星降る神域', top: ['#5a4c8a', '#66579a', '#4e4280'], side: ['#33295a', '#2b234e', '#3d3266'], rock: '#7a6fa6', sky: '#120f2a', fog: '#1d1840', sun: '#c9b8ff', sunI: 1.1, amb: 0.55, deco: ['crystal', 'pine', 'torch'], particles: 'fireflies', enemies: ['shroom', 'crow', 'lizard', 'boar', 'wasp'] },
];

// ---- なぞなぞ ----
export const RIDDLES = [
  { q: 'パンはパンでも、食べられないパンはなーんだ？', a: ['フライパン', 'メロンパン', 'あんパン'] },
  { q: '横にしか歩けないのに、はさみを持っている生き物は？', a: ['カニ', 'ザリガニ', 'クワガタ'] },
  { q: '足が一本もないのに、しっぽだけはとても長い生き物は？', a: ['ヘビ', 'ウナギ', 'トカゲ'] },
  { q: '歯がたくさんあるのに、何も食べないものは？', a: ['くし', 'ワニ', 'のこぎりザメ'] },
  { q: '上がったり下がったりするけど、一歩も動かないものは？', a: ['階段', 'ブランコ', '鳥'] },
  { q: '割らないと使えないものは？', a: ['たまご', 'ガラス', '石'] },
  { q: '穴だらけなのに、水をたくさん溜められるものは？', a: ['スポンジ', 'バケツ', 'コップ'] },
  { q: '背中に家を背負って、ゆっくり進む生き物は？', a: ['カタツムリ', 'カメ', 'ヤドカリ'] },
  { q: '昼は空にいなくて、夜になると現れる明かりは？', a: ['星', '太陽', '虹'] },
  { q: 'いつも逆さまにぶら下がって眠る動物は？', a: ['コウモリ', 'フクロウ', 'ナマケモノ'] },
  { q: '使えば使うほど小さくなる文房具は？', a: ['消しゴム', '定規', 'ハサミ'] },
  { q: 'さなぎから生まれて、花の蜜を吸う生き物は？', a: ['チョウ', 'ハチ', 'カブトムシ'] },
];

export const PILLAR_COLORS = ['#ff6b6b', '#ffd166', '#6be38f', '#6bb8ff'];
export const PILLAR_NAMES = ['赤', '黄', '緑', '青'];

export type ShogiTerm = {
  jp: string;
  en: string;
  category: "piece" | "opening" | "tactic" | "position" | "general" | "name";
};

export const SHOGI_DICTIONARY: ShogiTerm[] = [
  // 人名（name）絶対に変えないこと。誤変換・推測変換を禁止
  { jp: "鈴木肇", en: "Hajime Suzuki", category: "name" },

  // 駒（piece）
  { jp: "玉将", en: "King", category: "piece" },
  { jp: "王将", en: "King", category: "piece" },
  { jp: "飛車", en: "Rook", category: "piece" },
  { jp: "角行", en: "Bishop", category: "piece" },
  { jp: "金将", en: "Gold General", category: "piece" },
  { jp: "銀将", en: "Silver General", category: "piece" },
  { jp: "桂馬", en: "Knight", category: "piece" },
  { jp: "香車", en: "Lance", category: "piece" },
  { jp: "歩兵", en: "Pawn", category: "piece" },
  { jp: "竜王", en: "Promoted Rook (Dragon)", category: "piece" },
  { jp: "竜馬", en: "Promoted Bishop (Horse)", category: "piece" },
  { jp: "成銀", en: "Promoted Silver", category: "piece" },
  { jp: "成桂", en: "Promoted Knight", category: "piece" },
  { jp: "成香", en: "Promoted Lance", category: "piece" },
  { jp: "と金", en: "Promoted Pawn (Tokin)", category: "piece" },

  // 戦法・囲い（opening）
  { jp: "振り飛車", en: "Ranging Rook", category: "opening" },
  { jp: "居飛車", en: "Static Rook", category: "opening" },
  { jp: "四間飛車", en: "Fourth File Rook", category: "opening" },
  { jp: "三間飛車", en: "Third File Rook", category: "opening" },
  { jp: "中飛車", en: "Central Rook", category: "opening" },
  { jp: "向かい飛車", en: "Opposing Rook", category: "opening" },
  { jp: "向飛車", en: "Opposing Rook", category: "opening" },
  { jp: "袖飛車", en: "Sleeve Rook", category: "opening" },
  { jp: "右四間飛車", en: "Right Fourth File Rook", category: "opening" },
  { jp: "ゴキゲン中飛車", en: "Gokigen Central Rook", category: "opening" },
  { jp: "ゴキゲン", en: "Gokigen", category: "opening" },
  { jp: "石田流", en: "Ishida Style", category: "opening" },
  { jp: "藤井システム", en: "Fujii System", category: "opening" },
  { jp: "矢倉", en: "Yagura (Fortress)", category: "opening" },
  { jp: "美濃囲い", en: "Mino Castle", category: "opening" },
  { jp: "高美濃", en: "High Mino", category: "opening" },
  { jp: "銀冠", en: "Silver Crown", category: "opening" },
  { jp: "穴熊", en: "Anaguma (Bear-in-the-Hole)", category: "opening" },
  { jp: "居飛車穴熊", en: "Static Rook Anaguma", category: "opening" },
  { jp: "振り飛車穴熊", en: "Ranging Rook Anaguma", category: "opening" },
  { jp: "舟囲い", en: "Boat Castle", category: "opening" },
  { jp: "船囲い", en: "Boat Castle", category: "opening" },
  { jp: "elmo囲い", en: "Elmo Castle", category: "opening" },
  { jp: "ミレニアム", en: "Millennium Castle", category: "opening" },
  { jp: "雁木", en: "Gangi", category: "opening" },
  { jp: "中原囲い", en: "Nakahara Castle", category: "opening" },
  { jp: "片美濃", en: "Single Mino", category: "opening" },
  { jp: "ダイヤモンド美濃", en: "Diamond Mino", category: "opening" },
  { jp: "角換わり", en: "Bishop Exchange", category: "opening" },
  { jp: "相掛かり", en: "Double Wing Attack", category: "opening" },
  { jp: "横歩取り", en: "Yokofudori (Side Pawn Capture)", category: "opening" },
  { jp: "棒銀", en: "Climbing Silver", category: "opening" },
  { jp: "早繰り銀", en: "Rapid Silver", category: "opening" },
  { jp: "腰掛け銀", en: "Reclining Silver", category: "opening" },
  { jp: "中飛車左穴熊", en: "Central Rook Left Anaguma", category: "opening" },
  { jp: "嬉野流", en: "Ureshino Style", category: "opening" },
  { jp: "筋違い角", en: "Off-Diagonal Bishop", category: "opening" },
  { jp: "鬼殺し", en: "Demon Killer", category: "opening" },

  // 戦術・手筋（tactic）
  { jp: "詰み", en: "Checkmate", category: "tactic" },
  { jp: "詰将棋", en: "Tsume Shogi (Mating Problem)", category: "tactic" },
  { jp: "必至", en: "Hisshi (Forced Mate)", category: "tactic" },
  { jp: "王手", en: "Check", category: "tactic" },
  { jp: "両王手", en: "Double Check", category: "tactic" },
  { jp: "受け", en: "Defense", category: "tactic" },
  { jp: "攻め", en: "Attack", category: "tactic" },
  { jp: "捌き", en: "Sabaki (Piece Coordination)", category: "tactic" },
  { jp: "手筋", en: "Tesuji", category: "tactic" },
  { jp: "好手", en: "Good Move", category: "tactic" },
  { jp: "妙手", en: "Brilliant Move", category: "tactic" },
  { jp: "悪手", en: "Bad Move", category: "tactic" },
  { jp: "疑問手", en: "Dubious Move", category: "tactic" },
  { jp: "勝負手", en: "Decisive Move", category: "tactic" },
  { jp: "頓死", en: "Sudden Death (Tonshi)", category: "tactic" },
  { jp: "入玉", en: "King Entering", category: "tactic" },
  { jp: "持将棋", en: "Jishogi (Drawn Game)", category: "tactic" },
  { jp: "千日手", en: "Sennichite (Repetition)", category: "tactic" },
  { jp: "二歩", en: "Nifu (Double Pawn Foul)", category: "tactic" },
  { jp: "成る", en: "Promote", category: "tactic" },
  { jp: "成り", en: "Promotion", category: "tactic" },
  { jp: "不成", en: "Non-Promotion", category: "tactic" },
  { jp: "打つ", en: "Drop", category: "tactic" },
  { jp: "打ち歩詰め", en: "Pawn Drop Mate (Illegal)", category: "tactic" },
  { jp: "持ち駒", en: "Pieces in Hand", category: "tactic" },
  { jp: "駒得", en: "Material Advantage", category: "tactic" },
  { jp: "駒損", en: "Material Loss", category: "tactic" },
  { jp: "捨て駒", en: "Sacrifice", category: "tactic" },
  { jp: "垂れ歩", en: "Hanging Pawn", category: "tactic" },
  { jp: "継ぎ歩", en: "Joining Pawn", category: "tactic" },
  { jp: "焦点", en: "Focal Point", category: "tactic" },

  // 局面・棋風（position）
  { jp: "序盤", en: "Opening", category: "position" },
  { jp: "中盤", en: "Middlegame", category: "position" },
  { jp: "終盤", en: "Endgame", category: "position" },
  { jp: "寄せ", en: "Mating Attack", category: "position" },
  { jp: "玉形", en: "King's Shape", category: "position" },
  { jp: "薄い", en: "Thin (Vulnerable)", category: "position" },
  { jp: "厚い", en: "Thick (Solid)", category: "position" },
  { jp: "堅い", en: "Solid", category: "position" },
  { jp: "急戦", en: "Rapid Attack", category: "position" },
  { jp: "持久戦", en: "Slow Game", category: "position" },
  { jp: "棋譜", en: "Game Record (Kifu)", category: "position" },

  // 一般（general）
  { jp: "先手", en: "Sente (Black)", category: "general" },
  { jp: "後手", en: "Gote (White)", category: "general" },
  { jp: "対局", en: "Game", category: "general" },
  { jp: "投了", en: "Resignation", category: "general" },
  { jp: "棋士", en: "Pro Shogi Player", category: "general" },
  { jp: "女流棋士", en: "Female Pro Player", category: "general" },
  { jp: "奨励会", en: "Shoreikai", category: "general" },
  { jp: "プロ棋士", en: "Professional Shogi Player", category: "general" },
  { jp: "アマチュア", en: "Amateur", category: "general" },
  { jp: "段位", en: "Dan Rank", category: "general" },
  { jp: "級位", en: "Kyu Rank", category: "general" },
  { jp: "名人", en: "Meijin", category: "general" },
  { jp: "竜王戦", en: "Ryuoh Tournament", category: "general" },
  { jp: "名人戦", en: "Meijin Tournament", category: "general" },
  { jp: "王位戦", en: "Oui Tournament", category: "general" },
  { jp: "王座戦", en: "Ouza Tournament", category: "general" },
  { jp: "棋王戦", en: "Kio Tournament", category: "general" },
  { jp: "王将戦", en: "Osho Tournament", category: "general" },
  { jp: "棋聖戦", en: "Kisei Tournament", category: "general" },
  { jp: "叡王戦", en: "Eiou Tournament", category: "general" },
  { jp: "タイトル戦", en: "Title Match", category: "general" },
  { jp: "升田幸三賞", en: "Masuda Kozo Award", category: "general" },
  { jp: "将棋連盟", en: "Japan Shogi Association", category: "general" },
];

/**
 * 入力文中で辞書語を検出し、AIに渡す「強制対訳ヒント」を組み立てる
 * 長い語から順にマッチングし、部分一致の競合を避ける
 *
 * extraTerms: ユーザーが翻訳前画面で確認した「セッション辞書」。
 *             同じ jp があれば extraTerms を優先する（ユーザー指定が常に最強）
 */
export function buildTranslationHints(
  input: string,
  extraTerms: ShogiTerm[] = []
): {
  hints: ShogiTerm[];
  hintBlock: string;
} {
  const extraMap = new Map(extraTerms.map((t) => [t.jp, t]));
  const merged: ShogiTerm[] = [
    ...extraTerms,
    ...SHOGI_DICTIONARY.filter((t) => !extraMap.has(t.jp)),
  ];
  const sorted = [...merged].sort((a, b) => b.jp.length - a.jp.length);
  const found: ShogiTerm[] = [];
  const seen = new Set<string>();
  for (const term of sorted) {
    if (input.includes(term.jp) && !seen.has(term.jp)) {
      found.push(term);
      seen.add(term.jp);
    }
  }
  if (found.length === 0) return { hints: [], hintBlock: "" };

  const lines = found.map((t) => `「${t.jp}」 → "${t.en}"`).join("\n");
  const hintBlock = `\n\n以下の将棋用語・固有名詞は必ずこの英訳を用いること（他の訳語を使わない・推測変換禁止）：\n${lines}`;
  return { hints: found, hintBlock };
}

/**
 * 逆向き（英語→日本語）用のヒント。
 * 英文中に「将棋用語の英語定訳」が含まれていたら、その日本語訳をAIに教える。
 *
 * 英語側はどう訳しても自然になりやすい一方、Anaguma / Mino Castle / Ranging Rook /
 * Tesuji のような将棋固有語は、AIが標準的な日本語（穴熊・美濃囲い・振り飛車・手筋）に
 * 戻せないことがある。そこをこのヒントで補強する。
 *
 * ただし英語→日本語は誤検出（普通の英単語が将棋用語に化ける）のリスクが高いので、
 * "King" "Game" "Check" のような一般的すぎる単語は対象から外し、
 * プロンプト側でも「文脈上明らかに将棋の意味のときだけ」という逃げ道を残す。
 */
const REVERSE_SKIP = new Set(
  [
    "King",
    "Rook",
    "Bishop",
    "Knight",
    "Lance",
    "Pawn",
    "Check",
    "Drop",
    "Promote",
    "Promotion",
    "Game",
    "Attack",
    "Defense",
    "Opening",
    "Endgame",
    "Middlegame",
    "Solid",
    "Thin",
    "Thick",
    "Amateur",
    "Resignation",
    "Sacrifice",
    "Good Move",
    "Bad Move",
  ].map((s) => s.toLowerCase())
);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Anaguma (Bear-in-the-Hole)" → "Anaguma" のように、照合用のキー（括弧書きを除く）を作る */
function reverseMatchKey(en: string): string {
  return en
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildReverseTranslationHints(
  input: string,
  extraTerms: ShogiTerm[] = []
): {
  hints: ShogiTerm[];
  hintBlock: string;
} {
  const lower = input.toLowerCase();
  const extraMap = new Map(extraTerms.map((t) => [t.jp, t]));
  const merged: ShogiTerm[] = [
    ...extraTerms,
    ...SHOGI_DICTIONARY.filter((t) => !extraMap.has(t.jp)),
  ];

  const candidates = merged
    .map((t) => ({ t, key: reverseMatchKey(t.en) }))
    .filter((c) => c.key.length >= 3 && !REVERSE_SKIP.has(c.key.toLowerCase()))
    // 長いキーから先に照合（"Static Rook Anaguma" を "Anaguma" より先に拾う）
    .sort((a, b) => b.key.length - a.key.length);

  const found: ShogiTerm[] = [];
  const seenJp = new Set<string>();
  const seenKey = new Set<string>();
  for (const { t, key } of candidates) {
    const lowKey = key.toLowerCase();
    if (seenKey.has(lowKey)) continue;
    const re = new RegExp(`\\b${escapeRegExp(lowKey)}\\b`);
    if (re.test(lower) && !seenJp.has(t.jp)) {
      found.push(t);
      seenJp.add(t.jp);
      seenKey.add(lowKey);
    }
  }
  if (found.length === 0) return { hints: [], hintBlock: "" };

  const lines = found
    .map((t) => `"${reverseMatchKey(t.en)}" → 「${t.jp}」`)
    .join("\n");
  const hintBlock = `\n\n次の将棋用語が英文に出てきた場合は、原則この日本語の定訳を使うこと（文脈上あきらかに将棋の意味でない場合のみ例外）：\n${lines}`;
  return { hints: found, hintBlock };
}

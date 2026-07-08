/**
 * Word pools for synthetic Japanese fixture generation.
 *
 * Hand-curated rather than corpus-derived so the repo stays self-contained and
 * the kanji/kana ratio is controllable: KANJI_NOUNS and VERBS carry the Han
 * characters that drive `<ruby>` injection and the kanji-run splitting in
 * splitKanjiKana, while PARTICLES/PUNCT supply the kana glue that segmentAndWrap
 * must walk past without wrapping. The mix here is what makes a fixture's token
 * count translate into a realistic span count.
 */

// Multi-kanji compounds — the heaviest case for splitKanjiKana / injectFurigana.
export const KANJI_NOUNS = [
  '日本語', '文章', '学校', '先生', '学生', '会社', '電話', '時間', '世界', '人間',
  '問題', '仕事', '経済', '社会', '政治', '科学', '技術', '情報', '教育', '文化',
  '歴史', '自然', '環境', '国際', '関係', '研究', '開発', '産業', '市場', '価格',
  '言葉', '気持', '理由', '結果', '方法', '場合', '部分', '全体', '中心', '周辺',
  '東京', '大阪', '京都', '北海道', '九州', '名前', '住所', '電車', '飛行機', '自動車',
];

// Single-kanji nouns — exercise the single-kanji-run branch of splitKanjiKana.
export const KANJI_SINGLE = ['人', '本', '水', '火', '山', '川', '空', '海', '木', '花', '年', '月', '日', '国', '町'];

// Verbs with okurigana — kanji stem + trailing kana, the leading/trailing-run path.
export const VERBS = [
  '食べる', '飲む', '見る', '行く', '来る', '話す', '書く', '読む', '聞く', '考える',
  '思う', '知る', '使う', '作る', '始める', '終わる', '続ける', '変わる', '決める', '集める',
];

// I-adjectives and na-adjectives (na written with trailing な kana).
export const ADJECTIVES = [
  '新しい', '古い', '大きい', '小さい', '高い', '安い', '良い', '悪い', '早い', '遅い',
  '難しい', '簡単な', '重要な', '必要な', '便利な', '静かな', '有名な', '元気な',
];

// Pure-kana glue. These must NOT receive furigana; they pad token counts.
export const PARTICLES = ['は', 'が', 'を', 'に', 'で', 'と', 'も', 'から', 'まで', 'へ', 'の', 'や', 'ね', 'よ'];

export const ADVERBS = ['とても', 'よく', 'また', 'すぐ', 'もう', 'まだ', 'ずっと', 'たぶん'];

export const CONJUNCTIONS = ['しかし', 'それで', 'だから', 'つまり', 'また', 'ただし', 'なお'];

export const PUNCT = ['。', '、'];

// Latin filler for the "sparse" variant — Japanese interleaved with non-Japanese
// text and markup, which stresses segmentAndWrap's text-node walk / skip logic.
export const LATIN_WORDS = [
  'the', 'data', 'system', 'page', 'note', 'card', 'study', 'review', 'item',
  'value', 'index', 'token', 'block', 'inline', 'content', 'render',
];

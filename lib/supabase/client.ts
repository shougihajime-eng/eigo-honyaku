import { createClient } from "@supabase/supabase-js";

/**
 * このプロジェクトは共有 Supabase（eqkaaohdbqefuszxwqzr）の `eigo_honyaku` スキーマだけを使う。
 * 他プロジェクト（hissatsu, keiba 等）のテーブルには触れない。
 *
 * 型は緩めに any にしている（DB スキーマの完全な型定義は重いため。
 * 呼び出し側で必要な行型に明示キャストする）
 */
const SCHEMA = "eigo_honyaku";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;
let cached: SB | null = null;

export function getSupabase(): SB | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // 環境変数が無いときは null を返し、辞書学習は単に無効化する（致命エラーにしない）
    return null;
  }
  cached = createClient(url, anonKey, { db: { schema: SCHEMA } });
  return cached;
}

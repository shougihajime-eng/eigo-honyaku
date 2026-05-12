/**
 * ユーザー辞書（自動学習版）
 *
 * 「翻訳前の固有名詞確認画面」でユーザーが確定した英訳を保存し、
 * 次回以降の動画でも自動的に正解として使う。
 * Supabase が無い／繋がらない場合は静かに空配列を返し、機能停止しないようにする。
 */
import { getSupabase } from "@/lib/supabase/client";
import type { ShogiTerm } from "@/lib/shogi-dictionary";

const TABLE = "user_dictionary";

export type UserDictEntry = {
  jp: string;
  en: string;
  category: string;
};

/**
 * 全件取得（プロジェクト全体の学習辞書として使う）
 */
export async function fetchUserDictionary(): Promise<ShogiTerm[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from(TABLE)
      .select("jp,en,category")
      .order("updated_at", { ascending: false });
    if (error) {
      console.warn("[user-dict] fetch error", error.message);
      return [];
    }
    const rows = (data ?? []) as Array<{ jp: string; en: string; category: string }>;
    return rows.map((r) => ({
      jp: String(r.jp),
      en: String(r.en),
      // ShogiTerm.category の範囲に合わない値も来うるので general に丸める
      category: (["piece", "opening", "tactic", "position", "general", "name"].includes(
        String(r.category)
      )
        ? String(r.category)
        : "general") as ShogiTerm["category"],
    }));
  } catch (e) {
    console.warn("[user-dict] fetch exception", e);
    return [];
  }
}

/**
 * 複数件まとめて upsert（jp で衝突したら en・updated_at・used_count を更新）
 */
export async function upsertUserDictionary(
  entries: UserDictEntry[]
): Promise<{ saved: number }> {
  const sb = getSupabase();
  if (!sb || entries.length === 0) return { saved: 0 };
  const sanitized = entries
    .map((e) => ({
      jp: (e.jp ?? "").trim(),
      en: (e.en ?? "").trim(),
      category: (e.category ?? "general").trim() || "general",
    }))
    .filter((e) => e.jp && e.en);
  if (sanitized.length === 0) return { saved: 0 };

  try {
    const { error } = await sb
      .from(TABLE)
      .upsert(sanitized, { onConflict: "jp", ignoreDuplicates: false });
    if (error) {
      console.warn("[user-dict] upsert error", error.message);
      return { saved: 0 };
    }
    return { saved: sanitized.length };
  } catch (e) {
    console.warn("[user-dict] upsert exception", e);
    return { saved: 0 };
  }
}

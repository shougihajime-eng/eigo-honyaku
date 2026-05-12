import { NextRequest, NextResponse } from "next/server";
import {
  fetchUserDictionary,
  upsertUserDictionary,
  type UserDictEntry,
} from "@/lib/dictionary/user-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET: 学習済み辞書の全件取得 */
export async function GET() {
  const entries = await fetchUserDictionary();
  return NextResponse.json({ entries });
}

/** POST: 確定した固有名詞を保存（既存の jp は en を上書き） */
export async function POST(req: NextRequest) {
  try {
    const { entries } = (await req.json()) as { entries?: UserDictEntry[] };
    if (!Array.isArray(entries)) {
      return NextResponse.json({ error: "entries が必要です" }, { status: 400 });
    }
    const { saved } = await upsertUserDictionary(entries);
    return NextResponse.json({ saved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `辞書の保存に失敗: ${msg}` },
      { status: 500 }
    );
  }
}

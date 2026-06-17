"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// どのページでも画面に固定で見える「← ホーム」ボタン。
// 長いページを下にスクロールしても消えない（position:fixed）。トップ（/）では出さない。
export default function HomeFab() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <Link
      href="/"
      aria-label="ホームへもどる"
      className="fixed left-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 rounded-full bg-violet-600 text-white font-bold text-sm px-4 py-3 shadow-lg shadow-black/40 active:scale-95"
    >
      ← ホーム
    </Link>
  );
}

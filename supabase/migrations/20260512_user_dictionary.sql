-- 翻訳辞書の自動学習用テーブル
-- 「翻訳前の固有名詞確認画面」でユーザーが確定した英訳をここに保存し、
-- 次回以降の動画で自動的に正解として使う。

CREATE SCHEMA IF NOT EXISTS eigo_honyaku;

CREATE TABLE IF NOT EXISTS eigo_honyaku.user_dictionary (
  id BIGSERIAL PRIMARY KEY,
  jp TEXT NOT NULL UNIQUE,
  en TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  source TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_user_dict_jp ON eigo_honyaku.user_dictionary (jp);

CREATE OR REPLACE FUNCTION eigo_honyaku.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_dict_updated_at ON eigo_honyaku.user_dictionary;
CREATE TRIGGER user_dict_updated_at
  BEFORE UPDATE ON eigo_honyaku.user_dictionary
  FOR EACH ROW
  EXECUTE FUNCTION eigo_honyaku.touch_updated_at();

ALTER TABLE eigo_honyaku.user_dictionary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_dict_read ON eigo_honyaku.user_dictionary;
CREATE POLICY user_dict_read ON eigo_honyaku.user_dictionary
  FOR SELECT USING (true);

DROP POLICY IF EXISTS user_dict_insert ON eigo_honyaku.user_dictionary;
CREATE POLICY user_dict_insert ON eigo_honyaku.user_dictionary
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS user_dict_update ON eigo_honyaku.user_dictionary;
CREATE POLICY user_dict_update ON eigo_honyaku.user_dictionary
  FOR UPDATE USING (true);

GRANT USAGE ON SCHEMA eigo_honyaku TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON eigo_honyaku.user_dictionary TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE eigo_honyaku.user_dictionary_id_seq TO anon, authenticated;

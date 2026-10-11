-- Schema đầy đủ cho LuvTK Ent (chạy trong Supabase SQL Editor để dựng lại DB)
-- App dùng anon key và chạy như một singleton cá nhân nên RLS được tắt

CREATE TABLE IF NOT EXISTS movies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  year TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  overview TEXT,
  rating NUMERIC,
  genres JSONB DEFAULT '[]'::jsonb,
  runtime INTEGER,
  category TEXT DEFAULT 'watchlist',
  watched_episodes JSONB DEFAULT '[]'::jsonb,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comics (
  id TEXT PRIMARY KEY,
  title TEXT,
  cover TEXT,
  status TEXT,
  genres JSONB DEFAULT '[]'::jsonb,
  description TEXT,
  source_url TEXT,
  chapters JSONB DEFAULT '[]'::jsonb,
  last_read_chapter INTEGER,
  last_read_at TIMESTAMPTZ,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  is_starred BOOLEAN DEFAULT false,
  auto_delete_old_chapters BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS music (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT,
  content TEXT,
  type TEXT,
  note TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

-- Karaoke songs (sync giữa PC và mobile)
CREATE TABLE IF NOT EXISTS karaoke (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT,
  lyrics TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

ALTER TABLE movies DISABLE ROW LEVEL SECURITY;
ALTER TABLE comics DISABLE ROW LEVEL SECURITY;
ALTER TABLE music DISABLE ROW LEVEL SECURITY;
ALTER TABLE karaoke DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;

GRANT ALL ON movies, comics, music, karaoke, settings TO anon, authenticated;

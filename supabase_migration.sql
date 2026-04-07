-- Run this in your Supabase SQL Editor to add the new columns for the Music tab feature and Star/Featured feature

-- Add is_starred and auto_delete_old_chapters columns to 'comics' table if they don't exist
ALTER TABLE comics 
  ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_delete_old_chapters BOOLEAN DEFAULT false;

-- If you also want to sync Music materials, you should create the 'music' table
CREATE TABLE IF NOT EXISTS music (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT,
  content TEXT,
  type TEXT,
  note TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

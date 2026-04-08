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

-- Fix: Add missing columns if the table was created previously without them
ALTER TABLE music
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT,
  ADD COLUMN IF NOT EXISTS note TEXT;

-- Fix RLS Error 401: Disable Row Level Security (RLS) entirely since the application functions as a local singleton
ALTER TABLE music DISABLE ROW LEVEL SECURITY;

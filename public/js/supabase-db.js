/**
 * Supabase Cloud DB wrapper for LuvTK Entertainment
 * Mirrors the AppDB (IndexedDB) interface so it can be used as a transparent sync layer
 */

const SUPABASE_URL = 'https://qhkrfsprauhraelnwouc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoa3Jmc3ByYXVocmFlbG53b3VjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MDc3NDcsImV4cCI6MjEwNzI4Mzc0N30.TncT07sw4m2hhOdpg6UyVn1ys-WUO5HZxmVWTQrtBtE';

class SupabaseDB {
  constructor() {
    this.baseUrl = `${SUPABASE_URL}/rest/v1`;
    this.headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };
    this.online = true;
  }

  async _request(path, options = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...this.headers, ...options.headers },
    });
    if (!res.ok) {
      let errText = await res.text();
      try { const obj = JSON.parse(errText); errText = obj.message || obj.details || errText; } catch(e) {}
      console.warn(`[SupabaseDB] Error ${res.status}: ${errText}`);
      this.online = false;
      throw new Error(`Cloud Error ${res.status}: ${errText}`);
    }
    const text = await res.text();
    this.online = true;
    return text ? JSON.parse(text) : null;
  }

  // ========= MOVIES =========

  async saveMovie(movie) {
    const row = this._movieToRow(movie);
    return this._request('/movies', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
  }

  async getMovie(id) {
    const rows = await this._request(`/movies?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows && rows[0] ? this._rowToMovie(rows[0]) : null;
  }

  async getMoviesByCategory(category) {
    const rows = await this._request(`/movies?category=eq.${encodeURIComponent(category)}&order=added_at.desc`);
    return rows ? rows.map(r => this._rowToMovie(r)) : [];
  }

  async getAllMovies() {
    const rows = await this._request('/movies?order=added_at.desc');
    return rows ? rows.map(r => this._rowToMovie(r)) : [];
  }

  async deleteMovie(id) {
    return this._request(`/movies?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async updateMovieCategory(id, newCategory) {
    return this._request(`/movies?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ category: newCategory }),
    });
  }

  // ========= COMICS =========

  async saveComic(comic) {
    const row = this._comicToRow(comic);
    return this._request('/comics', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
  }

  async getComic(id) {
    const rows = await this._request(`/comics?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows && rows[0] ? this._rowToComic(rows[0]) : null;
  }

  async getAllComics() {
    const rows = await this._request('/comics?order=saved_at.desc');
    return rows ? rows.map(r => this._rowToComic(r)) : [];
  }

  async deleteComic(id) {
    return this._request(`/comics?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async updateComicReadProgress(id, chapterIndex) {
    return this._request(`/comics?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        last_read_chapter: chapterIndex,
        last_read_at: new Date().toISOString(),
      }),
    });
  }

  // ========= MUSIC =========

  async saveMusic(music) {
    const row = this._musicToRow(music);
    return this._request('/music', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
  }

  async getMusic(id) {
    const rows = await this._request(`/music?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows && rows[0] ? this._rowToMusic(rows[0]) : null;
  }

  async getAllMusic() {
    const rows = await this._request('/music?order=added_at.desc');
    return rows ? rows.map(r => this._rowToMusic(r)) : [];
  }

  async deleteMusic(id) {
    return this._request(`/music?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // ========= KARAOKE =========

  async saveKaraoke(song) {
    const row = this._karaokeToRow(song);
    return this._request('/karaoke', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
  }

  async getAllKaraoke() {
    const rows = await this._request('/karaoke?order=added_at.desc');
    return rows ? rows.map(r => this._rowToKaraoke(r)) : [];
  }

  async deleteKaraoke(id) {
    return this._request(`/karaoke?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // ========= SETTINGS =========

  async setSetting(key, value) {
    return this._request('/settings', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify({ key, value: String(value) }),
    });
  }

  async getSetting(key) {
    const rows = await this._request(`/settings?key=eq.${encodeURIComponent(key)}&limit=1`);
    return rows && rows[0] ? rows[0].value : null;
  }

  // ========= DATA CONVERSION =========
  // Convert between camelCase (JS) and snake_case (Postgres)

  _movieToRow(movie) {
    return {
      id: String(movie.id),
      title: movie.title,
      year: movie.year || null,
      poster_path: movie.posterPath || null,
      backdrop_path: movie.backdropPath || null,
      overview: movie.overview || null,
      rating: movie.rating || null,
      genres: movie.genres || [],
      runtime: movie.runtime || null,
      category: movie.category || 'watchlist',
      watched_episodes: movie.watchedEpisodes || [],
      added_at: movie.addedAt || new Date().toISOString(),
    };
  }

  _rowToMovie(row) {
    return {
      id: row.id,
      title: row.title,
      year: row.year,
      posterPath: row.poster_path,
      backdropPath: row.backdrop_path,
      overview: row.overview,
      rating: row.rating ? Number(row.rating) : null,
      genres: row.genres || [],
      runtime: row.runtime,
      category: row.category,
      watchedEpisodes: row.watched_episodes || [],
      addedAt: row.added_at,
    };
  }

  _comicToRow(comic) {
    return {
      id: String(comic.id),
      title: comic.title,
      cover: comic.cover || null,
      status: comic.status || null,
      genres: comic.genres || [],
      description: comic.description || null,
      source_url: comic.url || comic.sourceUrl || null,
      chapters: comic.chapters || [],
      last_read_chapter: comic.lastReadChapter !== undefined ? comic.lastReadChapter : null,
      last_read_at: comic.lastReadAt || null,
      saved_at: comic.savedAt || new Date().toISOString(),
      is_starred: comic.isStarred || false,
      auto_delete_old_chapters: comic.autoDeleteOldChapters || false,
    };
  }

  _rowToComic(row) {
    return {
      id: row.id,
      title: row.title,
      cover: row.cover,
      status: row.status,
      genres: row.genres || [],
      description: row.description,
      url: row.source_url,
      sourceUrl: row.source_url,
      chapters: row.chapters || [],
      lastReadChapter: row.last_read_chapter,
      lastReadAt: row.last_read_at,
      savedAt: row.saved_at,
      isStarred: row.is_starred || false,
      autoDeleteOldChapters: row.auto_delete_old_chapters || false,
    };
  }

  _musicToRow(music) {
    return {
      id: String(music.id),
      title: music.title,
      url: music.url || null,
      content: music.content || null,
      type: music.type || 'chords',
      note: music.note || null,
      added_at: music.addedAt || new Date().toISOString(),
    };
  }

  _rowToMusic(row) {
    return {
      id: row.id,
      title: row.title,
      url: row.url,
      content: row.content,
      type: row.type,
      note: row.note,
      addedAt: row.added_at,
    };
  }

  _karaokeToRow(song) {
    return {
      id: String(song.id),
      title: song.title,
      artist: song.artist || null,
      lyrics: song.lyrics || null,
      added_at: song.addedAt || new Date().toISOString(),
      updated_at: song.updatedAt || new Date().toISOString(),
    };
  }

  _rowToKaraoke(row) {
    return {
      id: row.id,
      title: row.title,
      artist: row.artist || '',
      lyrics: row.lyrics || '',
      addedAt: row.added_at,
      updatedAt: row.updated_at,
    };
  }

  // ========= AUTO-FIX: Patch missing source_url from id =========

  async fixMissingSourceUrls() {
    try {
      // First, try to add source_url column if it doesn't exist
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
          method: 'POST',
          headers: this.headers,
        }).catch(() => {});
      } catch(e) {}

      // Test if source_url column exists by querying a single row
      const testRes = await fetch(`${this.baseUrl}/comics?select=source_url&limit=1`, {
        headers: { ...this.headers },
      });
      if (!testRes.ok) {
        console.log('[SupabaseDB] source_url column does not exist yet, skipping fix');
        return 0;
      }
      const testText = await testRes.text();
      if (testText.includes('column') || testText.includes('does not exist') || testText.includes('page')) {
        console.log('[SupabaseDB] source_url column not ready, skipping fix');
        return 0;
      }

      // Fetch comics that have no source_url
      const rows = await this._request('/comics?source_url=is.null&select=id');
      const httpRows = (rows || []).filter(r => r.id && r.id.startsWith('http'));
      
      if (httpRows.length === 0) {
        console.log('[SupabaseDB] All comics already have source_url ✓');
        return 0;
      }

      console.log(`[SupabaseDB] Fixing ${httpRows.length} comics missing source_url...`);
      let fixed = 0;

      for (const row of httpRows) {
        await this._request(`/comics?id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ source_url: row.id }),
        });
        fixed++;
      }

      console.log(`[SupabaseDB] Fixed ${fixed} comics ✓`);
      return fixed;
    } catch (err) {
      console.warn('[SupabaseDB] fixMissingSourceUrls error:', err.message);
      return 0;
    }
  }

  // ========= SYNC =========

  async syncFromLocal(localDB) {
    console.log('[SupabaseDB] Starting push to Supabase...');
    let synced = { movies: 0, comics: 0, settings: 0, music: 0, karaoke: 0 };

    // Sync movies
    const movies = await localDB.getAllMovies();
    for (const movie of movies) {
      await this.saveMovie(movie);
      synced.movies++;
    }

    // Sync comics  
    const comics = await localDB.getAllComics();
    for (const comic of comics) {
      await this.saveComic(comic);
      synced.comics++;
    }

    // Sync music
    const musicLib = await localDB.getAllMusic();
    for (const m of musicLib) {
      await this.saveMusic(m);
      synced.music++;
    }

    // Sync karaoke
    const karaokeSongs = await localDB.getAllKaraoke();
    for (const song of karaokeSongs) {
      await this.saveKaraoke(song);
      synced.karaoke++;
    }

    console.log(`[SupabaseDB] Push complete:`, synced);
    return synced;
  }

  async syncToLocal(localDB) {
    console.log('[SupabaseDB] Starting pull from Supabase...');
    let synced = { movies: 0, comics: 0, settings: 0 };

    const remoteMovies = await this.getAllMovies();
    for (const m of remoteMovies) {
      // Direct call to local indexedDB so it doesn't bounce back to cloud again
      await localDB.moviesDB.put(m);
      synced.movies++;
    }

    const remoteComics = await this.getAllComics();
    for (const c of remoteComics) {
      await localDB.comicsDB.put(c);
      synced.comics++;
    }

    console.log(`[SupabaseDB] Pull complete:`, synced);
    return synced;
  }
}

// Global instance
window.cloudDB = new SupabaseDB();

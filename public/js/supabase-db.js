/**
 * Supabase Cloud DB wrapper for LuvTK Entertainment
 * Mirrors the AppDB (IndexedDB) interface so it can be used as a transparent sync layer
 */

const SUPABASE_URL = 'https://oovyokamkxhtjixngdpn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vdnlva2Fta3hodGppeG5nZHBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MTQzOTQsImV4cCI6MjA5MTA5MDM5NH0.Nt_kcWNT-x8ol2mTrJzy0xTTc5WOA9mGNlk7lHcWuHc';

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
      source_url: comic.sourceUrl || null,
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
      sourceUrl: row.source_url,
      chapters: row.chapters || [],
      lastReadChapter: row.last_read_chapter,
      lastReadAt: row.last_read_at,
      savedAt: row.saved_at,
      isStarred: row.is_starred || false,
      autoDeleteOldChapters: row.auto_delete_old_chapters || false,
    };
  }

  // ========= SYNC =========

  async syncFromLocal(localDB) {
    console.log('[SupabaseDB] Starting push to Supabase...');
    let synced = { movies: 0, comics: 0, settings: 0 };

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

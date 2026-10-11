/**
 * IndexedDB wrapper for LuvTK Entertainment
 * Handles local storage for movies, crawl history, and comic library
 * With automatic cloud sync to Supabase
 */
const DB_NAME = 'luvtk_ent';
const DB_VERSION = 4;

class AppDB {
  constructor() {
    this.db = null;
  }

  // Helper: fire-and-forget cloud sync
  _cloudSync(fn) {
    if (window.cloudDB) {
      try { fn(window.cloudDB).catch(e => console.warn('[CloudSync]', e.message)); } catch(e) {}
    }
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Movies store
        if (!db.objectStoreNames.contains('movies')) {
          const moviesStore = db.createObjectStore('movies', { keyPath: 'id' });
          moviesStore.createIndex('category', 'category', { unique: false });
          moviesStore.createIndex('addedAt', 'addedAt', { unique: false });
        }

        // Crawl history store
        if (!db.objectStoreNames.contains('crawlHistory')) {
          const historyStore = db.createObjectStore('crawlHistory', { keyPath: 'id', autoIncrement: true });
          historyStore.createIndex('date', 'date', { unique: false });
        }

        // Music materials store
        if (!db.objectStoreNames.contains('music')) {
          const musicStore = db.createObjectStore('music', { keyPath: 'id' });
          musicStore.createIndex('type', 'type', { unique: false });
          musicStore.createIndex('addedAt', 'addedAt', { unique: false });
        }

        // Karaoke songs store
        if (!db.objectStoreNames.contains('karaoke')) {
          const karaokeStore = db.createObjectStore('karaoke', { keyPath: 'id' });
          karaokeStore.createIndex('title', 'title', { unique: false });
          karaokeStore.createIndex('addedAt', 'addedAt', { unique: false });
        }

        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // Comic Library store - stores full crawl data with images
        if (!db.objectStoreNames.contains('comicLibrary')) {
          const libStore = db.createObjectStore('comicLibrary', { keyPath: 'id' });
          libStore.createIndex('title', 'title', { unique: false });
          libStore.createIndex('savedAt', 'savedAt', { unique: false });
          libStore.createIndex('lastReadAt', 'lastReadAt', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  // ========= MOVIES =========

  async saveMovie(movie) {
    const data = { ...movie, addedAt: movie.addedAt || new Date().toISOString() };
    const result = await this._put('movies', data);
    this._cloudSync(cloud => cloud.saveMovie(data));
    return result;
  }

  async getMovie(id) {
    return this._get('movies', id);
  }

  async getMoviesByCategory(category) {
    return this._getByIndex('movies', 'category', category);
  }

  async getAllMovies() {
    return this._getAll('movies');
  }

  async deleteMovie(id) {
    const result = await this._delete('movies', id);
    this._cloudSync(cloud => cloud.deleteMovie(id));
    return result;
  }

  async updateMovieCategory(id, newCategory) {
    const movie = await this.getMovie(id);
    if (movie) {
      movie.category = newCategory;
      return this.saveMovie(movie);
    }
  }

  // ========= CRAWL HISTORY =========

  async addCrawlHistory(entry) {
    return this._put('crawlHistory', {
      ...entry,
      date: new Date().toISOString(),
    });
  }

  async getCrawlHistory() {
    const all = await this._getAll('crawlHistory');
    return all.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  async clearCrawlHistory() {
    return this._clear('crawlHistory');
  }

  // ========= COMIC LIBRARY =========

  async saveComic(comic) {
    const data = { ...comic, savedAt: comic.savedAt || new Date().toISOString() };
    const result = await this._put('comicLibrary', data);
    this._cloudSync(cloud => cloud.saveComic(data));
    return result;
  }

  async getComic(id) {
    return this._get('comicLibrary', id);
  }

  async getAllComics() {
    const all = await this._getAll('comicLibrary');
    return all.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  }

  async deleteComic(id) {
    const result = await this._delete('comicLibrary', id);
    this._cloudSync(cloud => cloud.deleteComic(id));
    return result;
  }

  async updateComicReadProgress(id, chapterIndex) {
    const comic = await this.getComic(id);
    if (comic) {
      comic.lastReadChapter = chapterIndex;
      comic.lastReadAt = new Date().toISOString();
      const result = await this.saveComic(comic);
      this._cloudSync(cloud => cloud.updateComicReadProgress(id, chapterIndex));
      return result;
    }
  }

  // ========= MUSIC MATERIALS =========

  async saveMusic(musicData) {
    const data = { ...musicData, addedAt: musicData.addedAt || new Date().toISOString() };
    const result = await this._put('music', data);
    this._cloudSync(cloud => cloud.saveMusic(data));
    return result;
  }

  async getMusic(id) {
    return this._get('music', id);
  }

  async getAllMusic() {
    const all = await this._getAll('music');
    return all.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  }

  async deleteMusic(id) {
    const result = await this._delete('music', id);
    this._cloudSync(cloud => cloud.deleteMusic(id));
    return result;
  }

  // ========= KARAOKE =========

  async saveKaraoke(song) {
    const data = { ...song, addedAt: song.addedAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    const result = await this._put('karaoke', data);
    this._cloudSync(cloud => cloud.saveKaraoke && cloud.saveKaraoke(data));
    return result;
  }

  async getKaraoke(id) {
    return this._get('karaoke', id);
  }

  async getAllKaraoke() {
    const all = await this._getAll('karaoke');
    return all.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  }

  async deleteKaraoke(id) {
    const result = await this._delete('karaoke', id);
    this._cloudSync(cloud => cloud.deleteKaraoke && cloud.deleteKaraoke(id));
    return result;
  }

  // ========= SETTINGS =========

  async setSetting(key, value) {
    const result = await this._put('settings', { key, value });
    this._cloudSync(cloud => cloud.setSetting(key, value));
    return result;
  }

  async getSetting(key) {
    const item = await this._get('settings', key);
    return item ? item.value : null;
  }

  // ========= EXPORT / IMPORT =========

  async exportAll() {
    const movies = await this.getAllMovies();
    const history = await this.getCrawlHistory();
    const comics = await this.getAllComics();
    const music = await this.getAllMusic();
    const karaoke = await this.getAllKaraoke();

    return {
      version: 4,
      exportedAt: new Date().toISOString(),
      movies,
      crawlHistory: history,
      comicLibrary: comics,
      music,
      karaoke,
      settings: {}
    };
  }

  async importAll(data) {
    if (data.movies) {
      for (const movie of data.movies) {
        await this.saveMovie(movie);
      }
    }
    if (data.crawlHistory) {
      for (const entry of data.crawlHistory) {
        await this.addCrawlHistory(entry);
      }
    }
    if (data.comicLibrary) {
      for (const comic of data.comicLibrary) {
        await this.saveComic(comic);
      }
    }
    if (data.music) {
      for (const mat of data.music) {
        await this.saveMusic(mat);
      }
    }
    if (data.karaoke) {
      for (const song of data.karaoke) {
        await this.saveKaraoke(song);
      }
    }
  }

  async clearAll() {
    await this._clear('movies');
    await this._clear('crawlHistory');
    await this._clear('comicLibrary');
    await this._clear('music');
    await this._clear('karaoke');
    await this._clear('settings');
  }

  // ========= CLOUD SYNC =========

  async syncToCloud() {
    if (!window.cloudDB) {
      throw new Error('Cloud DB not available');
    }
    return window.cloudDB.syncFromLocal(this);
  }

  async syncFromCloud() {
    if (!window.cloudDB) {
      throw new Error('Cloud DB not available');
    }

    const cloudMovies = await window.cloudDB.getAllMovies();
    const cloudComics = await window.cloudDB.getAllComics();
    const cloudMusic = await window.cloudDB.getAllMusic(); // add music fetching

    // Bảng karaoke có thể chưa được tạo trên Supabase → không làm hỏng cả lần sync
    let cloudKaraoke = [];
    try {
      cloudKaraoke = await window.cloudDB.getAllKaraoke();
    } catch (e) {
      console.warn('[CloudSync] Bỏ qua karaoke:', e.message);
    }

    let synced = { movies: 0, comics: 0, music: 0, karaoke: 0 };

    for (const movie of cloudMovies) {
      await this._put('movies', movie);
      synced.movies++;
    }

    for (const comic of cloudComics) {
      await this._put('comicLibrary', comic);
      synced.comics++;
    }

    for (const m of cloudMusic) {
      await this._put('music', m);
      synced.music++;
    }

    for (const song of cloudKaraoke) {
      await this._put('karaoke', song);
      synced.karaoke++;
    }

    return synced;
  }

  // ========= Internal Helpers =========

  _put(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);
      request.onsuccess = () => resolve(data);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  _get(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  _getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  _getByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  _delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  _clear(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }
}

// Global instance
window.appDB = new AppDB();

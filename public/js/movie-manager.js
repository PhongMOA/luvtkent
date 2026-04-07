/**
 * Movie Manager Module
 */
const MovieManager = {
  currentCategory: 'watchlist',

  async init() {
    this.bindEvents();
    this.loadMovies();
  },

  bindEvents() {
    // Search movie
    document.getElementById('btn-search-movie').addEventListener('click', () => this.searchMovie());
    document.getElementById('movie-search').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchMovie();
    });

    // Category tabs
    document.querySelectorAll('.category-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentCategory = tab.dataset.category;
        this.loadMovies();
      });
    });

    document.getElementById('movie-back-btn')?.addEventListener('click', () => {
      this.hideDetail();
    });
  },

  parseSearchQuery(query) {
    // Parse "Movie Name (Year)" format
    const match = query.match(/^(.+?)(?:\s*\((\d{4})\))?$/);
    if (match) {
      return {
        name: match[1].trim(),
        year: match[2] || null,
      };
    }
    return { name: query.trim(), year: null };
  },

  async searchMovie() {
    const query = document.getElementById('movie-search').value.trim();
    if (!query) {
      App.showToast('Vui lòng nhập tên phim', 'warning');
      return;
    }

    const { name, year } = this.parseSearchQuery(query);

    const btn = document.getElementById('btn-search-movie');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-round spin">sync</span><span>Tìm...</span>';

    try {
      const params = new URLSearchParams({
        query: name,
      });
      if (year) params.append('year', year);

      const response = await fetch(`/api/movies/search?${params.toString()}`);
      const result = await response.json();

      if (!result.success) throw new Error(result.error);

      this.renderSearchResults(result.data.results);

      if (result.data.results.length === 0) {
        App.showToast('Không tìm thấy phim nào', 'info');
      }
    } catch (err) {
      App.showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-round">search</span><span>Tìm</span>';
    }
  },

  renderSearchResults(movies) {
    const card = document.getElementById('movie-results-card');
    const grid = document.getElementById('movie-search-results');

    if (movies.length === 0) {
      card.classList.add('hidden');
      return;
    }

    card.classList.remove('hidden');

    grid.innerHTML = movies.slice(0, 12).map(movie => {
      const posterUrl = movie.poster_path
        ? (movie.poster_path.startsWith('http') ? movie.poster_path : `https://image.tmdb.org/t/p/w300${movie.poster_path}`)
        : null;
      const year = movie.release_date ? movie.release_date.substring(0, 4) : '???';
      const rating = movie.vote_average ? movie.vote_average.toFixed(1) : '-';

      return `
        <div class="movie-card" data-movie-id="${movie.id}">
          ${posterUrl
          ? `<img class="movie-poster" src="${posterUrl}" alt="${movie.title}" loading="lazy">`
          : `<div class="movie-poster-placeholder"><span class="material-icons-round">movie</span></div>`
        }
          ${rating !== '-' ? `
          <div class="movie-card-rating">
            <span class="material-icons-round">star</span>
            ${rating}
          </div>` : ''}
          <div class="movie-card-info">
            <div class="movie-card-title">${movie.title}</div>
            <div class="movie-card-year">${year}</div>
          </div>
          <div class="movie-save-select">
            <button class="movie-card-btn" onclick="MovieManager.saveMovie('${movie.id}', 'watchlist', this)" title="Muốn xem">
              <span class="material-icons-round">bookmark_add</span>
            </button>
            <button class="movie-card-btn" onclick="MovieManager.saveMovie('${movie.id}', 'watching', this)" title="Đang xem">
              <span class="material-icons-round">play_circle</span>
            </button>
            <button class="movie-card-btn" onclick="MovieManager.saveMovie('${movie.id}', 'watched', this)" title="Đã xem">
              <span class="material-icons-round">done_all</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  async saveMovie(tmdbId, category, btnEl) {
    try {
      // Get full movie details
      const response = await fetch(`/api/movies/details/${tmdbId}`);
      const result = await response.json();

      if (!result.success) throw new Error(result.error);

      const movie = result.data;

      await window.appDB.saveMovie({
        id: movie.id,
        title: movie.title,
        originalTitle: movie.original_title,
        year: movie.release_date ? movie.release_date.substring(0, 4) : null,
        posterPath: movie.poster_path,
        backdropPath: movie.backdrop_path,
        overview: movie.overview,
        rating: movie.vote_average,
        genres: movie.genres ? movie.genres.map(g => g.name) : [],
        runtime: movie.runtime,
        category: category,
        addedAt: new Date().toISOString(),
      });

      App.showToast(`Đã lưu "${movie.title}"`, 'success');

      // Visual feedback
      if (btnEl) {
        const card = btnEl.closest('.movie-card');
        card.style.opacity = '0.5';
        card.style.pointerEvents = 'none';
      }

      this.loadMovies();
    } catch (err) {
      App.showToast(`Lỗi: ${err.message}`, 'error');
    }
  },

  async loadMovies() {
    const movies = await window.appDB.getMoviesByCategory(this.currentCategory);
    const allMovies = await window.appDB.getAllMovies();

    // Update counts
    const watchlist = allMovies.filter(m => m.category === 'watchlist').length;
    const watching = allMovies.filter(m => m.category === 'watching').length;
    const watched = allMovies.filter(m => m.category === 'watched').length;

    document.getElementById('count-watchlist').textContent = watchlist;
    document.getElementById('count-watching').textContent = watching;
    document.getElementById('count-watched').textContent = watched;

    const grid = document.getElementById('saved-movies-grid');

    if (movies.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1">
          <span class="material-icons-round empty-icon">movie_filter</span>
          <p>Chưa có phim nào</p>
          <p class="empty-hint">Tìm kiếm và thêm phim yêu thích</p>
        </div>
      `;
      return;
    }

    // Sort by added date, newest first
    movies.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    grid.innerHTML = movies.map(movie => {
      const posterUrl = movie.posterPath
        ? (movie.posterPath.startsWith('http') ? movie.posterPath : `https://image.tmdb.org/t/p/w300${movie.posterPath}`)
        : null;

      return `
        <div class="movie-card" data-movie-id="${movie.id}" onclick="MovieManager.showDetail('${movie.id}')" style="cursor: pointer;">
          ${posterUrl
          ? `<img class="movie-poster" src="${posterUrl}" alt="${movie.title}" loading="lazy">`
          : `<div class="movie-poster-placeholder"><span class="material-icons-round">movie</span></div>`
        }
          ${movie.rating ? `
          <div class="movie-card-rating">
            <span class="material-icons-round">star</span>
            ${movie.rating.toFixed(1)}
          </div>` : ''}
          <div class="movie-card-info">
            <div class="movie-card-title">${movie.title}</div>
            <div class="movie-card-year">${movie.year || ''}</div>
          </div>
          <div class="movie-card-actions" onclick="event.stopPropagation()">
            ${MovieManager.getCategoryButtons(movie)}
            <button class="movie-card-btn btn-remove" onclick="MovieManager.removeMovie('${movie.id}')" title="Xóa">
              <span class="material-icons-round">delete</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  async showDetail(movieId) {
    const movies = await window.appDB.getAllMovies();
    const movie = movies.find(m => String(m.id) === String(movieId));
    if (!movie) return;

    this.currentMovie = movie;

    document.getElementById('movie-list-view').classList.add('hidden');
    document.getElementById('movie-detail-view').classList.remove('hidden');

    const posterUrl = movie.posterPath
      ? (movie.posterPath.startsWith('http') ? movie.posterPath : `https://image.tmdb.org/t/p/w300${movie.posterPath}`)
      : null;

    document.getElementById('movie-detail-cover').innerHTML = posterUrl
      ? `<img src="${posterUrl}" alt="Cover">`
      : `<div class="movie-poster-placeholder"><span class="material-icons-round">movie</span></div>`;

    document.getElementById('movie-detail-title').textContent = movie.title;
    document.getElementById('movie-detail-rating').innerHTML = `<span class="material-icons-round" style="font-size:14px;vertical-align:text-bottom;">star</span> ${movie.rating || '-'}`;
    document.getElementById('movie-detail-year').textContent = movie.year || '';
    
    const genresHtml = (movie.genres || []).map(g => `<span class="genre-tag">${g.name || g}</span>`).join('');
    document.getElementById('movie-detail-genres').innerHTML = genresHtml;
    
    document.getElementById('movie-detail-desc').innerHTML = movie.overview || 'Chưa cập nhật nội dung.';

    // Fetch and render episodes
    this.renderEpisodes(movie);
  },

  hideDetail() {
    this.currentMovie = null;
    document.getElementById('movie-detail-view').classList.add('hidden');
    document.getElementById('movie-list-view').classList.remove('hidden');
  },

  async renderEpisodes(movie) {
    const loadingEl = document.getElementById('movie-episodes-loading');
    const listEl = document.getElementById('movie-detail-episodes');
    const noEpsEl = document.getElementById('movie-detail-no-episodes');

    loadingEl.classList.remove('hidden');
    listEl.innerHTML = '';
    noEpsEl.classList.add('hidden');

    try {
      const response = await fetch(`/api/movies/details/${movie.id}/episodes`);
      const result = await response.json();
      loadingEl.classList.add('hidden');

      if (!result.success || !result.data || !result.data.episodes || result.data.episodes.length === 0) {
        noEpsEl.classList.remove('hidden');
        return;
      }

      let episodes = result.data.episodes;
      // Sort by season and episode number
      episodes.sort((a, b) => {
        const sA = parseInt(a.season) || 0;
        const sB = parseInt(b.season) || 0;
        if (sA !== sB) return sA - sB;
        return (a.episodeNumber || 0) - (b.episodeNumber || 0);
      });
      
      episodes.forEach((ep, i) => ep.globalIndex = i);
      
      this.currentEpisodes = episodes;
      this.renderEpisodesList(movie, episodes[0]?.season || "all");
    } catch (e) {
      loadingEl.classList.add('hidden');
      noEpsEl.classList.remove('hidden');
      noEpsEl.textContent = 'Không thể tải tập phim, lỗi kết nối';
    }
  },

  renderEpisodesList(movie, targetSeason) {
    const listEl = document.getElementById('movie-detail-episodes');
    if (!this.currentEpisodes || this.currentEpisodes.length === 0) return;
    
    // Get unique seasons
    const seasons = [...new Set(this.currentEpisodes.map(ep => ep.season || "1"))];
    // Sort seasons numerically
    seasons.sort((a,b) => parseInt(a) - parseInt(b));
    
    let html = '';
    
    // Build selectbox if more than 1 season
    if (seasons.length > 1) {
       html += `
         <div style="margin-bottom: 12px; display:flex; gap: 8px; align-items:center;">
           <span style="font-size: 14px; color: var(--text-secondary);">Chọn Phần:</span>
           <select class="season-select" id="movie-season-select">
             ${seasons.map(s => `<option value="${s}" ${s === String(targetSeason) ? 'selected' : ''}>Phần ${s}</option>`).join('')}
             <option value="all" ${targetSeason === 'all' ? 'selected' : ''}>Tất cả</option>
           </select>
         </div>
       `;
    }

    const watchedSet = new Set(movie.watchedEpisodes || []);
    
    let filteredEpisodes = this.currentEpisodes;
    if (targetSeason !== 'all') {
      filteredEpisodes = this.currentEpisodes.filter(ep => String(ep.season || "1") === String(targetSeason));
    }

    html += filteredEpisodes.map(ep => {
      let epTitle = '';
      if (typeof ep.title === 'string') epTitle = ep.title;
      else if (ep.title && ep.title.text) epTitle = ep.title.text;
      else if (typeof ep.originalTitle === 'string') epTitle = ep.originalTitle;
      
      epTitle = epTitle || '';

      const isWatched = watchedSet.has(ep.globalIndex);
      const seasonStr = ep.season ? `S${ep.season}` : '';
      const epStr = `Tập ${ep.episodeNumber}`;
      const prefix = seasonStr ? `${seasonStr} - ${epStr}` : epStr;
      
      let dateStr = '';
      if (ep.releaseDate) {
        if (ep.releaseDate.year && ep.releaseDate.month && ep.releaseDate.day) {
          dateStr = `${String(ep.releaseDate.day).padStart(2, '0')}/${String(ep.releaseDate.month).padStart(2, '0')}/${ep.releaseDate.year}`;
        } else if (ep.releaseDate.year) {
          dateStr = `${ep.releaseDate.year}`;
        }
      }
      
      return `
        <div class="lib-ch-item ${isWatched ? 'read' : ''}" 
             data-episode="${ep.episodeNumber}" 
             onclick="MovieManager.toggleEpisode(${ep.globalIndex})">
          <span class="material-icons-round" style="font-size: 18px; color: ${isWatched ? 'var(--success)' : 'var(--text-tertiary)'};">
            ${isWatched ? 'check_circle' : 'radio_button_unchecked'}
          </span>
          <span class="lib-ch-name" style="text-overflow: ellipsis; white-space: nowrap; overflow: hidden;" title="${prefix}: ${epTitle}">${prefix}: ${epTitle}</span>
          <span class="lib-ch-images" style="display:flex; justify-content:flex-end; gap: 8px;">
            ${dateStr ? `<span style="opacity:0.7">${dateStr}</span>` : ''}
            ${ep.rating?.aggregateRating ? `<span style="color:var(--warning); display:flex; align-items:center; gap:2px;"><span class="material-icons-round" style="font-size:12px;">star</span>${ep.rating.aggregateRating.toFixed(1)}</span>` : ''}
          </span>
        </div>
      `;
    }).join('');

    listEl.innerHTML = html;
    
    // Bind selectbox event
    const selectEl = document.getElementById('movie-season-select');
    if (selectEl) {
      selectEl.addEventListener('change', (e) => {
        this.renderEpisodesList(movie, e.target.value);
      });
    }
  },

  async toggleEpisode(globalIdx) {
    if (!this.currentMovie) return;
    
    let watched = this.currentMovie.watchedEpisodes || [];
    const idx = watched.indexOf(globalIdx);
    
    if (idx !== -1) {
      // Uncheck this and everything greater
      watched = watched.filter(num => num < globalIdx);
    } else {
      // Check this and everything smaller
      for (let i = 0; i <= globalIdx; i++) {
        if (!watched.includes(i)) watched.push(i);
      }
      
      // Auto move category to "Đang xem" if not "Đã xem"
      if (this.currentMovie.category !== 'watched') {
        this.currentMovie.category = 'watching';
      }
    }
    
    this.currentMovie.watchedEpisodes = watched;
    
    // Save to DB
    await window.appDB.saveMovie(this.currentMovie);
    this.loadMovies(); // Refresh counts in background
    
    // Re-render
    const selectEl = document.getElementById('movie-season-select');
    const targetSeason = selectEl ? selectEl.value : (this.currentEpisodes?.[0]?.season || 'all');
    this.renderEpisodesList(this.currentMovie, targetSeason);
  },

  getCategoryButtons(movie) {
    const categories = [
      { key: 'watchlist', icon: 'bookmark', label: 'Muốn xem' },
      { key: 'watching', icon: 'play_circle', label: 'Đang xem' },
      { key: 'watched', icon: 'done_all', label: 'Đã xem' },
    ];

    return categories
      .filter(c => c.key !== movie.category)
      .map(c => `
        <button class="movie-card-btn" onclick="MovieManager.moveMovie('${movie.id}', '${c.key}')" title="${c.label}">
          <span class="material-icons-round">${c.icon}</span>
        </button>
      `).join('');
  },

  async moveMovie(id, newCategory) {
    await window.appDB.updateMovieCategory(id, newCategory);
    // Legacy support for TMDB integer IDs
    if (!isNaN(id)) {
      await window.appDB.updateMovieCategory(Number(id), newCategory);
    }
    const categoryLabels = { watchlist: 'Muốn xem', watching: 'Đang xem', watched: 'Đã xem' };
    App.showToast(`Đã chuyển sang "${categoryLabels[newCategory]}"`, 'success');
    MovieManager.loadMovies();
  },

  async removeMovie(id) {
    App.confirm('Xóa phim này khỏi danh sách?', async () => {
      try {
        console.log("Deleting movie from DB, id:", id);
        await window.appDB.deleteMovie(id);
        // Legacy support for TMDB integer IDs
        if (!isNaN(id)) {
          await window.appDB.deleteMovie(Number(id));
        }
        App.showToast('Đã xóa phim', 'info');
        MovieManager.loadMovies();
      } catch (err) {
        console.error("Error removing movie:", err);
        App.showToast('Lỗi xóa phim: ' + err.message, 'error');
      }
    });
  }
};

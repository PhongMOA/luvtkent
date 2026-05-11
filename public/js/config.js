/**
 * App Configuration
 * Auto-detects environment (Browser vs Capacitor/Android)
 * and sets the correct API base URL.
 */
const AppConfig = {
  // App Version - update this when releasing new versions
  APP_VERSION: '1.0.1',
  
  // GitHub repo for update checking
  GITHUB_REPO: 'PhongMOA/luvtkent',
  GITHUB_RELEASES_URL: 'https://github.com/PhongMOA/luvtkent/releases',

  // Backend server URL
  REMOTE_SERVER_URL: 'https://luvtkent.onrender.com',

  // Auto-detect if running inside Capacitor (Android app)
  isNative() {
    return typeof window !== 'undefined' && 
           window.Capacitor && 
           window.Capacitor.isNativePlatform && 
           window.Capacitor.isNativePlatform();
  },

  // Get the base URL for API calls
  getApiBase() {
    if (this.isNative()) {
      return this.REMOTE_SERVER_URL;
    }
    // On localhost, Express serves both frontend + API (same origin)
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return '';
    }
    // On Vercel or any other static host, route API to Railway
    return this.REMOTE_SERVER_URL;
  },

  // Build full API URL
  api(path) {
    return this.getApiBase() + path;
  },

  // Rewrite any URL that starts with /api/ to use the correct base
  rewriteUrl(url) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
      return this.getApiBase() + url;
    }
    return url;
  },

  // Check for app updates from GitHub Releases
  async checkForUpdates(silent = true) {
    try {
      const apiUrl = `https://api.github.com/repos/${this.GITHUB_REPO}/releases/latest`;
      const res = await fetch(apiUrl, {
        cache: 'no-store',
        headers: { 'Accept': 'application/vnd.github+json' },
      });
      if (!res.ok) {
        if (!silent) console.warn(`[Update] GitHub API HTTP ${res.status}`);
        return null;
      }

      const release = await res.json();
      const latest = (release.tag_name || '').replace(/^v/i, '').trim();
      const current = this.APP_VERSION;
      if (!latest) return null;

      if (this._isNewer(latest, current)) {
        const apkAsset = (release.assets || []).find(a => /\.apk$/i.test(a.name));
        return {
          current,
          latest,
          url: apkAsset ? apkAsset.browser_download_url : release.html_url,
          releaseUrl: release.html_url,
          notes: release.body || '',
        };
      }
      if (!silent) {
        console.log(`[Update] Đang dùng phiên bản mới nhất (v${current})`);
      }
      return null;
    } catch (err) {
      console.warn('[Update] Không thể kiểm tra cập nhật:', err.message);
      return null;
    }
  },

  // Compare semver: returns true if 'latest' is newer than 'current'
  _isNewer(latest, current) {
    const l = latest.split('.').map(Number);
    const c = current.split('.').map(Number);
    for (let i = 0; i < Math.max(l.length, c.length); i++) {
      const lv = l[i] || 0;
      const cv = c[i] || 0;
      if (lv > cv) return true;
      if (lv < cv) return false;
    }
    return false;
  }
};

// Monkey-patch fetch to auto-rewrite /api/ URLs for native app
(function() {
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      input = AppConfig.rewriteUrl(input);
    }
    return originalFetch.call(this, input, init);
  };
})();

// Make it globally available
window.AppConfig = AppConfig;

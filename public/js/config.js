/**
 * App Configuration
 * Auto-detects environment (Browser vs Capacitor/Android)
 * and sets the correct API base URL.
 */
const AppConfig = {
  // Set your deployed server URL here when you deploy the backend
  // Examples: 'https://luvtk-ent.onrender.com', 'https://your-vps-ip:3000'
  REMOTE_SERVER_URL: 'https://luvtk-ent.up.railway.app', // <-- Change this to your server IP/URL

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
    // In browser, use relative path (same origin)
    return '';
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

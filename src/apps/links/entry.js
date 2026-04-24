import './styles/index.css';
import './hydrate.js';

if (typeof window !== 'undefined') {
  window.__THEME_APP_LINKS_LOADED__ = true;
}

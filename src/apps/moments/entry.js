import './styles/index.css';
import './hydrate.js';

if (typeof window !== 'undefined') {
  window.__THEME_APP_MOMENTS_LOADED__ = true;
}

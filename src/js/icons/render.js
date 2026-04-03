export function renderDesktopIconGraphic(type) {
  if (type === 'document') {
    return `
      <svg viewBox="0 0 120 120" width="52" height="52" xmlns="http://www.w3.org/2000/svg" class="desktop-icon-artwork">
        <path fill="#ffffff" d="M25 15 L70 15 L95 40 L95 105 C95 110, 90 115, 85 115 L25 115 C20 115, 15 110, 15 105 L15 25 C15 20, 20 15, 25 15 Z" />
        <path fill="#e0e0e0" d="M70 15 L70 35 C70 38, 72 40, 75 40 L95 40 Z" />
        <rect fill="#cccccc" x="35" y="55" width="50" height="6" rx="3" />
        <rect fill="#cccccc" x="35" y="70" width="50" height="6" rx="3" />
        <rect fill="#cccccc" x="35" y="85" width="35" height="6" rx="3" />
      </svg>
    `;
  }

  if (type === 'link') {
    return `
      <svg viewBox="0 0 120 120" width="56" height="56" xmlns="http://www.w3.org/2000/svg" class="desktop-icon-artwork">
        <circle cx="60" cy="60" r="48" fill="#ffffff" />
        <circle cx="60" cy="60" r="44" fill="var(--mac-link-primary)" />
        <path fill="none" stroke="var(--mac-link-secondary)" stroke-width="4" d="M60 16 C 30 16, 30 104, 60 104 C 90 104, 90 16, 60 16 Z" />
        <path fill="none" stroke="var(--mac-link-secondary)" stroke-width="4" d="M18 60 L102 60 M27 35 L93 35 M27 85 L93 85 M60 16 V104" />
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 120 120" width="56" height="56" xmlns="http://www.w3.org/2000/svg" class="desktop-icon-artwork">
      <path fill="var(--mac-folder1)" d="M10 35 C10 30, 14 26, 19 26 L45 26 C48 26, 51 28, 53 30 L63 42 L101 42 C106 42, 110 46, 110 51 L110 95 C110 100, 106 104, 101 104 L10 104 Z" />
      <path fill="var(--mac-folder2)" d="M10 48 C10 43, 14 39, 19 39 L101 39 C106 39, 110 43, 110 48 L110 95 C110 100, 106 104, 101 104 L10 104 Z" />
      <path fill="var(--mac-folder3)" d="M10 48 C10 43, 14 39, 19 39 L101 39 C106 39, 110 43, 110 48 V50 C110 45, 106 41, 101 41 L19 41 C14 41, 10 45, 10 50 Z" />
    </svg>
  `;
}

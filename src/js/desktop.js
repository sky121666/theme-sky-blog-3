import { registerShellComponents } from './desktop/shell.js';
import { registerDesktopSurface } from './desktop/surface/index.js';
import { registerArchiveExplorer, initArchiveSidebar } from './desktop/archive-sidebar.js';
import { registerExplorers } from './desktop/explorers.js';
import { registerPostComponents } from './post/upvote.js';
import { initPostOutline } from './desktop/post-outline.js';
import { queuePageInitializer } from './shared/page-app.js';

export function registerComponents(Alpine) {
  registerShellComponents(Alpine);
  registerDesktopSurface(Alpine);
  registerArchiveExplorer(Alpine);
  registerExplorers(Alpine);
  registerPostComponents(Alpine);

  queuePageInitializer((root) => {
    initArchiveSidebar(root);
    initPostOutline(root);
  });
}

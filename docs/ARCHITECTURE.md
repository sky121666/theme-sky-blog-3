# theme-sky-blog-3 Architecture

## 1. Product Model

`theme-sky-blog-3` is a Halo theme with a macOS desktop shell.

The product is split into two major visual systems:

1. `Shell Fixed Surfaces`
   - Desktop-facing system chrome
   - Stable macOS-like materials
   - Does not switch to a separate light/dark surface family with content mode
   - Uses fixed neutral glass or fixed white text treatment

2. `Content Adaptive Surfaces`
   - Reader, window, search, comments, and other content containers
   - Follows the current content color scheme
   - Keeps window surfaces neutral black/white
   - Uses theme accent only for emphasis, not for base surfaces

## 2. Surface Classification

| Area | UI | Position | Surface Type | Follows dark/light | Theme config source |
| --- | --- | --- | --- | --- | --- |
| Desktop shell | Menu bar | Top fixed | Shell Fixed Surface | No, fixed glass material | Hardcoded material in CSS |
| Desktop shell | Menu dropdown | Below header item | Shell Fixed Surface | Separate light/dark background values | `header.dropdown.light_bg`, `header.dropdown.dark_bg` |
| Desktop shell | Dock glass | Bottom center fixed | Shell Fixed Surface | No, fixed glass material | Hardcoded material in CSS |
| Desktop shell | Desktop icon label | Right desktop grid | Shell Fixed Surface | No, fixed white label treatment | Hardcoded text style in CSS |
| Desktop shell | Desktop icon selected state | Right desktop grid | Accent Layer | Uses theme accent/selection only | `desktop.appearance.*` |
| Content | Main browser window chrome | Center window | Content Adaptive Surface | Yes | Fixed neutral system window tokens |
| Content | Main browser window body | Center window | Content Adaptive Surface | Yes | Fixed neutral system window tokens |
| Content | Search modal | Center overlay | Content Adaptive Surface | Yes | Fixed neutral modal + theme accent bridge |
| Content | Comments | Post/Page bottom | Content Adaptive Surface | Yes | Fixed neutral comment surface + theme accent bridge |
| Content | Reader page | Browser window body | Content Adaptive Surface | Yes | Neutral reader surface |

## 3. Settings Ownership

### 3.1 Header

Source: [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/settings.yaml](file:///Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/settings.yaml)

- `header.source.menu_name`
  - Controls which Halo menu renders in the top menu bar
- `header.logo.icon`
  - Controls the Apple/app icon replacement in the left corner
- `header.theme.enable_frontend_setting`
  - Allows visitors to switch content color scheme
- `header.theme.default_mode`
  - Controls initial content color scheme
- `header.dropdown.light_bg`
  - Controls submenu panel background in light content mode
- `header.dropdown.dark_bg`
  - Controls submenu panel background in dark content mode

Not configurable from backend:

- Menu bar base material
- Menu bar shadow/highlight structure

Reason:

- The top bar is a shell fixed surface and should remain visually stable

### 3.2 Desktop Appearance

Source: [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/settings.yaml](file:///Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/settings.yaml)

- `desktop.appearance.mode`
  - `preset | custom`
- `desktop.appearance.preset`
  - Built-in macOS-like accent schemes
- `desktop.appearance.accent_color`
  - Primary theme emphasis color
- `desktop.appearance.selection_color`
  - Selection state color
- `desktop.appearance.folder_color1/2/3`
  - Desktop folder icon layers
- `desktop.appearance.glass_light_color`
  - Legacy/custom shell tint input
- `desktop.appearance.glass_dark_color`
  - Legacy/custom shell tint input

### 3.3 Desktop Background

- `desktop.background.mode`
  - `preset | image | solid`
- `desktop.background.preset`
  - Built-in wallpaper
- `desktop.background.image_url`
  - Uploaded wallpaper
- `desktop.background.solid_color`
  - Solid desktop background

### 3.4 Desktop Icons

- `desktop.icons.custom_icons`
- `desktop.icons.categories`
- `desktop.icons.tags`
- `desktop.icons.posts`
- `desktop.icons.single_pages`

These are desktop object sources, not color sources.

### 3.5 Dock

- `dock.source.menu_name`
  - Controls which Halo menu renders into Dock items
- `dock.appearance.show_labels`
  - Tooltip visibility
- `dock.appearance.magnification`
  - Magnification behavior

Not configurable from backend:

- Dock glass base material

Reason:

- Dock is a shell fixed surface and should remain visually stable like the menu bar

## 4. Token Ownership

### 4.1 Backend-to-Frontend Theme Tokens

Injected by [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/templates/modules/layout.html](file:///Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/templates/modules/layout.html)

Primary runtime tokens:

- `--mac-accent`
- `--mac-selection`
- `--mac-folder1`
- `--mac-folder2`
- `--mac-folder3`
- `--mac-shell-light`
- `--mac-shell-dark`
- `--mac-header-dropdown-light-bg`
- `--mac-header-dropdown-dark-bg`

### 4.2 Frontend Bridge Tokens

Defined in [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/desktop.css](file:///Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/desktop.css)

Bridge layer:

- `--theme-accent`
- `--theme-selection`
- `--theme-folder1`
- `--theme-folder2`
- `--theme-folder3`
- `--theme-shell-light`
- `--theme-shell-dark`

Rule:

- Compatibility layers should consume bridge tokens, not raw backend values directly

This keeps the chain short:

`Halo settings -> CSS custom properties in layout -> bridge tokens -> component compatibility variables`

### 4.3 Frontend Shell Tokens

These are frontend-only fixed-surface tokens. They are not owned by backend settings.

- `--shell-text-primary`
- `--shell-menubar-bg`
- `--shell-menubar-border`
- `--shell-menubar-hover-bg`
- `--shell-dock-glass-bg`
- `--shell-dock-glass-border`
- `--shell-dock-glass-border-bottom`
- `--shell-dock-icon-bg`
- `--shell-dock-icon-border`
- `--shell-dock-tooltip-bg`
- `--shell-desktop-hover-bg`
- `--shell-desktop-selected-bg`
- `--shell-desktop-selected-border`

Rule:

- Fixed shell surfaces consume shell tokens
- Shell tokens are hardcoded in CSS
- Backend settings must not directly re-theme shell fixed surfaces

### 4.4 Frontend Content Tokens

These are frontend-only adaptive-surface tokens for the main browser window and its chrome. They follow content mode, not shell mode.

- `--content-chrome-bg`
- `--content-chrome-border`
- `--content-chrome-text`
- `--content-chrome-muted`
- `--content-chrome-hover-bg`
- `--content-chrome-hover-text`
- `--content-body-bg`

Rule:

- Browser chrome and window body consume content tokens
- Content tokens remain neutral black/white system surfaces
- Backend settings must not directly tint content base surfaces

### 4.5 Compatibility Layers

Current compatibility consumers:

- Search widget:
  - `--halo-search-widget-*`
- Comment widget:
  - `--halo-cw-*`
  - legacy `--halo-comment-*`

Rule:

- These layers may use `--theme-accent`
- They must not use theme accent as a base surface color

## 5. File Responsibilities

### 5.1 Template entry

### 5.2 Desktop Widgets

Desktop widgets belong to the shell layer, but they are not fixed chrome.

- Render only on `/`
- Live between desktop icons and the primary window
- Never render inside `#pjax-container`
- Use theme settings for default instances
- Use frontend runtime for drag, edit mode, and persistence

Ownership:

- Settings and default instances:
  - [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/settings.yaml](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/settings.yaml)
- Bootstrap output:
  - [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/templates/modules/desktop-widgets.html](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/templates/modules/desktop-widgets.html)
- Runtime:
  - [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/desktop.js](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/desktop.js)
- Styles:
  - [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/desktop.css](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/desktop.css)

Persistence boundary:

- Current: `localStorage`
- Future plugin: user layout read/write only
- Widget UI still stays in theme
- `extension` storage is mounted through a frontend driver bridge, not by moving widget rendering into plugins

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/templates/modules/layout.html](file:///Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/templates/modules/layout.html)

Responsibilities:

- Read Halo settings
- Map Finder/menu data to the shell
- Inject runtime CSS variables
- Define shell HTML structure

### 5.2 Shell CSS

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/desktop.css](file:///Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/desktop.css)

Responsibilities:

- Shell fixed surfaces
- Global bridge tokens
- Search/comment compatibility token mapping
- Desktop icon, Dock, menu bar, window chrome

### 5.3 Reader CSS

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/post.css](file:///Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/post.css)

Responsibilities:

- Reader layout
- Article header
- Table/code/blockquote/figure treatment
- Comment section layout only

### 5.4 Runtime behavior

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/desktop.js](file:///Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/desktop.js)

Responsibilities:

- Theme mode switching
- Window manager
- Genie minimize/restore
- Search widget invocation and shadow DOM styling
- Dock magnification

## 6. Rules That Must Stay Stable

1. Shell fixed surfaces do not follow content color mode as separate surface families
2. Window/search/comment/reader surfaces remain neutral black/white systems
3. Theme color is for emphasis only
4. Menu bar base material is fixed in CSS
5. Dock base material is fixed in CSS
6. Desktop label color remains fixed white with shadow treatment
7. Submenu background is the only header surface currently configurable from backend

## 7. Change Checklist

Before changing any shell or content style, first classify it:

1. Which surface group is it:
   - Shell Fixed Surface
   - Content Adaptive Surface
   - Accent Layer
2. Which file owns it:
   - `layout.html`
   - `desktop.css`
   - `post.css`
   - `desktop.js`
3. Which setting owns it:
   - fixed in CSS
   - driven by `settings.yaml`
   - driven by `annotation-setting.yaml`

If that answer is unclear, do not patch blindly.

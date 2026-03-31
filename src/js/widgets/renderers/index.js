import { renderCalendarWidget, renderClockWidget } from './clock-calendar.js';
import {
  renderAuthorCardWidget,
  renderCategoriesWidget,
  renderLatestPostsWidget,
  renderPopularPostsWidget,
  renderRandomTagsWidget,
  renderSiteStatsWidget
} from './content.js';
import { renderRecentMomentsWidget } from './moments.js';
import { renderUnsupportedWidget } from './shared.js';
import { renderWeatherWidget } from './weather.js';

export function renderDesktopWidget(context, widget, options = {}) {
  switch (widget.widget) {
    case 'system.clock':
      return renderClockWidget(context, widget, options);
    case 'system.calendar':
      return renderCalendarWidget(context, widget, options);
    case 'system.weather':
      return renderWeatherWidget(context, widget, options);
    case 'halo.latest_posts':
      return renderLatestPostsWidget(context, widget, options);
    case 'halo.popular_posts':
      return renderPopularPostsWidget(context, widget, options);
    case 'halo.categories':
      return renderCategoriesWidget(context, widget, options);
    case 'halo.author_card':
      return renderAuthorCardWidget(context, widget, options);
    case 'halo.site_stats':
      return renderSiteStatsWidget(context, widget, options);
    case 'halo.random_tags':
      return renderRandomTagsWidget(context, widget, options);
    case 'plugin-moments.recent':
      return renderRecentMomentsWidget(context, widget, options);
    default:
      return renderUnsupportedWidget(context.escapeHtml, widget);
  }
}

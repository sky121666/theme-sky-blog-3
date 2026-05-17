const DEFAULT_META = {
  showSteam: true,
  showMoments: true,
  showPosts: true,
  showPhotos: true
};

function isEnabled(meta, key) {
  return meta?.[key] !== false;
}

function parseTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1000000000000 ? value * 1000 : value;
  }
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function isWithin(time, now, windowMs) {
  return time > 0 && time <= now && now - time <= windowMs;
}

function cleanText(value, fallback = '') {
  return String(value || fallback || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export function resolveIdentityPresence(sources = {}, meta = {}, now = Date.now()) {
  const options = { ...DEFAULT_META, ...meta };

  if (isEnabled(options, 'showSteam') && sources.steamAvailable && sources.steamProfile?.playing === true) {
    const profile = sources.steamProfile || {};
    return {
      type: 'steam-playing',
      label: profile.statusText || '正在游戏',
      title: profile.currentGameName || profile.personaName || 'Steam',
      subtitle: profile.currentGameName ? profile.personaName || '' : '当前在线',
      href: '/steam',
      app: 'steam',
      cover: profile.avatarFull || '',
      accent: 'steam'
    };
  }

  const moment = Array.isArray(sources.recentMoments) ? sources.recentMoments[0] : null;
  const momentTime = parseTime(
    moment?.metadata?.creationTimestamp
      || moment?.spec?.releaseTime
      || moment?.status?.lastModifyTime
  );
  if (isEnabled(options, 'showMoments') && sources.momentsAvailable && isWithin(momentTime, now, 48 * 60 * 60 * 1000)) {
    const name = moment?.metadata?.name || '';
    return {
      type: 'moment-recent',
      label: '刚刚更新瞬间',
      title: cleanText(moment?.spec?.content || moment?.spec?.raw, '新的瞬间'),
      subtitle: '48 小时内',
      href: moment?.status?.permalink || (name ? `/moments/${name}` : '/moments'),
      app: 'moments',
      cover: '',
      accent: 'moments'
    };
  }

  const post = Array.isArray(sources.latestPosts) ? sources.latestPosts[0] : null;
  const postTime = parseTime(
    post?.metadata?.creationTimestamp
      || post?.spec?.publishTime
      || post?.status?.lastModifyTime
  );
  if (isEnabled(options, 'showPosts') && isWithin(postTime, now, 7 * 24 * 60 * 60 * 1000)) {
    return {
      type: 'post-recent',
      label: '最近写了文章',
      title: cleanText(post?.spec?.title, '最新文章'),
      subtitle: '7 天内',
      href: post?.status?.permalink || '#',
      app: 'reader',
      cover: post?.spec?.cover || '',
      accent: 'posts'
    };
  }

  if (isEnabled(options, 'showPhotos') && sources.photosAvailable && (sources.photoGroups?.length || sources.photos?.length)) {
    return {
      type: 'photos-active',
      label: '最近整理图库',
      title: '图库',
      subtitle: '照片入口',
      href: sources.photosUrl || '/photos',
      app: 'photos',
      cover: sources.photoGroups?.[0]?.spec?.cover || sources.photos?.[0]?.spec?.url || '',
      accent: 'photos'
    };
  }

  return {
    type: 'default',
    label: '站点作者',
    title: '',
    subtitle: '',
    href: '#',
    app: 'explorer-author',
    cover: '',
    accent: 'default'
  };
}

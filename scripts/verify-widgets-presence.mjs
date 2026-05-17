import assert from 'node:assert/strict';
import { resolveIdentityPresence } from '../src/widgets/shared/presence.js';

const now = Date.parse('2026-05-16T12:00:00.000Z');

const cases = [
  {
    name: 'steam playing wins',
    sources: {
      steamAvailable: true,
      steamProfile: { playing: true, statusText: '正在游戏', personaName: 'Sky' },
      momentsAvailable: true,
      recentMoments: [{ metadata: { creationTimestamp: '2026-05-16T06:00:00.000Z' } }]
    },
    meta: {},
    expected: 'steam-playing'
  },
  {
    name: 'recent game is not current playing',
    sources: {
      steamAvailable: true,
      steamProfile: { playing: false },
      steamRecentGames: [{ name: 'Game A' }],
      recentMoments: []
    },
    meta: {},
    expected: 'default'
  },
  {
    name: 'recent moment within 48h',
    sources: {
      momentsAvailable: true,
      recentMoments: [{ metadata: { name: 'moment-1', creationTimestamp: '2026-05-15T12:00:00.000Z' } }]
    },
    meta: {},
    expected: 'moment-recent'
  },
  {
    name: 'moment older than 48h falls through',
    sources: {
      momentsAvailable: true,
      recentMoments: [{ metadata: { name: 'moment-1', creationTimestamp: '2026-05-13T11:59:00.000Z' } }]
    },
    meta: {},
    expected: 'default'
  },
  {
    name: 'post within 7d',
    sources: {
      latestPosts: [{ spec: { title: 'Post', publishTime: '2026-05-13T12:00:00.000Z' } }]
    },
    meta: {},
    expected: 'post-recent'
  },
  {
    name: 'post older than 7d falls through',
    sources: {
      latestPosts: [{ spec: { title: 'Post', publishTime: '2026-05-06T12:00:00.000Z' } }]
    },
    meta: {},
    expected: 'default'
  },
  {
    name: 'photos active fallback',
    sources: {
      photosAvailable: true,
      photoGroups: [{ metadata: { name: 'album' } }]
    },
    meta: {},
    expected: 'photos-active'
  },
  {
    name: 'steam toggle off falls through to moment',
    sources: {
      steamAvailable: true,
      steamProfile: { playing: true },
      momentsAvailable: true,
      recentMoments: [{ metadata: { name: 'moment-1', creationTimestamp: '2026-05-15T12:00:00.000Z' } }]
    },
    meta: { showSteam: false },
    expected: 'moment-recent'
  },
  {
    name: 'invalid time falls back',
    sources: {
      momentsAvailable: true,
      recentMoments: [{ metadata: { name: 'moment-1', creationTimestamp: 'invalid' } }]
    },
    meta: {},
    expected: 'default'
  }
];

for (const item of cases) {
  const result = resolveIdentityPresence(item.sources, item.meta, now);
  assert.equal(result.type, item.expected, item.name);
}

console.log(`presence resolver cases passed: ${cases.length}`);

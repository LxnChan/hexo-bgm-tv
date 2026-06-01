'use strict';

const fs = require('hexo-fs');
const path = require('path');
const axios = require('axios');
const hexoLog = require('hexo-log');

const API_BASE_URL = 'https://api.bgm.tv/v0';
const PROXY_API_PREFIX = '/api/v0';
const DATA_FILE_NAME = 'bgm-tv.json';
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_USER_AGENT = 'hexo-bgm-tv/0.1.0 (https://github.com/your-name/your-repo)';
const DEFAULT_CACHE_MAX_AGE = 6 * 60 * 60 * 1000;

const STATUS_MAP = [
  { key: 'wantWatch', type: 1, label: '想看' },
  { key: 'watching', type: 3, label: '在看' },
  { key: 'watched', type: 2, label: '看过' },
  { key: 'onHold', type: 4, label: '搁置' },
  { key: 'dropped', type: 5, label: '抛弃' }
];

const SUBJECT_TYPE_ANIME = 2;

const log = (typeof hexoLog.default === 'function' ? hexoLog.default : hexoLog)({
  debug: false,
  silent: false
});

function createHeaders(userAgent, accessToken) {
  const headers = {
    'User-Agent': userAgent || DEFAULT_USER_AGENT,
    Accept: 'application/json'
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

function resolveBaseUrl(proxy) {
  if (proxy) {
    // 去掉末尾斜杠，拼上 /api/v0
    const base = proxy.replace(/\/+$/, '');
    return base + PROXY_API_PREFIX;
  }
  return API_BASE_URL;
}

function createHttpClient({ userAgent, accessToken, timeout, proxy }) {
  return axios.create({
    baseURL: resolveBaseUrl(proxy),
    timeout: timeout || DEFAULT_TIMEOUT,
    headers: createHeaders(userAgent, accessToken)
  });
}

function normalizeDate(dateTime) {
  if (!dateTime) {
    return '';
  }

  if (typeof dateTime === 'string' && dateTime.includes('T')) {
    return dateTime.split('T')[0];
  }

  const parsed = new Date(dateTime);
  return Number.isNaN(parsed.getTime()) ? String(dateTime) : parsed.toISOString().slice(0, 10);
}

function normalizeScore(score) {
  if (typeof score !== 'number') {
    return null;
  }

  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function summarizeTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return [];
  }

  return tags
    .map((tag) => tag?.name)
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeCollection(item) {
  const subject = item?.subject || {};
  const totalEpisodes = Number(subject.eps) || 0;
  const watchedEpisodes = Number(item?.ep_status) || 0;
  const isWatched = item?.type === 2;
  const displayEpisodes = watchedEpisodes || (isWatched && totalEpisodes ? totalEpisodes : 0);
  const progressPercent = totalEpisodes > 0
    ? Math.min(100, Math.round((displayEpisodes / totalEpisodes) * 100))
    : (isWatched ? 100 : 0);

  return {
    id: subject.id || item?.subject_id,
    title: subject.name_cn || subject.name || '未知条目',
    originalTitle: subject.name || '',
    cover: subject.images?.large || subject.images?.common || subject.images?.medium || '',
    url: `https://bgm.tv/subject/${subject.id || item?.subject_id}`,
    score: normalizeScore(subject.score),
    rank: subject.rank || null,
    collectionTotal: subject.collection_total || 0,
    totalEpisodes,
    watchedEpisodes: displayEpisodes,
    progressPercent,
    summary: subject.short_summary || '',
    tags: summarizeTags(subject.tags),
    myRate: item?.rate || null,
    myComment: item?.comment || '',
    updatedAt: normalizeDate(item?.updated_at)
  };
}

async function fetchCollectionPage(client, { username, type, limit, offset }) {
  try {
    const response = await client.get(`/users/${username}/collections`, {
      params: {
        subject_type: SUBJECT_TYPE_ANIME,
        type,
        limit,
        offset
      }
    });

    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const detail = typeof error?.response?.data === 'string'
      ? error.response.data
      : JSON.stringify(error?.response?.data || {});
    throw new Error(`Bangumi API request failed${status ? ` (${status})` : ''}: ${detail}`);
  }
}

async function fetchCollectionsByStatus(client, { username, type, label, pageSize, showProgress }) {
  const items = [];
  let offset = 0;
  let total = null;

  while (total === null || offset < total) {
    const payload = await fetchCollectionPage(client, {
      username,
      type,
      limit: pageSize,
      offset
    });

    const pageItems = Array.isArray(payload?.data) ? payload.data : [];
    total = Number(payload?.total) || 0;
    items.push(...pageItems.map(normalizeCollection));
    offset += pageSize;

    if (showProgress) {
      log.info(`[${label}] ${Math.min(offset, total)}/${total}`);
    }

    if (pageItems.length === 0) {
      break;
    }
  }

  return items;
}

async function fetchBangumiCollections({
  sourceDir,
  username,
  accessToken,
  userAgent,
  pageSize,
  timeout,
  progress,
  proxy
}) {
  const resolvedPageSize = Math.min(Math.max(Number(pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const client = createHttpClient({ userAgent, accessToken, timeout, proxy });
  const dataDir = path.join(sourceDir, '_data');
  const startedAt = Date.now();

  if ((userAgent || DEFAULT_USER_AGENT) === DEFAULT_USER_AGENT) {
    log.warn('Using the default User-Agent. Bangumi recommends setting `bgm.userAgent` to your own project identifier.');
  }

  if (proxy) {
    log.info(`Using proxy: ${resolveBaseUrl(proxy)}`);
  }
  log.info(`Fetching Bangumi collections for "${username}"...`);

  const result = {};
  for (const status of STATUS_MAP) {
    result[status.key] = await fetchCollectionsByStatus(client, {
      username,
      type: status.type,
      label: status.label,
      pageSize: resolvedPageSize,
      showProgress: progress !== false
    });
  }

  const payload = {
    meta: {
      username,
      fetchedAt: new Date().toISOString(),
      source: 'https://api.bgm.tv/v0/users/{username}/collections',
      subjectType: SUBJECT_TYPE_ANIME
    },
    ...result
  };

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dataPath = path.join(dataDir, DATA_FILE_NAME);
  fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2));

  const totalCount = STATUS_MAP.reduce((sum, status) => sum + payload[status.key].length, 0);
  log.info(`Saved ${totalCount} anime collections to ${dataPath} in ${Date.now() - startedAt} ms.`);
}

function getDataPath(sourceDir) {
  return path.join(sourceDir, '_data', DATA_FILE_NAME);
}

function readCachedCollections(sourceDir) {
  const dataPath = getDataPath(sourceDir);
  if (!fs.existsSync(dataPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(dataPath, { encoding: 'utf8' }));
}

function shouldRefreshCollections(sourceDir, cacheMaxAge) {
  const cached = readCachedCollections(sourceDir);
  if (!cached?.meta?.fetchedAt) {
    return true;
  }

  const fetchedAt = new Date(cached.meta.fetchedAt).getTime();
  if (Number.isNaN(fetchedAt)) {
    return true;
  }

  const maxAge = typeof cacheMaxAge === 'number' && cacheMaxAge >= 0
    ? cacheMaxAge
    : DEFAULT_CACHE_MAX_AGE;

  return Date.now() - fetchedAt > maxAge;
}

module.exports = {
  DATA_FILE_NAME,
  DEFAULT_CACHE_MAX_AGE,
  fetchBangumiCollections,
  getDataPath,
  readCachedCollections,
  shouldRefreshCollections
};

'use strict';

const path = require('path');
const pug = require('pug');
const hexoLog = require('hexo-log');
const { readCachedCollections } = require('./fetch-bangumi');

const log = (typeof hexoLog.default === 'function' ? hexoLog.default : hexoLog)({
  debug: false,
  silent: false
});

const SECTION_CONFIG = [
  { key: 'wantWatch', label: '想看', emptyText: '还没有“想看”条目。' },
  { key: 'watching', label: '在看', emptyText: '还没有“在看”条目。' },
  { key: 'watched', label: '看过', emptyText: '还没有“看过”条目。' },
  { key: 'onHold', label: '搁置', emptyText: '还没有“搁置”条目。' },
  { key: 'dropped', label: '抛弃', emptyText: '还没有“抛弃”条目。' }
];

function formatDisplayDate(dateTime) {
  if (!dateTime) {
    return '';
  }

  const parsed = new Date(dateTime);
  if (Number.isNaN(parsed.getTime())) {
    return String(dateTime);
  }

  const pad = (value) => String(value).padStart(2, '0');

  return [
    parsed.getFullYear(),
    pad(parsed.getMonth() + 1),
    pad(parsed.getDate())
  ].join('-') + ' ' + [
    pad(parsed.getHours()),
    pad(parsed.getMinutes()),
    pad(parsed.getSeconds())
  ].join(':');
}

function resolveShowIndex(show) {
  if (typeof show === 'number' && show >= 0 && show < SECTION_CONFIG.length) {
    return show;
  }

  if (typeof show === 'string') {
    const index = SECTION_CONFIG.findIndex((section) => section.key === show);
    if (index >= 0) {
      return index;
    }
  }

  return 2;
}

module.exports = function generateBangumiPage() {
  const config = this.config.bgm;
  const cached = readCachedCollections(this.source_dir);
  const fullUrlFor = this.extend.helper.get('full_url_for').bind(this);

  if (!cached) {
    log.info('Bangumi cache not found. Auto update may be disabled; run `hexo bgm -u` or enable `bgm.autoUpdate`.');
    return;
  }

  const pagePath = config.path || 'bgm.tv/index.html';
  const sections = SECTION_CONFIG.map((section) => ({
    ...section,
    items: cached[section.key] || []
  }));
  const content = pug.renderFile(path.join(__dirname, 'templates', 'page.pug'), {
    quote: config.quote,
    show: resolveShowIndex(config.show),
    lazyload: config.lazyload !== false,
    progress: config.progress !== false,
    sections,
    meta: {
      ...(cached.meta || {}),
      fetchedAtDisplay: formatDisplayDate(cached?.meta?.fetchedAt)
    }
  });

  return {
    path: pagePath,
    data: {
      title: config.title || '追番列表',
      content,
      type: 'page',
      permalink: fullUrlFor(pagePath),
      ...config.extra_options
    },
    layout: ['page', 'post']
  };
};

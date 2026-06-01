'use strict';

const fs = require('hexo-fs');
const path = require('path');
const hexoLog = require('hexo-log');
const {
  fetchBangumiCollections,
  DATA_FILE_NAME,
  DEFAULT_CACHE_MAX_AGE,
  shouldRefreshCollections
} = require('./lib/fetch-bangumi');
const generateBangumiPage = require('./lib/generator');

const CONFIG_KEY = 'bgm';
const COMMAND_OPTIONS = {
  options: [
    { name: '-u, --update', desc: 'Fetch collections from Bangumi API' },
    { name: '-d, --delete', desc: 'Delete cached Bangumi data' }
  ]
};

const log = (typeof hexoLog.default === 'function' ? hexoLog.default : hexoLog)({
  debug: false,
  silent: false
});
let pendingAutoUpdate = null;

function getConfig(hexo) {
  return hexo.config[CONFIG_KEY];
}

function validateConfig(config) {
  if (!config) {
    log.info('Please add `bgm` config to `_config.yml`.');
    return false;
  }

  if (!config.enable) {
    log.info('`bgm.enable` is false, skip command.');
    return false;
  }

  if (!config.username) {
    log.info('Please set `bgm.username` in `_config.yml`.');
    return false;
  }

  return true;
}

function getDataPath(sourceDir) {
  return path.join(sourceDir, '_data', DATA_FILE_NAME);
}

function deleteCachedData(sourceDir) {
  const dataPath = getDataPath(sourceDir);

  if (!fs.existsSync(dataPath)) {
    log.info('No cached Bangumi data to delete.');
    return;
  }

  fs.unlinkSync(dataPath);
  log.info(`Deleted ${dataPath}`);
}

async function updateCollections(hexo, options = {}) {
  const config = getConfig(hexo);
  if (!validateConfig(config)) {
    return;
  }

  await fetchBangumiCollections({
    sourceDir: hexo.source_dir,
    username: config.username,
    accessToken: config.accessToken,
    userAgent: config.userAgent,
    pageSize: config.pageSize,
    timeout: config.timeout,
    progress: options.progress ?? config.progress,
    proxy: config.proxy
  });
}

async function autoUpdateCollections(hexo) {
  const config = getConfig(hexo);
  if (!config?.enable || config.autoUpdate === false) {
    return;
  }

  const cacheMaxAge = Number(config.cacheMaxAge);
  const maxAge = Number.isFinite(cacheMaxAge) ? cacheMaxAge : DEFAULT_CACHE_MAX_AGE;
  if (!shouldRefreshCollections(hexo.source_dir, maxAge)) {
    log.info('Bgm cache is fresh, skip auto update.');
    return;
  }

  if (!pendingAutoUpdate) {
    pendingAutoUpdate = updateCollections(hexo, { progress: config.progress })
      .finally(() => {
        pendingAutoUpdate = null;
      });
  }

  await pendingAutoUpdate;
}

hexo.extend.generator.register('bgm-tv-page', function (locals) {
  const config = getConfig(this);
  if (!config?.enable) {
    return;
  }

  return generateBangumiPage.call(this, locals);
});

hexo.extend.filter.register('before_generate', async function () {
  await autoUpdateCollections(this);
});

hexo.extend.console.register(
  'bgm',
  'Generate a Bangumi collection page for Hexo',
  COMMAND_OPTIONS,
  async function (args) {
    if (args.d) {
      deleteCachedData(this.source_dir);
      return;
    }

    if (!args.u) {
      log.info('Unknown command. Use `hexo bgm -h` to see available options.');
      return;
    }

    const config = getConfig(this);
    await updateCollections(this, { progress: config?.progress });
  }
);

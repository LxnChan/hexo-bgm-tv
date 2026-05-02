# hexo-bgm-tv

基于 bgm.tv API 生成 Hexo 个人追番页的插件。实现思路参考了 [HCLonely/hexo-bilibili-bangumi](https://github.com/HCLonely/hexo-bilibili-bangumi)，但数据源切换为[bgm.tv](https://bgm.tv)

## 功能

- 从 `https://api.bgm.tv/v0/users/{username}/collections` 拉取个人动画收藏
- 按 `想看 / 在看 / 看过 / 搁置 / 抛弃` 生成追番页面
- 支持可选 `Bearer Token`，可读取私密收藏
- 缓存写入 `source/_data/bgm-tv.json`

## 安装

```bash
npm install https://github.com/LxnChan/hexo-bgm-tv --save
```

## 配置

把下面内容写到**站点根目录**的 `_config.yml`：

```yml
bgm:
  enable: true
  username: [your_bangumi_username_or_id]
  accessToken:
  userAgent: 'lxnchan/hexo-bgm-tv (https://github.com/LxnChan/hexo-bgm-tv)'
  path: bgm.tv/index.html
  title: 追番列表
  quote: '生命不息，追番不止。'
  show: 2
  autoUpdate: true
  cacheMaxAge: 21600000
  lazyload: true
  progress: true
  pageSize: 50
  timeout: 15000
```

## 配置说明

- `username`: Bangumi 用户名或用户 ID，必填
- `accessToken`: 可选。需要读取私密收藏时再填
- `userAgent`: 建议必填。Bangumi 官方建议使用能标识开发者和项目的 UA
- `path`: 生成页面路径，默认 `bgm.tv/index.html`
- `show`: 默认显示的 tab，默认 `2`，即 `看过`。也可填 `wantWatch`、`watching`、`watched`、`onHold`、`dropped`
- `autoUpdate`: 是否在 `hexo generate` / `hexo server` 前自动同步，默认 `true`
- `cacheMaxAge`: 缓存最大存活时间，单位毫秒，默认 `21600000`，即 6 小时
- `pageSize`: 单次 API 拉取数量，Bangumi OpenAPI 当前上限是 `50`

## 使用

默认情况下，执行下面任一命令时，插件都会在生成前自动检查并按需更新 Bangumi 数据：

```bash
hexo generate
hexo server
```

如果你想手动强制同步一次，也可以执行：

```bash
hexo bgm -u
```

如果只想删除缓存数据：

```bash
hexo bgm -d
```

## 数据来源

- 用户收藏列表：`GET /v0/users/{username}/collections`
- 查询参数：
  - `subject_type=2` 表示动画
  - `type=1` 表示想看
  - `type=2` 表示看过
  - `type=3` 表示在看
  - `type=4` 表示搁置
  - `type=5` 表示抛弃

官方文档：<https://bangumi.github.io/api/>

## 注意

- 默认是生成前自动更新；如果你不想自动请求 API，可以把 `bgm.autoUpdate` 设为 `false`
- `hexo server` 会监视文件变更并重复触发生成，所以插件默认加了 `cacheMaxAge`，避免每次重建都请求 Bangumi API
- Bangumi 官方 OpenAPI 说明这个时间并不等同于真实收藏时间，而且修改评分、评论、章节进度时不更新属于已知 bug，不建议把它当成精确时间线

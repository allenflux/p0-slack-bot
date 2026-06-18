# P0 Slack Curl Bot

一个 Slack bot，用来把同事发来的 API 调试信息自动拼成可直接运行的 `curl`。

## 功能

- 被 `@mention` 时自动回复 `curl`
- 支持 `/p0curl` slash command
- 可在普通消息里根据关键词自动回复
- 可总结 Slack 群聊/私聊的最近聊天记录
- 可在对话里询问 `你怎么看`，让 bot 总结上下文并给出建议
- 覆盖 `/Users/allenflux/PyCharmProject/temp/backend/src/routers/workflow.py` 下扫描到的 FastAPI 路由
- 根据 backend 的 method、path、Form/Query/Header 参数生成对应 curl
- 自动把图片 URL/文件路径解析成 `download_url`，再按接口参数填入 curl
- 支持 Slack 链接格式，例如 `<https://example.com/a.jpg|...>`
- 支持 `key: value`、`key=value`、`key：value`
- 默认生成 `application/x-www-form-urlencoded` 请求

## 快速开始

```sh
npm install
cp .env.example .env
npm run sync:apis
npm start
```

`.env` 里至少需要配置：

```sh
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
P0_APIKEY=...
IMAGE_RESOLVE_API_URL=http://allenflux.tech:8000/api/image
```

如果使用 Socket Mode，需要在 Slack App 后台打开 Socket Mode，并创建 app-level token。

聊天总结功能可选配置：

```sh
OPENAI_API_KEY=sk-...
OPENAI_SUMMARY_MODEL=gpt-4o-mini
SLACK_SUMMARY_ALLOWED_USERS=U09KY29HKPD
SLACK_SUMMARY_MESSAGE_LIMIT=50
SLACK_SUMMARY_MAX_MESSAGES=200
SLACK_SUMMARY_LOOKBACK_HOURS=24
```

没有 `OPENAI_API_KEY` 时，bot 仍会返回一份结构化的最近消息摘要；配置后会生成更像人工阅读后的“结论 / 要点 / 决定 / 待办 / 风险”总结。

`SLACK_SUMMARY_ALLOWED_USERS` 可限制谁能使用总结功能，多个 Slack user id 用英文逗号分隔。留空则不限制。

## Docker Compose

先准备环境变量：

```sh
cp .env.example .env
```

然后启动：

```sh
docker compose up -d --build
```

查看日志：

```sh
docker compose logs -f p0-slack-curl-bot
```

停止：

```sh
docker compose down
```

Compose 默认使用仓库里已提交的 `data/apiCatalog.json`，所以 VPS 上不需要部署 backend。

如果你在某台机器上也有 backend，可以把 backend 挂载到容器的 `/backend`；启动脚本检测到 `/backend/src/routers/workflow.py` 后，会先执行 `npm run sync:apis` 再启动 bot。

## 同步 backend API

当前 API catalog 来自：

```text
/Users/allenflux/PyCharmProject/temp/backend
```

backend 新增或修改接口后，重新跑：

```sh
npm run sync:apis
```

脚本会更新 `data/apiCatalog.json`。当前扫描逻辑只读取：

```text
src/routers/workflow.py
```

path 后缀是 `/2` 的接口会被忽略。

在 Slack 里发 `接口列表` 或 `api list`，bot 会列出可识别的接口。

## 图片 URL 解析

如果消息里包含图片 URL 或文件路径，bot 会先调用：

```text
http://allenflux.tech:8000/api/image
```

拿返回 JSON 里的 `download_url`，再按匹配到的 workflow API 参数自动填入。比如：

```text
source_path
target_path
first_image
end_image
```

不需要固定写某个参数名。`kiss video` 接口有 `first_image` 和 `end_image`，消息里的两个图片地址会按顺序填进去；`face-swap` 接口有 `source_path` 和 `target_path`，也会按这个接口自己的参数生成 curl。

如果消息里没有图片 URL，但匹配到的接口需要图片参数，bot 会自动从图片服务拿 `download_url` 填入缺失的图片参数。比如直接发：

```text
生成图生图
```

会匹配 `/api/public/generate/image2image`，并自动补 `source_path`。直接发：

```text
生成文生图
```

会匹配 `/api/public/generate/text2image`，并自动补默认 `prompt`。

## Slack App 权限

建议添加这些 OAuth scopes：

```text
app_mentions:read
chat:write
commands
channels:history
groups:history
im:history
mpim:history
users:read
```

如果只想通过 `@mention` 和 `/p0curl` 使用，可以先不加各类 `*:history` 权限。

Event Subscriptions 里建议订阅这些 bot events：

```text
app_mention
message.channels
message.groups
message.im
message.mpim
```

如果只想私聊 bot，至少需要 `message.im` 和 `im:history`。

## 聊天记录总结

可用方式：

```text
@p0-curl-bot 总结最近聊天记录
@p0-curl-bot 总结最近 30 条
@p0-curl-bot 总结最近 2 小时
/p0summary 最近 50 条
@p0-curl-bot 你怎么看
@p0-curl-bot 这个方案你怎么看，给点建议
```

群里只会在 `@mention` 或 `/p0summary` 时总结；私聊 bot 时可以直接发“总结最近聊天记录”。`你怎么看` 会复用同一套 `SLACK_SUMMARY_ALLOWED_USERS` 权限限制。

## 使用示例

在 Slack 里发：

```text
@p0-curl-bot
source_path: https://imgpublic.ycomesc.live/upload_01/upload/20250902/2025090214525538512.jpeg
method: 1
style: realisic
prompt: 真实照片,女+男,金色,波波切,超大,泳装,日本,浴室,Instagram风格,棕褐色
negative_prompt:
size: 720X960
elements: 樱花树
batch_count: 1
strength: 0.5
batch_size: 3
title: 一个女孩子
bid: f13f0591-4e80-4c50-af42-99a08683294c
fee: 1
```

bot 会在 thread 里回复：

```sh
curl --location 'https://p0-api.inaiai.com/api/public/orchestrator/generate/images' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--header 'Accept: application/json' \
--header 'Apikey: ...' \
--data-urlencode 'source_path=https://imgpublic.ycomesc.live/upload_01/upload/20250902/2025090214525538512.jpeg' \
--data-urlencode 'method=1' \
--data-urlencode 'style=realisic' \
--data-urlencode 'prompt=真实照片,女+男,金色,波波切,超大,泳装,日本,浴室,Instagram风格,棕褐色' \
--data-urlencode 'negative_prompt=' \
--data-urlencode 'size=720X960' \
--data-urlencode 'elements=樱花树' \
--data-urlencode 'batch_count=1' \
--data-urlencode 'strength=0.5' \
--data-urlencode 'batch_size=3' \
--data-urlencode 'title=一个女孩子' \
--data-urlencode 'bid=f13f0591-4e80-4c50-af42-99a08683294c' \
--data-urlencode 'fee=1'
```

## 测试

```sh
npm test
```

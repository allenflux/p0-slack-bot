"use strict";

require("dotenv").config();

const { App } = require("@slack/bolt");
const { generateCurl, normalizeSlackText, parseRequest } = require("./curlGenerator");
const { findBestRoute, findRouteByPath, listRoutes } = require("./apiCatalog");
const { resolveImageFields } = require("./imageResolver");
const { buildSummaryReply, canUseSummary, isSummaryRequest, SUMMARY_DENIED_REPLY } = require("./slackSummarizer");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: Boolean(process.env.SLACK_APP_TOKEN),
  appToken: process.env.SLACK_APP_TOKEN
});

const TRIGGER_RE = /(curl|api|接口|接口列表|不生效|生成|文生图|图生图|列表)/i;

function shouldReply(message = {}) {
  if (message.subtype || message.bot_id) return false;
  return message.channel_type === "im" || TRIGGER_RE.test(message.text || "");
}

function applyConvenienceDefaults(fields, route) {
  const nextFields = { ...fields };
  const paramNames = new Set((route?.params || []).map((param) => param.name));

  if (paramNames.has("prompt") && !nextFields.prompt) {
    nextFields.prompt = process.env.P0_DEFAULT_PROMPT || "真实照片,一个人";
  }

  if (paramNames.has("title") && !nextFields.title) {
    nextFields.title = process.env.P0_DEFAULT_TITLE || "auto generated curl";
  }

  if (paramNames.has("scene_name") && !nextFields.scene_name) {
    nextFields.scene_name = process.env.P0_DEFAULT_SCENE_NAME || "venom_transform";
  }

  if (paramNames.has("incoming_prompt") && !nextFields.incoming_prompt) {
    nextFields.incoming_prompt = process.env.P0_DEFAULT_INCOMING_PROMPT || "";
  }

  return nextFields;
}

async function buildReply(text) {
  if (/api\s*list|接口列表|有哪些接口/i.test(text)) {
    return ["当前可识别的 backend API：", "```text", listRoutes(60), "```"].join("\n");
  }

  const parsed = parseRequest(text);
  const route =
    findRouteByPath(parsed.endpoint) ||
    findBestRoute(normalizeSlackText(text)) ||
    findRouteByPath(process.env.P0_DEFAULT_ENDPOINT);

  const defaultedFields = applyConvenienceDefaults(parsed.fields, route);
  let imageResult = { fields: defaultedFields, resolvedImages: [] };
  let imageResolveWarning = "";

  try {
    imageResult = await resolveImageFields(defaultedFields, {
      apiUrl: process.env.IMAGE_RESOLVE_API_URL,
      autoFillMissingImages: true,
      route,
      urls: parsed.urls
    });
  } catch (error) {
    imageResolveWarning = `图片地址解析失败，已先保留原始地址：${error.message}`;
    console.error(imageResolveWarning);
  }

  const curl = generateCurl({
    endpoint: parsed.endpoint || route?.path || process.env.P0_DEFAULT_ENDPOINT,
    fields: imageResult.fields,
    baseUrl: process.env.P0_API_BASE_URL,
    apiKey: process.env.P0_APIKEY,
    route
  });

  const resolvedLines = imageResult.resolvedImages?.length
    ? [
        "已把图片地址转换成 backend 可访问的 download_url：",
        ...imageResult.resolvedImages.map((item) => `${item.field}: ${item.downloadUrl}`),
        ""
      ]
    : [];
  const warningLines = imageResolveWarning ? [imageResolveWarning, ""] : [];

  return [
    ...warningLines,
    ...resolvedLines,
    "我帮你拼好了，可以直接拿去测：",
    "```sh",
    curl,
    "```"
  ].join("\n");
}

app.event("app_mention", async ({ event, client, say }) => {
  console.log(`received app_mention from ${event.user} in ${event.channel}`);
  if (isSummaryRequest(event.text)) {
    if (!canUseSummary(event.user)) {
      await say({
        text: SUMMARY_DENIED_REPLY,
        thread_ts: event.thread_ts || event.ts
      });
      return;
    }

    await say({
      text: await buildSummaryReply({
        client,
        channel: event.channel,
        threadTs: event.thread_ts,
        text: event.text
      }),
      thread_ts: event.thread_ts || event.ts
    });
    return;
  }

  await say({
    text: await buildReply(event.text),
    thread_ts: event.thread_ts || event.ts
  });
});

app.event("message", async ({ event, client, say }) => {
  console.log(
    `received raw message from ${event.user || "unknown"} in ${event.channel} (${event.channel_type || "unknown"})`
  );

  if (!shouldReply(event)) return;

  console.log(
    `received message from ${event.user} in ${event.channel} (${event.channel_type || "unknown"})`
  );
  if (isSummaryRequest(event.text)) {
    if (!canUseSummary(event.user)) {
      await say({
        text: SUMMARY_DENIED_REPLY,
        thread_ts: event.thread_ts || event.ts
      });
      return;
    }

    await say({
      text: await buildSummaryReply({
        client,
        channel: event.channel,
        threadTs: event.thread_ts,
        text: event.text
      }),
      thread_ts: event.thread_ts || event.ts
    });
    return;
  }

  await say({
    text: await buildReply(event.text),
    thread_ts: event.thread_ts || event.ts
  });
});

app.command("/p0curl", async ({ command, ack, respond }) => {
  console.log(`received /p0curl from ${command.user_id} in ${command.channel_id}`);
  await ack();
  await respond({
    response_type: "in_channel",
    text: await buildReply(command.text)
  });
});

app.command("/p0summary", async ({ command, ack, client, respond }) => {
  console.log(`received /p0summary from ${command.user_id} in ${command.channel_id}`);
  await ack();
  if (!canUseSummary(command.user_id)) {
    await respond({
      response_type: "ephemeral",
      text: SUMMARY_DENIED_REPLY
    });
    return;
  }

  await respond({
    response_type: "in_channel",
    text: await buildSummaryReply({
      client,
      channel: command.channel_id,
      text: command.text || "总结最近聊天记录"
    })
  });
});

app.error(async (error) => {
  console.error("Slack app error:", error);
});

(async () => {
  const port = Number(process.env.PORT || 3000);
  const auth = await app.client.auth.test();
  console.log(
    `connected to Slack team=${auth.team} user=${auth.user} user_id=${auth.user_id} bot_id=${auth.bot_id}`
  );
  await app.start(port);
  console.log(`p0 curl bot is running on port ${port}`);
})();

"use strict";

const DEFAULT_LIMIT = Number(process.env.SLACK_SUMMARY_MESSAGE_LIMIT || 50);
const MAX_LIMIT = Number(process.env.SLACK_SUMMARY_MAX_MESSAGES || 200);
const DEFAULT_LOOKBACK_HOURS = Number(process.env.SLACK_SUMMARY_LOOKBACK_HOURS || 24);

const SUMMARY_RE = /(总结|汇总|聊天记录|聊了什么|summary|summarize|recap)/i;
const OPINION_RE = /(你怎么看|怎么看|有啥建议|有什么建议|给.*建议|建议一下|opinion|thoughts|advice)/i;
const SUMMARY_DENIED_REPLY = "你没有权限使用聊天总结/建议功能。";

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

function isSummaryRequest(text = "") {
  return SUMMARY_RE.test(text);
}

function isOpinionRequest(text = "") {
  return OPINION_RE.test(text);
}

function parseAllowedSummaryUsers(value = process.env.SLACK_SUMMARY_ALLOWED_USERS || "") {
  return new Set(
    String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function canUseSummary(userId, allowedUsers = parseAllowedSummaryUsers()) {
  if (!allowedUsers.size) return true;
  return allowedUsers.has(userId);
}

function parseSummaryOptions(text = {}) {
  const source = String(text || "");
  const limitMatch =
    source.match(/(?:最近|last)\s*(\d+)\s*(?:条|则|个|messages?|msgs?)/i) ||
    source.match(/(?:limit|消息数)\s*[:=：]?\s*(\d+)/i);
  const hourMatch =
    source.match(/(?:最近|last)\s*(\d+)\s*(?:小时|hours?|hrs?|h)/i) ||
    source.match(/(?:lookback|hours?)\s*[:=：]?\s*(\d+)/i);
  const dayMatch = source.match(/(?:最近|last)\s*(\d+)\s*(?:天|days?|d)/i);

  const limit = clampNumber(limitMatch?.[1] || DEFAULT_LIMIT, 1, MAX_LIMIT);
  let lookbackHours = clampNumber(DEFAULT_LOOKBACK_HOURS, 1, 24 * 30);

  if (hourMatch) {
    lookbackHours = clampNumber(hourMatch[1], 1, 24 * 30);
  } else if (dayMatch) {
    lookbackHours = clampNumber(Number(dayMatch[1]) * 24, 1, 24 * 30);
  }

  return {
    limit,
    oldest: String(Math.floor(Date.now() / 1000) - lookbackHours * 60 * 60),
    lookbackHours
  };
}

function cleanSlackText(text = "") {
  return String(text)
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveUserName(client, userId, cache) {
  if (!userId) return "unknown";
  if (cache.has(userId)) return cache.get(userId);

  try {
    const result = await client.users.info({ user: userId });
    const profile = result.user?.profile || {};
    const name = profile.display_name || profile.real_name || result.user?.name || userId;
    cache.set(userId, name);
    return name;
  } catch (error) {
    cache.set(userId, userId);
    return userId;
  }
}

function isUsefulMessage(message) {
  if (!message || message.bot_id) return false;
  if (message.subtype && !["thread_broadcast"].includes(message.subtype)) return false;
  return Boolean(cleanSlackText(message.text || ""));
}

async function fetchMessages({ client, channel, threadTs, limit, oldest }) {
  const result = threadTs
    ? await client.conversations.replies({
        channel,
        ts: threadTs,
        limit
      })
    : await client.conversations.history({
        channel,
        limit,
        oldest,
        inclusive: true
      });

  return (result.messages || []).filter(isUsefulMessage).reverse();
}

async function formatMessagesForSummary(client, messages) {
  const userCache = new Map();
  const lines = [];

  for (const message of messages) {
    const userName = await resolveUserName(client, message.user, userCache);
    const text = cleanSlackText(message.text);
    if (text) lines.push(`${userName}: ${text}`);
  }

  return lines;
}

function buildFallbackSummary(lines, { lookbackHours }) {
  const participants = [...new Set(lines.map((line) => line.split(":")[0]).filter(Boolean))];
  const preview = lines.slice(-12);

  return [
    `我看了最近 ${lookbackHours} 小时内的 ${lines.length} 条消息。`,
    "",
    "*参与者*",
    participants.length ? participants.map((name) => `- ${name}`).join("\n") : "- 暂无",
    "",
    "*最近重点*",
    preview.length ? preview.map((line) => `- ${line}`).join("\n") : "- 暂无可总结内容",
    "",
    "提示：配置 `OPENAI_API_KEY` 后，我可以把这些聊天记录压缩成更像人读过后的要点、决定和待办。"
  ].join("\n");
}

function buildFallbackOpinion(lines, { lookbackHours }) {
  const preview = lines.slice(-12);

  return [
    `我看了最近 ${lookbackHours} 小时内的 ${lines.length} 条消息。`,
    "",
    "*我的初步判断*",
    "- 当前没有可用的 OpenAI 额度或 key，所以我只能基于最近消息做粗略整理。",
    "",
    "*建议*",
    preview.length
      ? [
          "- 先确认大家讨论里的核心分歧或待决点。",
          "- 把下一步拆成明确 owner、截止时间和验收标准。",
          "- 如果信息还不完整，先补齐关键上下文再推进。"
        ].join("\n")
      : "- 暂无可判断内容",
    "",
    "*最近上下文*",
    preview.length ? preview.map((line) => `- ${line}`).join("\n") : "- 暂无"
  ].join("\n");
}

async function callOpenAI(lines, { lookbackHours, mode }) {
  if (!process.env.OPENAI_API_KEY) return null;

  const model = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini";
  const systemContent =
    mode === "opinion"
      ? "你是一个帮用户阅读 Slack 对话并给出判断和建议的助手。用中文输出，保持直接、克制、可执行。结构固定为：我的判断、建议、风险/注意点、下一步。没有内容的部分写“暂无”。不要编造对话里没有的信息。"
      : "你是一个 Slack 聊天记录总结助手。用中文输出，简洁但保留具体信息。结构固定为：主要结论、讨论要点、决定、待办、风险/未解决问题。没有内容的部分写“暂无”。";
  const userContent =
    mode === "opinion"
      ? [`请阅读下面最近 ${lookbackHours} 小时的 Slack 对话，先简要总结上下文，再给出你的判断和建议。`, "", lines.join("\n")].join("\n")
      : [`请总结下面最近 ${lookbackHours} 小时的 Slack 聊天记录。`, "", lines.join("\n")].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: systemContent
        },
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI summary failed: ${response.status} ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  return data.output_text || data.output?.flatMap((item) => item.content || []).map((part) => part.text).join("\n");
}

async function getConversationLines({ client, channel, threadTs, text }) {
  const options = parseSummaryOptions(text);
  let messages = [];

  try {
    messages = await fetchMessages({
      client,
      channel,
      threadTs,
      limit: options.limit,
      oldest: options.oldest
    });
  } catch (error) {
    const reason = error.data?.error || error.message;
    return [
      `我想总结，但读取 Slack 聊天记录失败：${reason}`,
      "请确认 bot 已加入当前 channel/group，并且 Slack App 开启了对应的 `channels:history`、`groups:history`、`im:history` 或 `mpim:history` 权限。"
    ].join("\n");
  }

  const lines = await formatMessagesForSummary(client, messages);
  return { lines, options };
}

async function buildSummaryReply({ client, channel, threadTs, text }) {
  const result = await getConversationLines({ client, channel, threadTs, text });
  if (typeof result === "string") return result;

  const { lines, options } = result;

  if (!lines.length) {
    return "我看了最近的聊天记录，但没有找到可总结的普通消息。";
  }

  try {
    const aiSummary = await callOpenAI(lines, { ...options, mode: "summary" });
    if (aiSummary) return aiSummary;
  } catch (error) {
    console.error(error.message);
  }

  return buildFallbackSummary(lines, options);
}

async function buildOpinionReply({ client, channel, threadTs, text }) {
  const result = await getConversationLines({ client, channel, threadTs, text });
  if (typeof result === "string") return result;

  const { lines, options } = result;

  if (!lines.length) {
    return "我看了最近的聊天记录，但没有找到可判断的普通消息。";
  }

  try {
    const opinion = await callOpenAI(lines, { ...options, mode: "opinion" });
    if (opinion) return opinion;
  } catch (error) {
    console.error(error.message);
  }

  return buildFallbackOpinion(lines, options);
}

module.exports = {
  buildFallbackOpinion,
  buildFallbackSummary,
  buildOpinionReply,
  buildSummaryReply,
  canUseSummary,
  cleanSlackText,
  formatMessagesForSummary,
  isOpinionRequest,
  isSummaryRequest,
  parseAllowedSummaryUsers,
  parseSummaryOptions,
  SUMMARY_DENIED_REPLY
};

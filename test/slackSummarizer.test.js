"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSummaryReply,
  canUseSummary,
  cleanSlackText,
  isSummaryRequest,
  parseAllowedSummaryUsers,
  parseSummaryOptions
} = require("../src/slackSummarizer");

test("summary requests are detected in Chinese and English", () => {
  assert.equal(isSummaryRequest("帮我总结一下最近聊天记录"), true);
  assert.equal(isSummaryRequest("please recap last 20 messages"), true);
  assert.equal(isSummaryRequest("生成一个 curl"), false);
});

test("summary options parse limit and lookback window", () => {
  const options = parseSummaryOptions("总结最近 30 条，最近 2 小时");

  assert.equal(options.limit, 30);
  assert.equal(options.lookbackHours, 2);
  assert.match(options.oldest, /^\d+$/);
});

test("slack text cleanup removes mentions and keeps link labels", () => {
  assert.equal(cleanSlackText("<@U123> 看这个 <https://example.com|链接> &amp; ok"), "看这个 链接 & ok");
});

test("summary user allowlist permits only configured users", () => {
  const allowedUsers = parseAllowedSummaryUsers("U1, U2");

  assert.equal(canUseSummary("U1", allowedUsers), true);
  assert.equal(canUseSummary("U3", allowedUsers), false);
  assert.equal(canUseSummary("U3", parseAllowedSummaryUsers("")), true);
});

test("buildSummaryReply returns fallback summary without OpenAI key", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const client = {
    conversations: {
      history: async () => ({
        messages: [
          { user: "U2", text: "第二条", ts: "2" },
          { user: "U1", text: "第一条", ts: "1" }
        ]
      })
    },
    users: {
      info: async ({ user }) => ({
        user: {
          name: user,
          profile: {
            display_name: user === "U1" ? "Allen" : "Mia"
          }
        }
      })
    }
  };

  const reply = await buildSummaryReply({
    client,
    channel: "C1",
    text: "总结最近 2 条"
  });

  assert.match(reply, /Allen: 第一条/);
  assert.match(reply, /Mia: 第二条/);

  if (originalKey) {
    process.env.OPENAI_API_KEY = originalKey;
  }
});

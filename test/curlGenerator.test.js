"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createCurlFromSlackText,
  normalizeSlackText,
  parseRequest
} = require("../src/curlGenerator");

test("normalizes Slack formatted links", () => {
  assert.equal(
    normalizeSlackText("<https://example.com/a.jpg|https://example.com/a.jpg>"),
    "https://example.com/a.jpg"
  );
});

test("parses common key-value fields", () => {
  const parsed = parseRequest(`
api: /api/public/orchestrator/generate/images
source_path: https://img.example.com/a.jpeg
style: realisic
prompt: 真实照片,女+男
batch_size: 3
`);

  assert.equal(parsed.endpoint, "/api/public/orchestrator/generate/images");
  assert.equal(parsed.fields.source_path, "https://img.example.com/a.jpeg");
  assert.equal(parsed.fields.prompt, "真实照片,女+男");
  assert.equal(parsed.fields.batch_size, "3");
});

test("parses Chinese scene aliases", () => {
  const parsed = parseRequest("场景: venom_transform");
  assert.equal(parsed.fields.scene_name, "venom_transform");
});

test("generates a ready curl with defaults", () => {
  const curl = createCurlFromSlackText(
    "source: https://img.example.com/a.jpeg\nprompt: 真实照片\nsize=720X960",
    {
      apiKey: "test-key",
      baseUrl: "https://p0-api.inaiai.com",
      defaultEndpoint: "/api/public/orchestrator/generate/images"
    }
  );

  assert.match(curl, /curl --location 'https:\/\/p0-api\.inaiai\.com\/api\/public\/orchestrator\/generate\/images'/);
  assert.match(curl, /--header 'Apikey: test-key'/);
  assert.match(curl, /--data-urlencode 'source_path=https:\/\/img\.example\.com\/a\.jpeg'/);
  assert.match(curl, /--data-urlencode 'prompt=真实照片'/);
  assert.match(curl, /--data-urlencode 'size=720X960'/);
});

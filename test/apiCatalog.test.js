"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { findBestRoute } = require("../src/apiCatalog");

test("matches Chinese image2image intent", () => {
  const route = findBestRoute("帮我生成一个图生图的url");
  assert.equal(route.path, "/api/public/generate/image2image");
});

test("matches Chinese text2image intent", () => {
  const route = findBestRoute("生成文生图");
  assert.equal(route.path, "/api/public/generate/text2image");
});

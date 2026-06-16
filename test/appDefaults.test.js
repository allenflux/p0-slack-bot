"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { findRouteByPath } = require("../src/apiCatalog");
const { generateCurl } = require("../src/curlGenerator");

test("videos scenes curl can include default scene_name", () => {
  const route = findRouteByPath("/api/public/generate/videos/scenes");
  const curl = generateCurl({
    endpoint: route.path,
    fields: {
      source_path: "http://allenflux.tech:8000/files/test.jpg",
      scene_name: "venom_transform",
      title: "auto generated curl"
    },
    baseUrl: "https://p0-api.inaiai.com",
    apiKey: "test-key",
    route
  });

  assert.match(curl, /--data-urlencode 'scene_name=venom_transform'/);
});

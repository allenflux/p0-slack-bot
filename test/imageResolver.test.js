"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { imageParamNames, resolveImageFields } = require("../src/imageResolver");

test("uses route-specific image parameter names", () => {
  const route = {
    params: [
      { name: "first_image" },
      { name: "end_image" },
      { name: "notify_url" }
    ]
  };

  assert.deepEqual(imageParamNames(route), ["first_image", "end_image"]);
});

test("assigns naked image urls to empty route image params", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ download_url: "http://allenflux.tech:8000/files/test.jpg" })
  });

  try {
    const result = await resolveImageFields(
      {},
      {
        apiUrl: "http://allenflux.tech:8000/api/image",
        urls: ["https://example.com/source.jpg"],
        route: { params: [{ name: "source_path" }] }
      }
    );

    assert.equal(result.fields.source_path, "http://allenflux.tech:8000/files/test.jpg");
    assert.equal(result.resolvedImages[0].field, "source_path");
  } finally {
    global.fetch = originalFetch;
  }
});

test("does not use a download url when resolver source_url mismatches input", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      source_url: "https://example.com/other.jpg",
      download_url: "http://allenflux.tech:8000/files/other.jpg"
    })
  });

  try {
    const result = await resolveImageFields(
      {},
      {
        apiUrl: "http://allenflux.tech:8000/api/image",
        urls: ["https://example.com/source.jpg"],
        route: { params: [{ name: "source_path" }] }
      }
    );

    assert.equal(result.fields.source_path, "https://example.com/source.jpg");
    assert.deepEqual(result.resolvedImages, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("auto fills missing route image params from the resolver", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        download_url: `http://allenflux.tech:8000/files/auto-${calls}.jpg`
      })
    };
  };

  try {
    const result = await resolveImageFields(
      {},
      {
        apiUrl: "http://allenflux.tech:8000/api/image",
        autoFillMissingImages: true,
        route: { params: [{ name: "first_image" }, { name: "end_image" }] }
      }
    );

    assert.equal(result.fields.first_image, "http://allenflux.tech:8000/files/auto-1.jpg");
    assert.equal(result.fields.end_image, "http://allenflux.tech:8000/files/auto-2.jpg");
    assert.equal(result.resolvedImages.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

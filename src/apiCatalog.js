"use strict";

const catalog = require("../data/apiCatalog.json");

const INTENT_ROUTES = [
  { patterns: [/图生图/, /image\s*2\s*image/i, /image2image/i], path: "/api/public/generate/image2image" },
  { patterns: [/文生图/, /text\s*2\s*image/i, /text2image/i], path: "/api/public/generate/text2image" },
  { patterns: [/换脸视频/, /face\s*swap\s*video/i], path: "/api/public/generate/face-swap/video" },
  { patterns: [/换脸/, /face\s*swap/i], path: "/api/public/generate/face-swap" },
  { patterns: [/亲吻/, /kiss/i], path: "/api/public/generate/kiss/video" },
  { patterns: [/脱衣动漫视频/, /anime.*video/i], path: "/api/public/generate/undress/anime/video" },
  { patterns: [/脱衣动漫/, /anime/i], path: "/api/public/generate/undress/anime" },
  { patterns: [/脱衣图片/, /undress.*image/i], path: "/api/public/generate/undress/images" },
  { patterns: [/脱衣视频/, /undress.*video/i], path: "/api/public/generate/undress" },
  { patterns: [/姿势迁移/, /pose.?transfer/i], path: "/api/public/generate/pose_transfer/video" },
  { patterns: [/纹身/, /tattoo/i], path: "/api/public/generate/tattoos" },
  { patterns: [/换装/, /clothes.?swap/i], path: "/api/public/generate/clothes-swap/images" },
  { patterns: [/视频场景/, /场景视频/, /生成视频/, /videos?.*scenes?/i], path: "/api/public/generate/videos/scenes" }
];

function normalize(text = "") {
  return String(text).toLowerCase().replace(/[_/-]+/g, " ");
}

function routeTokens(route) {
  return [...new Set(normalize(
    [
      route.path,
      route.name,
      route.functionName,
      ...(route.tags || [])
    ].join(" ")
  )
    .split(/\s+/)
    .filter(Boolean))];
}

function findRouteByPath(pathOrUrl) {
  if (!pathOrUrl) return null;
  const path = pathOrUrl.replace(/^https?:\/\/[^/]+/i, "");
  return catalog.routes.find((route) => route.path === path) || null;
}

function findBestRoute(text) {
  const normalized = normalize(text);
  const intentRoute = findRouteByIntent(text);
  if (intentRoute) return intentRoute;

  let best = null;

  for (const route of catalog.routes) {
    if (route.path.length > 1 && text.includes(route.path)) return route;

    let score = 0;
    if (route.name && text.includes(route.name)) score += 20;
    if (route.functionName && normalized.includes(normalize(route.functionName))) score += 10;

    for (const token of routeTokens(route)) {
      if (token.length >= 3 && normalized.includes(token)) score += 1;
    }

    if (!best || score > best.score) best = { route, score };
  }

  return best && best.score >= 2 ? best.route : null;
}

function findRouteByIntent(text) {
  for (const intent of INTENT_ROUTES) {
    if (intent.patterns.some((pattern) => pattern.test(text))) {
      const route = findRouteByPath(intent.path);
      if (route) return route;
    }
  }
  return null;
}

function listRoutes(limit = 20) {
  return catalog.routes
    .slice(0, limit)
    .map((route) => `${route.method} ${route.path} - ${route.name}`)
    .join("\n");
}

module.exports = {
  catalog,
  findBestRoute,
  findRouteByIntent,
  findRouteByPath,
  listRoutes
};

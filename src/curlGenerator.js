"use strict";

const DEFAULT_ENDPOINT = "/api/public/orchestrator/generate/images";
const DEFAULT_BASE_URL = "https://p0-api.inaiai.com";
const { findBestRoute, findRouteByPath } = require("./apiCatalog");

const FIELD_ALIASES = new Map([
  ["api", "endpoint"],
  ["url", "source_path"],
  ["path", "endpoint"],
  ["source", "source_path"],
  ["image", "source_path"],
  ["img", "source_path"],
  ["target", "target_path"],
  ["target_image", "target_path"],
  ["first", "first_image"],
  ["first_path", "first_image"],
  ["end", "end_image"],
  ["end_path", "end_image"],
  ["scene", "scene_name"],
  ["scene_name", "scene_name"],
  ["scence", "scene_name"],
  ["scence_name", "scene_name"],
  ["场景", "scene_name"],
  ["场景名", "scene_name"],
  ["场景名称", "scene_name"],
  ["apikey", "apikey"],
  ["api_key", "apikey"]
]);

const DEFAULT_FIELD_ORDER = [
  "source_path",
  "method",
  "style",
  "prompt",
  "negative_prompt",
  "size",
  "elements",
  "batch_count",
  "strength",
  "batch_size",
  "title",
  "bid",
  "fee"
];

function normalizeSlackText(text = "") {
  return text
    .replace(/<([^|>]+)\|[^>]+>/g, "$1")
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeKey(rawKey) {
  const key = rawKey.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return FIELD_ALIASES.get(key) || key;
}

function stripWrappingQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractExplicitFields(text) {
  const fields = {};
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const cleaned = line.trim().replace(/^[-*]\s+/, "");
    const match = cleaned.match(/^([A-Za-z\u4e00-\u9fa5][\w\s\-\u4e00-\u9fa5]{0,40})\s*(?:=|:|：)\s*(.*)$/);
    if (!match) continue;

    const key = normalizeKey(match[1]);
    const value = stripWrappingQuotes(match[2]);
    fields[key] = value;
  }

  return fields;
}

function extractUrl(text) {
  const urlMatch = text.match(/https?:\/\/[^\s<>'")]+/);
  return urlMatch ? urlMatch[0] : "";
}

function extractUrls(text) {
  return [...text.matchAll(/https?:\/\/[^\s<>'")]+/g)].map((match) => match[0]);
}

function extractEndpoint(text) {
  const explicit = extractExplicitFields(text).endpoint;
  if (explicit) return explicit;

  const apiPath = text.match(/\/api\/[A-Za-z0-9/_-]+/);
  if (apiPath) return apiPath[0];

  const apiUrl = text.match(/https?:\/\/[^\s<>'")]*\/api\/[^\s<>'")]+/);
  return apiUrl ? apiUrl[0] : "";
}

function inferPrompt(text, fields) {
  if (fields.prompt) return fields.prompt;

  const promptMatch = text.match(/(?:prompt|提示词|正向词)\s*(?:=|:|：)\s*(.+)/i);
  if (promptMatch) return promptMatch[1].trim();

  return "";
}

function parseRequest(text) {
  const normalized = normalizeSlackText(text);
  const fields = extractExplicitFields(normalized);

  const imageUrl = fields.source_path || extractUrl(normalized);
  if (imageUrl && !fields.source_path) fields.source_path = imageUrl;

  const endpoint = extractEndpoint(normalized);
  const prompt = inferPrompt(normalized, fields);
  if (prompt) fields.prompt = prompt;

  delete fields.endpoint;

  return {
    endpoint,
    fields,
    urls: extractUrls(normalized)
  };
}

function buildFullUrl(endpoint, baseUrl = DEFAULT_BASE_URL) {
  if (!endpoint) {
    return `${baseUrl.replace(/\/+$/, "")}${DEFAULT_ENDPOINT}`;
  }

  if (/^https?:\/\//i.test(endpoint)) return endpoint;

  const base = baseUrl.replace(/\/+$/, "");
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${base}${path}`;
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function orderedEntries(fields) {
  const seen = new Set();
  const entries = [];

  for (const key of DEFAULT_FIELD_ORDER) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      entries.push([key, fields[key]]);
      seen.add(key);
    }
  }

  for (const key of Object.keys(fields).sort()) {
    if (!seen.has(key) && key !== "apikey") entries.push([key, fields[key]]);
  }

  return entries;
}

function fieldsFromRoute(route, overrides = {}) {
  if (!route) return { ...overrides };

  const fields = {};
  for (const param of route.params || []) {
    if (param.in === "header" || param.in === "path") continue;
    if (Object.prototype.hasOwnProperty.call(overrides, param.name)) {
      fields[param.name] = overrides[param.name];
    } else if (param.required || defaultIsMeaningful(param.default)) {
      fields[param.name] = param.default;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    fields[key] = value;
  }

  return fields;
}

function defaultIsMeaningful(value) {
  return value !== "" && value !== "None" && value !== "[]" && value !== "null";
}

function headerFieldsFromRoute(route, overrides = {}) {
  const headers = {};
  for (const param of route?.params || []) {
    if (param.in !== "header") continue;
    headers[param.name] = Object.prototype.hasOwnProperty.call(overrides, param.name)
      ? overrides[param.name]
      : param.default;
  }
  return headers;
}

function applyPathParams(url, route, fields) {
  let nextUrl = url;
  for (const param of route?.params || []) {
    if (param.in !== "path") continue;
    const value = fields[param.name] || param.default || `{${param.name}}`;
    nextUrl = nextUrl.replace(`{${param.name}}`, encodeURIComponent(value));
  }
  return nextUrl;
}

function generateCurl({ endpoint, fields = {}, baseUrl, apiKey, route } = {}) {
  const url = buildFullUrl(endpoint, baseUrl);
  const method = route?.method || "POST";
  const routeFields = fieldsFromRoute(route, fields);
  const headerFields = headerFieldsFromRoute(route, fields);
  const hasFormData = Object.values(route?.params || {}).some((param) => param.in === "form");
  const key = fields.apikey || apiKey || "";
  const lines = [
    `curl --location${method === "GET" ? " --get" : ""} ${shellSingleQuote(
      applyPathParams(url, route, fields)
    )} \\`,
    "--header 'Accept: application/json' \\"
  ];

  if (method !== "GET" || hasFormData) {
    lines.push("--header 'Content-Type: application/x-www-form-urlencoded' \\");
  }

  if (key) {
    lines.push(`--header 'Apikey: ${key}' \\`);
  } else {
    lines.push("--header 'Apikey: $P0_APIKEY' \\");
  }

  for (const [header, value] of Object.entries(headerFields)) {
    lines.push(`--header ${shellSingleQuote(`${header}: ${value}`)} \\`);
  }

  const dataLines = orderedEntries(routeFields)
    .filter(([field]) => field !== "apikey")
    .map(([field, value]) => `--data-urlencode ${shellSingleQuote(`${field}=${value}`)}`);

  if (dataLines.length === 0) {
    return lines.join("\n").replace(/ \\$/, "");
  }

  return `${lines.join("\n")}\n${dataLines.join(" \\\n")}`;
}

function createCurlFromSlackText(text, options = {}) {
  const parsed = parseRequest(text);
  const route =
    findRouteByPath(parsed.endpoint) ||
    findBestRoute(normalizeSlackText(text)) ||
    findRouteByPath(options.defaultEndpoint);

  return generateCurl({
    endpoint: parsed.endpoint || route?.path || options.defaultEndpoint,
    fields: parsed.fields,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    route
  });
}

module.exports = {
  createCurlFromSlackText,
  extractUrls,
  generateCurl,
  normalizeSlackText,
  parseRequest
};

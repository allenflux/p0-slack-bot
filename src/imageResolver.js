"use strict";

function looksResolvableImageInput(value = "") {
  const text = String(value).trim();
  if (!text) return false;
  if (/^https?:\/\/[^/]+\/api\//i.test(text)) return false;
  return /^(https?:\/\/|\/|\.\/|\.\.\/)/i.test(text);
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`image resolver returned ${response.status}`);
  }

  return response.json();
}

async function resolveImageInput(input, options = {}) {
  const apiUrl = options.apiUrl;
  if (!apiUrl || !looksResolvableImageInput(input)) return null;

  const base = apiUrl.replace(/\/+$/, "");
  const encoded = encodeURIComponent(input);
  const candidates = [
    () => fetchJson(`${base}?url=${encoded}`),
    () => fetchJson(`${base}?source_url=${encoded}`),
    () => fetchJson(`${base}?path=${encoded}`),
    () =>
      fetchJson(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: input, source_url: input, path: input })
      }),
    () =>
      fetchJson(base, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ url: input, source_url: input, path: input })
      }),
    () => fetchJson(base)
  ];

  let lastError = null;
  for (const fetchCandidate of candidates) {
    try {
      const data = await fetchCandidate();
      if (data && data.download_url && responseMatchesInput(data, input, options)) {
        return {
          downloadUrl: data.download_url,
          data
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return null;
}

async function resolveDefaultImage(options = {}) {
  const apiUrl = options.apiUrl;
  if (!apiUrl) return null;

  const data = await fetchJson(apiUrl.replace(/\/+$/, ""));
  if (!data?.download_url) return null;

  return {
    downloadUrl: data.download_url,
    data
  };
}

function responseMatchesInput(data, input, options = {}) {
  if (options.allowMismatchedSourceUrl) return true;
  if (!data.source_url) return true;
  return normalizeComparableUrl(data.source_url) === normalizeComparableUrl(input);
}

function normalizeComparableUrl(value = "") {
  return String(value).trim().replace(/\/+$/, "");
}

function imageParamNames(route) {
  const explicit = new Set(["source_path", "target_path", "first_image", "end_image"]);
  const params = route?.params || [];
  return params
    .map((param) => param.name)
    .filter((name) => {
      if (name === "notify_url") return false;
      return explicit.has(name) || /(image|img|source|target|path)$/i.test(name);
    });
}

async function resolveImageFields(fields, options = {}) {
  const nextFields = { ...fields };
  const routeImageParams = imageParamNames(options.route);
  const usedInputs = [];
  const resolvedImages = [];

  for (const paramName of routeImageParams) {
    if (!nextFields[paramName]) continue;

    const resolved = await resolveImageInput(nextFields[paramName], options);
    if (resolved?.downloadUrl) {
      usedInputs.push(nextFields[paramName]);
      nextFields[paramName] = resolved.downloadUrl;
      resolvedImages.push({ field: paramName, ...resolved });
    }
  }

  const unassignedUrls = (options.urls || []).filter((url) => !usedInputs.includes(url));
  for (const url of unassignedUrls) {
    const emptyParam = routeImageParams.find((paramName) => !nextFields[paramName]);
    if (!emptyParam) break;

    const resolved = await resolveImageInput(url, options);
    nextFields[emptyParam] = resolved?.downloadUrl || url;
    if (resolved?.downloadUrl) {
      resolvedImages.push({ field: emptyParam, ...resolved });
    }
  }

  if (options.autoFillMissingImages) {
    for (const paramName of routeImageParams) {
      if (nextFields[paramName]) continue;

      const resolved = await resolveDefaultImage(options);
      if (resolved?.downloadUrl) {
        nextFields[paramName] = resolved.downloadUrl;
        resolvedImages.push({ field: paramName, autoFilled: true, ...resolved });
      }
    }
  }

  return {
    fields: nextFields,
    resolvedImages
  };
}

module.exports = {
  imageParamNames,
  looksResolvableImageInput,
  resolveDefaultImage,
  resolveImageFields,
  resolveImageInput
};

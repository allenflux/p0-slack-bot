"use strict";

const fs = require("node:fs");
const path = require("node:path");

const backendRoot =
  process.env.BACKEND_ROOT || "/Users/allenflux/PyCharmProject/temp/backend";
const workflowRouterPath = path.join(backendRoot, "src", "routers", "workflow.py");
const outputPath = path.join(__dirname, "..", "data", "apiCatalog.json");

const METHODS = new Set(["get", "post", "put", "delete", "patch"]);

function findMatchingParen(text, openIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    const next3 = text.slice(i, i + 3);

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (quote.length === 3 && next3 === quote) {
        quote = "";
        i += 2;
      } else if (quote.length === 1 && char === quote) {
        quote = "";
      }
      continue;
    }

    if (next3 === '"""' || next3 === "'''") {
      quote = next3;
      i += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function splitTopLevel(input) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if ("([{".includes(char)) depth += 1;
    if (")]}".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }

  const tail = input.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function readFirstString(input) {
  const match = input.match(/["']([^"']+)["']/);
  return match ? match[1] : "";
}

function readKeyword(input, keyword) {
  const match = input.match(new RegExp(`${keyword}\\s*=\\s*("[^"]*"|'[^']*'|[^,\\n)]+)`));
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function readDefault(input) {
  const defaultValue = readKeyword(input, "default");
  if (defaultValue) return defaultValue;
  if (/\.\.\./.test(input)) return "";
  return "";
}

function parseDecoratorArgs(args) {
  return {
    path: readFirstString(args),
    name: readKeyword(args, "name"),
    tags: [...args.matchAll(/tags\s*=\s*\[([^\]]*)\]/g)]
      .flatMap((match) => [...match[1].matchAll(/["']([^"']+)["']/g)].map((tag) => tag[1]))
  };
}

function parseParam(param) {
  const nameMatch = param.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  if (["self", "request", "response", "background_tasks"].includes(name)) return null;

  const sourceMatch = param.match(/=\s*(Form|Query|Body|Header|File|Path|Cookie)\s*\(/);
  const annotationMatch = param.match(/:\s*([^=]+)/);
  const source = sourceMatch ? sourceMatch[1].toLowerCase() : "body";
  const required = sourceMatch ? /\(\s*\.\.\./.test(param) && !/default\s*=/.test(param) : !/=/.test(param);

  return {
    name,
    in: source,
    type: annotationMatch ? annotationMatch[1].trim() : "",
    required,
    default: readDefault(param),
    description: readKeyword(param, "description")
  };
}

function parseFunctionSignature(text, startIndex) {
  const defMatch = text.slice(startIndex).match(/\n\s*(?:async\s+def|def)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  if (!defMatch) return null;

  const name = defMatch[1];
  const openIndex = startIndex + defMatch.index + defMatch[0].lastIndexOf("(");
  const closeIndex = findMatchingParen(text, openIndex);
  if (closeIndex < 0) return null;

  const signature = text.slice(openIndex + 1, closeIndex);
  const params = splitTopLevel(signature).map(parseParam).filter(Boolean);
  return { name, params };
}

function parseRoutes(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const routes = [];
  const decoratorRegex = /@router\.(get|post|put|delete|patch)\s*\(/g;
  let match;

  while ((match = decoratorRegex.exec(text))) {
    const method = match[1];
    if (!METHODS.has(method)) continue;

    const openIndex = text.indexOf("(", match.index);
    const closeIndex = findMatchingParen(text, openIndex);
    if (closeIndex < 0) continue;

    const decoratorArgs = text.slice(openIndex + 1, closeIndex);
    const meta = parseDecoratorArgs(decoratorArgs);
    const fn = parseFunctionSignature(text, closeIndex);
    if (!meta.path || !fn) continue;

    routes.push({
      method: method.toUpperCase(),
      path: meta.path,
      name: meta.name || fn.name,
      functionName: fn.name,
      tags: meta.tags,
      file: path.relative(backendRoot, filePath),
      params: fn.params
    });
  }

  return routes;
}

function main() {
  if (!fs.existsSync(workflowRouterPath)) {
    throw new Error(`Cannot find workflow router: ${workflowRouterPath}`);
  }

  const routes = parseRoutes(workflowRouterPath).filter((route) => !route.path.endsWith("/2")).sort((a, b) => {
    if (a.path === b.path) return a.method.localeCompare(b.method);
    return a.path.localeCompare(b.path);
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        backendRoot,
        routeCount: routes.length,
        routes
      },
      null,
      2
    )}\n`
  );

  console.log(`Wrote ${routes.length} routes to ${outputPath}`);
}

main();

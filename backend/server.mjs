import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const publicRootFiles = new Set(["CNAME", "index.html", "sync-client.js"]);

mkdirSync(dataDir, { recursive: true });

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response, statusCode, payload) {
  setCorsHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  setCorsHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(text);
}

function normalizeProfileId(profileId) {
  const normalized = String(profileId ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  if (normalized.length < 3) {
    throw new Error("Profile ID must be at least 3 characters after cleanup.");
  }

  return normalized;
}

function assertSyncKey(syncKey) {
  const normalized = String(syncKey ?? "").trim();

  if (normalized.length < 8) {
    throw new Error("Sync key must be at least 8 characters.");
  }

  return normalized;
}

function buildProfilePath(profileId) {
  const normalized = normalizeProfileId(profileId);
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return {
    normalized,
    filePath: path.join(dataDir, `${normalized}--${hash}.json`)
  };
}

function hashSecret(secret, salt = randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: scryptSync(secret, salt, 64).toString("hex")
  };
}

function verifySecret(secret, secretRecord) {
  const actual = scryptSync(secret, secretRecord.salt, 64);
  const expected = Buffer.from(secretRecord.hash, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

function sanitizeBooleanMap(value, limit) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const sanitized = {};
  let count = 0;

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey).slice(0, 120);
    sanitized[key] = Boolean(rawValue);
    count += 1;

    if (count >= limit) {
      break;
    }
  }

  return sanitized;
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload must be a JSON object.");
  }

  const updatedAt = Number.isFinite(payload.updatedAt)
    ? Math.max(0, Math.trunc(payload.updatedAt))
    : Date.now();

  return {
    checked: sanitizeBooleanMap(payload.checked, 512),
    adhdMode: Boolean(payload.adhdMode),
    tipIdx: Number.isFinite(payload.tipIdx) ? Math.max(0, Math.trunc(payload.tipIdx)) : 0,
    activePhase: Number.isFinite(payload.activePhase)
      ? Math.max(1, Math.trunc(payload.activePhase))
      : 1,
    openSkills: sanitizeBooleanMap(payload.openSkills, 128),
    updatedAt
  };
}

async function readBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > 256 * 1024) {
      throw new Error("Request body is too large.");
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(request) {
  const raw = await readBody(request);

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

async function loadProfile(profileId) {
  const { normalized, filePath } = buildProfilePath(profileId);

  try {
    const raw = await readFile(filePath, "utf8");
    return {
      normalized,
      filePath,
      record: JSON.parse(raw)
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        normalized,
        filePath,
        record: null
      };
    }

    throw error;
  }
}

async function writeProfile(filePath, record) {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function shapeResponseState(record) {
  return {
    ...record.payload,
    updatedAt: record.payload.updatedAt
  };
}

async function handleLoadState(request, response) {
  const body = await readJson(request);
  const profileId = normalizeProfileId(body.profileId);
  const syncKey = assertSyncKey(body.syncKey);
  const { record } = await loadProfile(profileId);

  if (!record) {
    sendJson(response, 404, {
      ok: false,
      code: "PROFILE_NOT_FOUND",
      message: "No saved roadmap state exists for that profile yet."
    });
    return;
  }

  if (!verifySecret(syncKey, record.secret)) {
    sendJson(response, 401, {
      ok: false,
      code: "INVALID_SYNC_KEY",
      message: "Sync key is incorrect."
    });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    state: shapeResponseState(record),
    meta: {
      profileId: record.profileId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  });
}

async function handleSaveState(request, response) {
  const body = await readJson(request);
  const profileId = normalizeProfileId(body.profileId);
  const syncKey = assertSyncKey(body.syncKey);
  const payload = sanitizePayload(body.payload);
  const now = new Date().toISOString();
  const { normalized, filePath, record: existingRecord } = await loadProfile(profileId);

  let nextRecord;

  if (!existingRecord) {
    nextRecord = {
      version: 1,
      profileId: normalized,
      secret: hashSecret(syncKey),
      createdAt: now,
      updatedAt: now,
      payload
    };
  } else {
    if (!verifySecret(syncKey, existingRecord.secret)) {
      sendJson(response, 401, {
        ok: false,
        code: "INVALID_SYNC_KEY",
        message: "Sync key is incorrect."
      });
      return;
    }

    nextRecord = {
      ...existingRecord,
      profileId: normalized,
      updatedAt: now,
      payload
    };
  }

  await writeProfile(filePath, nextRecord);

  sendJson(response, 200, {
    ok: true,
    state: shapeResponseState(nextRecord),
    meta: {
      profileId: nextRecord.profileId,
      createdAt: nextRecord.createdAt,
      updatedAt: nextRecord.updatedAt
    }
  });
}

function resolveStaticPath(requestPath) {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const decoded = decodeURIComponent(cleanPath);
  const relativePath = decoded.replace(/^\/+/, "").replace(/\\/g, "/");

  if (!relativePath) {
    return null;
  }

  if (!(publicRootFiles.has(relativePath) || relativePath.startsWith("img/"))) {
    return null;
  }

  const resolved = path.normalize(path.join(projectRoot, relativePath));

  if (!resolved.startsWith(projectRoot)) {
    return null;
  }

  return resolved;
}

async function serveStatic(requestPath, response) {
  const filePath = resolveStaticPath(requestPath);

  if (!filePath) {
    sendText(response, 400, "Bad request.");
    return;
  }

  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      sendText(response, 404, "Not found.");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] ?? "application/octet-stream";
    const body = await readFile(filePath);

    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": body.length
    });
    response.end(body);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      sendText(response, 404, "Not found.");
      return;
    }

    console.error("Static file error:", error);
    sendText(response, 500, "Unable to serve file.");
  }
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const { pathname } = requestUrl;

  if (request.method === "OPTIONS") {
    setCorsHeaders(response);
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        dataDir,
        now: new Date().toISOString()
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/state/load") {
      await handleLoadState(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/state/save") {
      await handleSaveState(request, response);
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(response, 404, {
        ok: false,
        code: "NOT_FOUND",
        message: "Unknown API route."
      });
      return;
    }

    await serveStatic(pathname, response);
  } catch (error) {
    console.error("Request error:", error);
    sendJson(response, 400, {
      ok: false,
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Request failed."
    });
  }
}

const server = createServer(handleRequest);

server.listen(port, () => {
  const servingStatic = existsSync(path.join(projectRoot, "index.html"));
  console.log(
    `Roadmap server listening on http://localhost:${port} (${servingStatic ? "static + api" : "api only"})`
  );
  console.log(`Persistent data directory: ${dataDir}`);
});

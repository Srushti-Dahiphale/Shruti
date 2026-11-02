import http from "http";
import { readFileSync, existsSync, statSync, createReadStream } from "fs";
import { join, extname, dirname } from "path";
import { fileURLToPath } from "url";
import explainHandler from "./api/explain.js";
import medlensHandler from "./api/medlens.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file
function loadEnv() {
  const envPath = join(__dirname, ".env");
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!(key in process.env)) {
            process.env[key] = val;
          }
        }
      }
    } catch (_) {}
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function createResShim(res) {
  let statusCode = 200;
  const shim = {
    status(code) {
      statusCode = code;
      return shim;
    },
    json(data) {
      const body = JSON.stringify(data);
      res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Access-Control-Allow-Origin": "*"
      });
      res.end(body);
    },
    send(text) {
      res.writeHead(statusCode, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": Buffer.byteLength(text),
        "Access-Control-Allow-Origin": "*"
      });
      res.end(text);
    }
  };
  return shim;
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // API Endpoints
  if (pathname === "/api/explain" || pathname === "/api/medlens") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }

    let rawBody = "";
    req.on("data", chunk => { rawBody += chunk; });
    req.on("end", async () => {
      try {
        req.body = rawBody ? JSON.parse(rawBody) : {};
      } catch (_) {
        req.body = {};
      }

      const resShim = createResShim(res);
      try {
        if (pathname === "/api/explain") {
          await explainHandler(req, resShim);
        } else {
          await medlensHandler(req, resShim);
        }
      } catch (err) {
        console.error(`[API Error] ${pathname}:`, err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || "Internal Server Error" }));
        }
      }
    });
    return;
  }

  // Static files from public/
  let filePath = pathname === "/" ? join(PUBLIC_DIR, "index.html") : join(PUBLIC_DIR, pathname);
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    createReadStream(filePath).pipe(res);
    return;
  }

  // Fallback to index.html for SPA routes
  const fallback = join(PUBLIC_DIR, "index.html");
  if (existsSync(fallback)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    createReadStream(fallback).pipe(res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`\n==============================================`);
  console.log(` Sahayak Prototype Server running on:`);
  console.log(` http://localhost:${PORT}`);
  console.log(` Free LLM Pool: ${process.env.FREELLMPOOL_BASE_URL || "http://127.0.0.1:8080/v1"}`);
  console.log(` Model: ${process.env.FREELLMPOOL_MODEL || "auto"}`);
  console.log(`==============================================\n`);
});


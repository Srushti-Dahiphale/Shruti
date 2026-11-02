import { readFileSync, existsSync } from "fs";
import { join } from "path";

// 1. Auto-load .env if environment variables are not already set
function loadEnv() {
  const envPath = join(process.cwd(), ".env");
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

// 2. Configuration resolution with Free LLM Pool as default/fallback
const BASE_URL = (
  process.env.FREELLMPOOL_BASE_URL ||
  process.env.LLM_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  (process.env.ANTHROPIC_BASE_URL ? process.env.ANTHROPIC_BASE_URL : (
    process.env.ANTHROPIC_API_KEY && !process.env.FREELLMPOOL_API_KEY
      ? "https://api.anthropic.com/v1"
      : "http://127.0.0.1:8080/v1"
  ))
).replace(/\/+$/, "");

const API_KEY =
  process.env.FREELLMPOOL_API_KEY ||
  process.env.LLM_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  "";

const MODEL =
  process.env.FREELLMPOOL_MODEL ||
  process.env.LLM_MODEL ||
  process.env.OPENAI_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  "auto";

export async function ask(system, content, max = 1500) {
  const isAnthropic = BASE_URL.includes("anthropic.com") || BASE_URL.endsWith("/messages");

  if (isAnthropic) {
    const url = BASE_URL.endsWith("/messages") ? BASE_URL : `${BASE_URL}/messages`;
    const anthropicContent = Array.isArray(content)
      ? content.map(item => {
          if (item && item.type === "image_url" && item.image_url?.url) {
            const match = item.image_url.url.match(/^data:(image\/[a-zA-Z0-9.-]+);base64,(.+)$/);
            return {
              type: "image",
              source: {
                type: "base64",
                media_type: match ? match[1] : "image/jpeg",
                data: match ? match[2] : item.image_url.url
              }
            };
          }
          return item;
        })
      : content;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL === "auto" ? "claude-sonnet-4-6" : MODEL,
        max_tokens: max,
        system,
        messages: [{ role: "user", content: anthropicContent }]
      })
    });

    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(d.error?.message || d.message || `Anthropic request failed (HTTP ${r.status})`);
    }
    return Array.isArray(d.content) ? d.content.map(c => c.text || "").join("") : (d.text || "");
  }

  // OpenAI-compatible / Free LLM Pool path
  const url = BASE_URL.endsWith("/chat/completions") ? BASE_URL : `${BASE_URL}/chat/completions`;
  const headers = { "content-type": "application/json" };
  if (API_KEY) {
    headers["Authorization"] = `Bearer ${API_KEY}`;
    headers["x-api-key"] = API_KEY;
  }

  const openAiContent = Array.isArray(content)
    ? content.map(item => {
        if (item && item.type === "image" && item.source?.data) {
          const mediaType = item.source.media_type || "image/jpeg";
          return {
            type: "image_url",
            image_url: { url: `data:${mediaType};base64,${item.source.data}` }
          };
        }
        return item;
      })
    : content;

  const messages = [];
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: openAiContent });

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: MODEL,
      max_tokens: max,
      messages
    })
  });

  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d.error?.message || (typeof d.error === "string" ? d.error : null) || d.message || `Free LLM Pool request failed (HTTP ${r.status})`;
    throw new Error(msg);
  }

  if (d.choices && d.choices[0]?.message) {
    const c = d.choices[0].message.content;
    return typeof c === "string" ? c : JSON.stringify(c);
  }
  if (Array.isArray(d.content)) {
    return d.content.map(c => c.text || "").join("");
  }
  if (typeof d.text === "string") {
    return d.text;
  }
  throw new Error("Unrecognized response format from LLM API: " + JSON.stringify(d));
}

export function parseJSON(t) {
  if (typeof t !== "string") return t;
  const cleaned = t.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, "$1").trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  const objMatch = cleaned.match(/(\{[\s\S]*\})/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[1]);
    } catch (_) {}
  }

  const arrMatch = cleaned.match(/(\[[\s\S]*\])/);
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[1]);
    } catch (_) {}
  }

  return JSON.parse(t);
}

export const img = b64 => {
  const clean = (b64 || "").replace(/^data:image\/[a-zA-Z0-9.-]+;base64,/, "");
  return {
    type: "image_url",
    image_url: { url: `data:image/jpeg;base64,${clean}` },
    source: { type: "base64", media_type: "image/jpeg", data: clean }
  };
};

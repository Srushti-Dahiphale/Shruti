import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ask, parseJSON, img } from "./_claude.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadDb() {
  const candidates = [
    join(process.cwd(), "data", "janaushadhi.json"),
    join(__dirname, "..", "data", "janaushadhi.json"),
    join(__dirname, "data", "janaushadhi.json")
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf8"));
      } catch (_) {}
    }
  }
  return [];
}

const db = loadDb();
const tok = s => (s || "").toLowerCase()
  .replace(/(\d)\s*(mg|mcg|µg|ug|ml|gm|g|iu)\b/g, "$1")
  .replace(/\b(mg|mcg|ml|gm|iu)\b/g, " ")
  .replace(/[^a-z0-9.]+/g, " ")
  .split(" ")
  .filter(w => w.length > 1 && !["tablets","tablet","tabs","tab","ip","capsules","caps","film","coated","inj","injection"].includes(w));

const lev = (a, b) => {
  const m = [...Array(a.length + 1)].map((_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(m[i-1][j] + 1, m[i][j-1] + 1, m[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    }
  }
  return m[a.length][b.length];
};

const index = db.map(m => ({ m, t: tok(m.name) }));

function score(q, t) {
  let s = 0;
  for (const w of q) {
    if (t.includes(w)) {
      s += /\d/.test(w) ? 2 : 3;
      continue;
    }
    if (w.length > 4 && t.some(x => x.length > 4 && lev(w, x) <= 2)) {
      s += 3;
    }
  }
  return s - 0.15 * Math.max(0, t.length - q.length);
}

export default async function handler(req, res) {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) {}
    }
    let { image, name, paid } = body || {};

    if (image) {
      const prompt = 'Read the medicine name (generic/salt name preferred) and strength from this strip or box. Return ONLY JSON {"name":"..."}';
      const raw = await ask(prompt, [img(image), { type: "text", text: "Which medicine is this?" }], 200);
      const parsed = parseJSON(raw) || {};
      name = parsed.name || parsed.medicine || parsed.medicine_name || name;
    }

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "No medicine name could be identified" });
    }

    const q = tok(name);
    const ranked = index
      .map(({ m, t }) => ({ m, s: score(q, t) }))
      .filter(x => x.s >= 3)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3);

    const p = Number(paid) || null;
    res.json({
      read_name: name,
      paid: p,
      matches: ranked.map(({ m }) => ({
        ...m,
        difference: p ? +(p - m.price).toFixed(2) : null
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "An unexpected error occurred" });
  }
}

import { ask, parseJSON, img } from "./_claude.js";

const SYS = (lang) => `You help people with limited reading fluency understand paperwork. Read the photographed document.
Return ONLY JSON: {"quality_ok":bool,"quality_reason":"plain reason in ${lang} if photo is blurry/glared/cut off","doc_type":"form|bill_notice|prescription|other",
"original_text":"the visible text, as read","summary":"max 5 short sentences in ${lang}: what it is, what is asked, deadline or amount",
"steps":[{"text":"one short sentence in ${lang}","deadline":"date as printed or null"}] (3 to 6 steps),
"facts":[{"label":"amount|deadline|name|action","value":"...","source_quote":"exact text from the document"}],
"low_confidence":["values you are unsure of"]}
Rules: never invent amounts, dates or names not visible. If unsure write "I cannot tell". Use plain, common words. No medical, legal or financial advice. Never ask for PIN or OTP.`;

export default async function handler(req, res) {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) {}
    }
    const { image, lang = "Hindi" } = body || {};
    if (!image) return res.status(400).json({ error: "No image provided" });

    const raw = await ask(SYS(lang), [img(image), { type: "text", text: "Analyse this document." }], 2000);
    const out = parseJSON(raw) || {};

    if (typeof out.quality_ok === "undefined") out.quality_ok = true;
    out.quality_reason = out.quality_reason || "";
    out.doc_type = out.doc_type || "other";
    out.original_text = out.original_text || "";
    out.summary = out.summary || "";
    out.steps = Array.isArray(out.steps) ? out.steps : [];
    out.facts = Array.isArray(out.facts) ? out.facts : [];
    out.low_confidence = Array.isArray(out.low_confidence) ? out.low_confidence : [];

    out.facts = out.facts.filter(
      f => f && typeof f.source_quote === "string" && (out.original_text || "").includes(f.source_quote.slice(0, 12))
    );

    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message || "An unexpected error occurred" });
  }
}

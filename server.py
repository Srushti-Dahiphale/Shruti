#!/usr/bin/env python3
"""
Sahayak Prototype Dev Server (Python)
Zero-dependency HTTP server that serves public/ static files and handles /api/explain and /api/medlens.
Can be executed directly via:
    ./freellmpool-venv/bin/python server.py
"""

import http.server
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
DATA_FILE = ROOT / "data" / "janaushadhi.json"


def load_env():
    env_file = ROOT / ".env"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k not in os.environ:
                    os.environ[k] = v


load_env()

PORT = int(os.environ.get("PORT", "3000"))
BASE_URL = os.environ.get("FREELLMPOOL_BASE_URL", "http://127.0.0.1:8080/v1").rstrip("/")
API_KEY = os.environ.get("FREELLMPOOL_API_KEY", "")
MODEL = os.environ.get("FREELLMPOOL_MODEL", "auto")


def load_medicines():
    if DATA_FILE.exists():
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


DB = load_medicines()

STOP_WORDS = {
    "tablets", "tablet", "tabs", "tab", "ip", "capsules", "caps",
    "film", "coated", "inj", "injection"
}


def tok(s):
    s = (s or "").lower()
    s = re.sub(r"(\d)\s*(mg|mcg|µg|ug|ml|gm|g|iu)\b", r"\1", s)
    s = re.sub(r"\b(mg|mcg|ml|gm|iu)\b", " ", s)
    s = re.sub(r"[^a-z0-9.]+", " ", s)
    return [w for w in s.split() if len(w) > 1 and w not in STOP_WORDS]


def lev(a, b):
    m = [[i] for i in range(len(a) + 1)]
    for j in range(1, len(b) + 1):
        m[0].append(j)
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            m[i].append(min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost))
    return m[len(a)][len(b)]


INDEX = [{"m": m, "t": tok(m.get("name", ""))} for m in DB]


def score_query(q, t):
    s = 0.0
    for w in q:
        if w in t:
            s += 2.0 if re.search(r"\d", w) else 3.0
            continue
        if len(w) > 4 and any(len(x) > 4 and lev(w, x) <= 2 for x in t):
            s += 3.0
    return s - 0.15 * max(0, len(t) - len(q))


def parse_json(text):
    if not isinstance(text, str):
        return text
    cleaned = re.sub(r"```(?:json)?\s*([\s\S]*?)\s*```", r"\1", text).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        pass

    obj_m = re.search(r"(\{[\s\S]*\})", cleaned)
    if obj_m:
        try:
            return json.loads(obj_m.group(1))
        except Exception:
            pass

    arr_m = re.search(r"(\[[\s\S]*\])", cleaned)
    if arr_m:
        try:
            return json.loads(arr_m.group(1))
        except Exception:
            pass

    return json.loads(text)


def ask_llm(system_prompt, content_items, max_tokens=1500):
    url = BASE_URL if BASE_URL.endswith("/chat/completions") else f"{BASE_URL}/chat/completions"
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": content_items})

    payload = json.dumps({
        "model": MODEL,
        "max_tokens": max_tokens,
        "messages": messages
    }).encode("utf-8")

    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
        headers["x-api-key"] = API_KEY

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            choices = data.get("choices", [])
            if choices and "message" in choices[0]:
                content = choices[0]["message"].get("content", "")
                return content if isinstance(content, str) else json.dumps(content)
            if "content" in data and isinstance(data["content"], list):
                return "".join(c.get("text", "") for c in data["content"])
            return data.get("text", "")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            err_json = json.loads(err_body)
            msg = err_json.get("error", {}).get("message") or err_json.get("message") or err_body
        except Exception:
            msg = err_body or str(e)
        raise RuntimeError(f"LLM API Error (HTTP {e.code}): {msg}")
    except urllib.error.URLError as e:
        raise RuntimeError(
            f"Could not connect to Free LLM Pool at {BASE_URL}. "
            f"Make sure 'freellmpool proxy' is running on port 8080! ({e.reason})"
        )


SYS_EXPLAIN = lambda lang: f"""You help people with limited reading fluency understand paperwork. Read the photographed document.
Return ONLY JSON: {{"quality_ok":bool,"quality_reason":"plain reason in {lang} if photo is blurry/glared/cut off","doc_type":"form|bill_notice|prescription|other",
"original_text":"the visible text, as read","summary":"max 5 short sentences in {lang}: what it is, what is asked, deadline or amount",
"steps":[{{"text":"one short sentence in {lang}","deadline":"date as printed or null"}}] (3 to 6 steps),
"facts":[{{"label":"amount|deadline|name|action","value":"...","source_quote":"exact text from the document"}}],
"low_confidence":["values you are unsure of"]}}
Rules: never invent amounts, dates or names not visible. If unsure write "I cannot tell". Use plain, common words. No medical, legal or financial advice. Never ask for PIN or OTP."""


class PrototypeHandler(http.server.BaseHTTPRequestHandler):
    def send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        req_path = self.path.split("?")[0]
        if req_path in ("/", ""):
            file_path = PUBLIC_DIR / "index.html"
        else:
            rel = req_path.lstrip("/")
            file_path = PUBLIC_DIR / rel

        if file_path.is_file():
            mime, _ = mimetypes.guess_type(str(file_path))
            mime = mime or "application/octet-stream"
            content = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", f"{mime}; charset=utf-8" if "text" in mime or "json" in mime or "javascript" in mime else mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_cors()
            self.end_headers()
            self.wfile.write(content)
        else:
            # Fallback to index.html
            idx = PUBLIC_DIR / "index.html"
            if idx.is_file():
                content = idx.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(content)
            else:
                self.send_response(404)
                self.end_headers()

    def do_POST(self):
        req_path = self.path.split("?")[0]
        if req_path not in ("/api/explain", "/api/medlens", "/api/chat"):
            self.send_response(404)
            self.send_cors()
            self.end_headers()
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(length).decode("utf-8") if length else "{}"
            body = json.loads(raw_body)
        except Exception as e:
            self.send_json(400, {"error": f"Invalid JSON body: {str(e)}"})
            return

        try:
            if req_path == "/api/explain":
                self.handle_explain(body)
            elif req_path == "/api/medlens":
                self.handle_medlens(body)
            elif req_path == "/api/chat":
                self.handle_chat(body)
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def handle_explain(self, body):
        image = body.get("image")
        lang = body.get("lang", "Hindi")
        if not image:
            self.send_json(400, {"error": "No image provided"})
            return

        clean_img = re.sub(r"^data:image/[a-zA-Z0-9.-]+;base64,", "", image)
        content_items = [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{clean_img}"}},
            {"type": "text", "text": "Analyse this document."}
        ]

        raw = ask_llm(SYS_EXPLAIN(lang), content_items, max_tokens=2000)
        out = parse_json(raw) or {}
        if not isinstance(out, dict):
            out = {"summary": str(out), "quality_ok": True}

        if "quality_ok" not in out:
            out["quality_ok"] = True
        out["quality_reason"] = out.get("quality_reason", "")
        out["doc_type"] = out.get("doc_type", "other")
        out["original_text"] = out.get("original_text", "")
        out["summary"] = out.get("summary", "")
        out["steps"] = out.get("steps") if isinstance(out.get("steps"), list) else []
        out["facts"] = out.get("facts") if isinstance(out.get("facts"), list) else []
        out["low_confidence"] = out.get("low_confidence") if isinstance(out.get("low_confidence"), list) else []

        orig = out.get("original_text", "")
        out["facts"] = [
            f for f in out["facts"]
            if isinstance(f, dict) and isinstance(f.get("source_quote"), str) and f["source_quote"][:12] in orig
        ]

        self.send_json(200, out)

    def handle_medlens(self, body):
        image = body.get("image")
        name = body.get("name")
        paid = body.get("paid")

        if image:
            clean_img = re.sub(r"^data:image/[a-zA-Z0-9.-]+;base64,", "", image)
            content_items = [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{clean_img}"}},
                {"type": "text", "text": "Which medicine is this?"}
            ]
            prompt = 'Read the medicine name (generic/salt name preferred) and strength from this strip or box. Return ONLY JSON {"name":"..."}'
            raw = ask_llm(prompt, content_items, max_tokens=200)
            parsed = parse_json(raw)
            if isinstance(parsed, dict):
                name = parsed.get("name") or parsed.get("medicine") or parsed.get("medicine_name") or name

        if not name or not str(name).strip():
            self.send_json(400, {"error": "No medicine name could be identified"})
            return

        name = str(name).strip()
        q = tok(name)
        ranked = [
            item for item in ({"m": x["m"], "s": score_query(q, x["t"])} for x in INDEX)
            if item["s"] >= 3
        ]
        ranked.sort(key=lambda x: x["s"], reverse=True)
        top3 = ranked[:3]

        p = None
        if paid is not None and str(paid).strip() != "":
            try:
                p = float(paid)
            except ValueError:
                pass

        matches = []
        for item in top3:
            m = dict(item["m"])
            price = m.get("price", 0)
            m["difference"] = round(p - price, 2) if p is not None else None
            matches.append(m)

        self.send_json(200, {
            "read_name": name,
            "paid": p,
            "matches": matches
        })

    def handle_chat(self, body):
        message = (body.get("message") or "").strip()
        history = body.get("history") or []
        lang = body.get("lang", "Hindi")
        if not message:
            self.send_json(400, {"error": "No message provided"})
            return
        system_prompt = (
            f"You are Sahayak, a helpful AI assistant for people in India with limited reading fluency. "
            f"Answer in {lang} using simple, everyday words. "
            f"You help with understanding government forms, bills, prescriptions, and everyday questions. "
            f"NEVER ask for PIN, OTP, passwords or sensitive banking details. "
            f"If asked about medical, legal or financial matters, give general guidance and suggest consulting a professional. "
            f"Keep answers short (3-5 sentences max) and warm in tone."
        )
        messages = [{"role": "system", "content": system_prompt}]
        for h in history[-6:]:
            messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})
        messages.append({"role": "user", "content": message})

        url = BASE_URL if BASE_URL.endswith("/chat/completions") else f"{BASE_URL}/chat/completions"
        payload = json.dumps({"model": MODEL, "max_tokens": 600, "messages": messages}).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if API_KEY:
            headers["Authorization"] = f"Bearer {API_KEY}"
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            self.send_json(200, {"reply": reply.strip()})
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_cors()
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        # Concise logging
        sys.stderr.write(f"[{self.log_date_time_string()}] {self.command} {self.path} - {args[1]}\n")


def run():
    server_address = ("127.0.0.1", PORT)
    httpd = http.server.ThreadingHTTPServer(server_address, PrototypeHandler)
    print("\n" + "=" * 55)
    print(" Sahayak Prototype Server running on:")
    print(f" http://localhost:{PORT}")
    print(f" Free LLM Pool: {BASE_URL}")
    print(f" Model: {MODEL}")
    print("=" * 55 + "\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()


if __name__ == "__main__":
    run()


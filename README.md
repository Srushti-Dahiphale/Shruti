# Shruti (Prototype)

Scan → Understand → Act. Helps users understand paperwork and check medicine prices against the Jan Aushadhi (PMBJP) generic database.

- **Frontend**: Lightweight mobile-first UI in `public/index.html` (multilingual Hindi/English, voice TTS, high contrast, photo compression).
- **Backend**:
  - Paperwork comprehension & step extractor (`/api/explain`)
  - Generic medicine price matcher & OCR scanner (`/api/medlens`)
- **Dataset**: `data/janaushadhi.json` holds 580 PMBJP generic medicines.
- **LLM Provider**: Compatible with **Free LLM Pool** (`freellmpool`), standard OpenAI-compatible endpoints, and Anthropic.

---

# Deployed on Vercel

https://shruti-teal.vercel.app/

---
## Quickstart in Antigravity IDE

### 1. Configure Environment (`.env`)

Copy `.env.example` to `.env` (or update existing `.env`):

```bash
# Point to your local freellmpool proxy or any OpenAI-compatible free LLM endpoint
FREELLMPOOL_BASE_URL=http://127.0.0.1:8080/v1
FREELLMPOOL_API_KEY=
FREELLMPOOL_MODEL=auto
```

*(If you set a proxy key on `freellmpool`, put it in `FREELLMPOOL_API_KEY`.)*

---

### 2. Run the Prototype

#### Option A: Python Server (Ready immediately with included venv)
No Node or Vercel required! You can run the Free LLM Pool proxy and web server side-by-side:

**Terminal 1 (Start Free LLM Pool Proxy):**
```bash
./freellmpool-venv/bin/freellmpool proxy
```

**Terminal 2 (Start Prototype Server):**
```bash
./freellmpool-venv/bin/python server.py
```

Open **http://localhost:3000** in your browser.

---

#### Option B: Node.js (Zero-dependency standalone server)
If Node.js is installed on your machine (`node -v` >= 18):

**Terminal 1:**
```bash
./freellmpool-venv/bin/freellmpool proxy
```

**Terminal 2:**
```bash
npm start
# or: node server.js
```

Open **http://localhost:3000** in your browser.

---

#### Option C: Vercel Dev CLI
If you have Vercel CLI installed:
```bash
vercel dev
```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `FREELLMPOOL_BASE_URL` | Free LLM Pool or OpenAI-compatible endpoint | `http://127.0.0.1:8080/v1` |
| `FREELLMPOOL_API_KEY` | Proxy Bearer key or provider API key | `""` |
| `FREELLMPOOL_MODEL` | Model routing preference | `auto` |
| `ANTHROPIC_API_KEY` | Fallback Anthropic API key | `""` |
| `ANTHROPIC_MODEL` | Fallback Anthropic model | `claude-sonnet-4-6` |

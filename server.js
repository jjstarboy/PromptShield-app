import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

// ---- Provider setup: anthropic (paid key), gemini or groq (free tiers), or any OpenAI-compatible service ----
const PROVIDER = (process.env.PROVIDER || 'anthropic').toLowerCase();
const PRESETS = {
  anthropic: { kind: 'anthropic', url: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages',
    key: process.env.ANTHROPIC_API_KEY, quick: 'claude-haiku-4-5-20251001', def: 'claude-sonnet-5-5', gap: 0 },
  gemini: { kind: 'openai', url: (process.env.LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, '') + '/chat/completions',
    key: process.env.GEMINI_API_KEY || process.env.LLM_API_KEY, quick: 'gemini-2.5-flash-lite', def: 'gemini-2.5-flash', gap: 5000, toolName: true },
  groq: { kind: 'openai', url: (process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '') + '/chat/completions',
    key: process.env.GROQ_API_KEY || process.env.LLM_API_KEY, quick: 'llama-3.3-70b-versatile', def: 'llama-3.3-70b-versatile', gap: 2500 },
  'openai-compatible': { kind: 'openai', url: (process.env.LLM_BASE_URL || '').replace(/\/+$/, '') + '/chat/completions',
    key: process.env.LLM_API_KEY, quick: '', def: '', gap: 3000 },
};
const CFG = PRESETS[PROVIDER];
if (!CFG) { console.error('Unknown PROVIDER. Use anthropic, gemini, groq or openai-compatible.'); process.exit(1); }
const KEY = (CFG.key || '').trim();
const CODE = process.env.APP_PASSWORD || '';
const PORT = process.env.PORT || 3000;
const RATE = Number(process.env.RATE_LIMIT) || 120;          // calls per person per 10 minutes
const DAILY = Number(process.env.DAILY_CAP) || 3000;         // calls per day for the whole app
const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS) || 60000;
const GAP = process.env.MIN_INTERVAL_MS != null ? Number(process.env.MIN_INTERVAL_MS) : CFG.gap;  // spacing between AI calls (free tiers have per-minute limits)
const MODELS = Object.freeze({
  quick: process.env.MODEL_QUICK || CFG.quick,
  default: process.env.MODEL_DEFAULT || CFG.def,
  complex: process.env.MODEL_DEFAULT || CFG.def,
});

if (!CODE && process.env.ALLOW_NO_PASSWORD !== '1') {
  console.error('Refusing to start: set APP_PASSWORD so strangers cannot use your AI quota. (For local tests only: ALLOW_NO_PASSWORD=1)');
  process.exit(1);
}
if (!KEY) console.error('Warning: no API key is set for provider "' + PROVIDER + '". AI calls will fail.');
if (!MODELS.quick || !MODELS.default) console.error('Warning: set MODEL_QUICK and MODEL_DEFAULT for provider "' + PROVIDER + '".');

// ---- Format translation (the web page speaks one format; providers differ) ----
function toOpenAI(messages, tools, model) {
  const out = [], names = {};
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    if (m.role === 'assistant') {
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const calls = m.content.filter(b => b.type === 'tool_use').map(b => { names[b.id] = b.name; return { id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }; });
      const msg = { role: 'assistant', content: text || null };
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
    } else {
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          const t = { role: 'tool', tool_call_id: b.tool_use_id, content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) };
          if (CFG.toolName && names[b.tool_use_id]) t.name = names[b.tool_use_id];
          out.push(t);
        } else if (b.type === 'text') out.push({ role: 'user', content: b.text });
      }
    }
  }
  const body = { model, max_tokens: 1024, messages: out };
  if (tools && tools.length) body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: String(t.description || ''), parameters: t.input_schema || { type: 'object', properties: {} } } }));
  return body;
}
function fromOpenAI(d) {
  const m = d?.choices?.[0]?.message || {}, content = [];
  if (m.content) content.push({ type: 'text', text: String(m.content) });
  for (const c of m.tool_calls || []) {
    let input = {}; try { input = JSON.parse(c.function?.arguments || '{}'); } catch { /* ignore */ }
    content.push({ type: 'tool_use', id: c.id || 'call_' + content.length, name: c.function?.name, input });
  }
  return { content, stop_reason: (m.tool_calls && m.tool_calls.length) ? 'tool_use' : 'end_turn' };
}

// Space out AI calls so free per-minute limits are not hit
let nextSlot = 0;
const slot = async () => { const now = Date.now(), t = Math.max(now, nextSlot); nextSlot = t + GAP; if (t > now) await new Promise(r => setTimeout(r, t - now)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function upstream(messages, tools, tier, maxTokens = 1024) {
  const model = Object.hasOwn(MODELS, tier) ? MODELS[tier] : MODELS.default;
  const headers = { 'content-type': 'application/json' };
  let body;
  if (CFG.kind === 'anthropic') {
    headers['x-api-key'] = KEY; headers['anthropic-version'] = '2023-06-01';
    body = { model, max_tokens: maxTokens, messages };
    if (tools && tools.length) body.tools = tools.map(t => ({ name: t.name, description: String(t.description || ''), input_schema: t.input_schema || { type: 'object', properties: {} } }));
  } else {
    headers.authorization = 'Bearer ' + KEY;
    body = toOpenAI(messages, tools, model); body.max_tokens = maxTokens;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    await slot();
    const r = await fetch(CFG.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return CFG.kind === 'anthropic' ? { content: d.content, stop_reason: d.stop_reason } : fromOpenAI(d);
    if (r.status === 429 && attempt === 0 && CFG.kind !== 'anthropic') { await sleep(Number(process.env.RETRY_WAIT_MS) || 15000); continue; }
    const e = new Error('upstream'); e.status = r.status; e.msg = String(d?.error?.message || d?.[0]?.error?.message || ''); throw e;
  }
}
const reasonOf = e => {
  if (!e.status) return 'unreachable';
  const m = (e.msg || '').toLowerCase();
  if (/credit balance|billing/.test(m)) return 'no_credits';
  if (e.status === 401 || e.status === 403 || /api key (not valid|invalid)|invalid.*api.?key|incorrect api key/.test(m)) return 'key_invalid';
  if (e.status === 404) return 'model_unavailable';
  if (e.status === 429) return 'rate_limited';
  return 'upstream_error';
};

// ---- Web server ----
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json({ limit: '512kb' }));

const same = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const calls = new Map(), fails = new Map();
const hit = (map, key, windowMs, max) => { const now = Date.now(), a = (map.get(key) || []).filter(t => now - t < windowMs); a.push(now); map.set(key, a); return a.length > max; };
setInterval(() => { const now = Date.now(); for (const m of [calls, fails]) for (const [k, a] of m) if (!a.length || now - a[a.length - 1] > 600000) m.delete(k); }, 60000).unref();
const blockedIp = ip => (fails.get(ip) || []).filter(t => Date.now() - t < 600000).length >= 10;
let day = new Date().toDateString(), today = 0;

app.get('/api/config', (req, res) => res.json({ needsCode: !!CODE }));

const BLOCKS = new Set(['text', 'tool_use', 'tool_result']);
const goodMsg = m => m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') &&
  (typeof m.content === 'string' || (Array.isArray(m.content) && m.content.length <= 20 && m.content.every(b => b && BLOCKS.has(b.type))));
const goodTool = t => t && typeof t.name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(t.name) &&
  String(t.description || '').length <= 1000 && (t.input_schema == null || (typeof t.input_schema === 'object' && !Array.isArray(t.input_schema)));

app.post('/api/chat', async (req, res) => {
  if (blockedIp(req.ip)) return res.status(429).json({ error: 'too many attempts' });
  if (CODE && !same(req.get('x-access-code') || '', CODE)) { hit(fails, req.ip, 600000, 10); return res.status(401).json({ error: 'access code required' }); }
  if (hit(calls, req.ip, 600000, RATE)) return res.status(429).json({ error: 'rate limited' });
  if (new Date().toDateString() !== day) { day = new Date().toDateString(); today = 0; }
  if (++today > DAILY) return res.status(429).json({ error: 'daily limit reached' });
  if (!KEY) return res.status(500).json({ error: 'server not configured' });
  const { messages, tools, tier } = req.body || {};
  if (!Array.isArray(messages) || !messages.length || messages.length > 40 || messages[0].role !== 'user' || !messages.every(goodMsg)) return res.status(400).json({ error: 'bad messages' });
  if (tools != null && (!Array.isArray(tools) || tools.length > 8 || !tools.every(goodTool))) return res.status(400).json({ error: 'bad tools' });
  try { res.json(await upstream(messages, tools, tier)); }
  catch (e) { console.error('upstream failure:', e.status || e.name); res.status(e.status === 429 ? 429 : 502).json({ error: 'upstream error' }); }
});

// Connection check: says exactly why AI calls fail, without exposing any secret
app.get('/api/health', async (req, res) => {
  if (blockedIp(req.ip)) return res.status(429).json({ ok: false, reason: 'rate_limited' });
  if (CODE && !same(req.get('x-access-code') || '', CODE)) { hit(fails, req.ip, 600000, 10); return res.status(401).json({ ok: false, reason: 'access_code' }); }
  if (hit(calls, req.ip, 600000, RATE)) return res.status(429).json({ ok: false, reason: 'rate_limited' });
  if (!KEY) return res.json({ ok: false, reason: 'key_missing' });
  if (!MODELS.quick) return res.json({ ok: false, reason: 'model_unavailable' });
  try { await upstream([{ role: 'user', content: 'Reply with OK' }], null, 'quick', 16); res.json({ ok: true, model: MODELS.quick, provider: PROVIDER }); }
  catch (e) { res.json({ ok: false, reason: reasonOf(e) }); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
const dir = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(dir, 'public'), { dotfiles: 'ignore', maxAge: '5m' }));
app.use((err, req, res, next) => res.status(err.status === 413 ? 413 : 400).json({ error: 'bad request' }));
app.listen(PORT, () => console.log('PromptShield running on port ' + PORT + ' (provider: ' + PROVIDER + ')'));

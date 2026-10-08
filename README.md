# PromptShield (standalone app)

An AI chatbot security checkup: prompt-injection tests, a backend access test and a client report.
The browser never sees your API key. The server (`server.js`) calls the AI provider for it.

## Choose an AI provider
- **Free: Groq** (no credit card, email sign-up at console.groq.com/keys). Set `PROVIDER=groq` and `GROQ_API_KEY`. Default model `llama-3.3-70b-versatile`; if it is retired, set `MODEL_QUICK` and `MODEL_DEFAULT` to a model listed at console.groq.com. Check your limits under Limits in the Groq console.
- **Free: Google Gemini.** Get a key from Google AI Studio (aistudio.google.com). Set `PROVIDER=gemini` and `GEMINI_API_KEY`.
  Free tiers have per-minute and per-day limits that Google can change, so a full audit takes a few minutes. Check Google's current limits and data terms before using it for anything beyond synthetic data.
- **Paid: Anthropic Claude.** Set `PROVIDER=anthropic` and `ANTHROPIC_API_KEY` (billing credits required).
- **Any other OpenAI-compatible service:** `PROVIDER=openai-compatible`, `LLM_BASE_URL`, `LLM_API_KEY`, `MODEL_QUICK`, `MODEL_DEFAULT`.
Test results describe how the chosen model behaves, so say which model you used in any report.

## Run on your computer (free)
1. Install Node.js 18 or newer (nodejs.org, LTS version).
2. In this folder run `npm install`.
3. Set the variables and start (Windows PowerShell; use `npm.cmd` if `npm` is blocked):
   `$env:PROVIDER="groq"; $env:GROQ_API_KEY="your-key"; $env:APP_PASSWORD="choose-a-code"; npm start`
   Mac/Linux: `PROVIDER=groq GROQ_API_KEY=your-key APP_PASSWORD=choose-a-code npm start`
   For Gemini use `PROVIDER=gemini` and `GEMINI_API_KEY` instead.
4. Open http://localhost:3000, enter the access code, scroll down and click **Check AI connection**.

## Share it from your computer for free
Install ngrok (free account), keep the app running, then run `ngrok http 3000`. Share the https link it prints and the access code. The app works only while your computer and both programs stay on.

## Deploy to a host
Services such as Render offer free plans (check current terms; free apps sleep when idle). Put this folder in a GitHub repository, create a Web Service, build command `npm install`, start command `npm start`, and add the same variables under Environment.

## Check the AI connection
The **Check AI connection** button says whether the AI is reachable, or exactly what to fix: missing key, rejected key, no credits, unavailable model, or wrong access code.

## Built-in protections
- The server refuses to start without `APP_PASSWORD`.
- Wrong access codes are limited (10 failures per 10 minutes per person), then blocked.
- `RATE_LIMIT` caps calls per person and `DAILY_CAP` caps calls per day for the whole app.
- Calls are spaced out (`MIN_INTERVAL_MS`) and retried once on a rate limit, to suit free tiers.
- Requests are validated, with fixed models, fixed output size and a request timeout.
- Security headers include a strict Content-Security-Policy.

## Things to know
- Prompts typed into the app pass through your server to the AI provider. Use synthetic data only.
- Test history is saved in each user's own browser. Secrets are masked before saving.
- Replies appear when complete instead of streaming.
- Use only on chatbots you own or are authorized to test.

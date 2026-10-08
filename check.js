(function () {
  const b = document.getElementById('chk'), o = document.getElementById('chk-out');
  const M = {
    key_missing: 'The server has no API key. Add it in your hosting settings (or in the command) and restart.',
    key_invalid: 'The API key was rejected. Create a new key with your provider and update it.',
    no_credits: 'The AI account has no credits or billing set up. Check your provider account.',
    model_unavailable: 'That model name is not available. Set MODEL_QUICK and MODEL_DEFAULT to model names your provider lists.',
    rate_limited: 'Too many requests. Wait a minute and try again.',
    unreachable: 'The server could not reach the AI provider. Check the internet connection and try again.',
    upstream_error: 'The AI provider returned an error. Try again shortly.',
    access_code: 'Wrong access code. Click the button again and re-enter it.',
  };
  b.onclick = async () => {
    o.textContent = 'Checking…'; b.disabled = true;
    try {
      const c = await (await fetch('/api/config')).json();
      let code = sessionStorage.getItem('ps_code') || '';
      if (c.needsCode && !code) { code = prompt('Enter the access code') || ''; if (code) sessionStorage.setItem('ps_code', code); }
      const r = await fetch('/api/health', { headers: { 'x-access-code': code } });
      const d = await r.json().catch(() => ({}));
      if (d.ok) o.textContent = '✅ Connected (' + d.provider + ', model ' + d.model + '). Tests will run.';
      else { o.textContent = '❌ ' + (M[d.reason] || 'Connection failed.'); if (d.reason === 'access_code') sessionStorage.removeItem('ps_code'); }
    } catch (e) { o.textContent = '❌ Could not reach the server. Is it running?'; }
    b.disabled = false;
  };
})();

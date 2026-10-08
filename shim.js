// Connects the app to this server instead of the claude.ai artifact runtime.
(function () {
  const code = () => sessionStorage.getItem('ps_code') || '';
  async function sample(input, o = {}) {
    const tools = o.tools || [], byName = Object.fromEntries(tools.map(t => [t.name, t]));
    const msgs = [{ role: 'user', content: input }], all = [];
    for (let round = 0; round < 6; round++) {
      let r;
      try {
        r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-access-code': code() },
          body: JSON.stringify({ messages: msgs, tier: o.modelTier || 'default',
            tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } })) }),
        });
      } catch (e) { throw { code: 'upstream_error', message: 'Network error' }; }
      if (r.status === 401) { sessionStorage.removeItem('ps_code'); throw { code: 'not_granted', message: 'Access code required or wrong' }; }
      if (r.status === 429) throw { code: 'rate_limited', message: 'Too many requests' };
      if (!r.ok) throw { code: 'upstream_error', message: 'Server error' };
      const d = await r.json();
      msgs.push({ role: 'assistant', content: d.content });
      const t = d.content.filter(b => b.type === 'text').map(b => b.text).join('');
      if (t) all.push(t);
      const uses = d.content.filter(b => b.type === 'tool_use');
      if (!uses.length || d.stop_reason !== 'tool_use') break;
      const out = [];
      for (const u of uses) {
        let v;
        try { v = await byName[u.name].execute(u.input || {}); } catch (e) { v = { error: 'tool failed' }; }
        out.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(v) });
      }
      msgs.push({ role: 'user', content: out });
    }
    const text = all.join('\n\n');
    if (!text) throw { code: 'empty_completion', message: 'Empty reply' };
    if (o.onText) o.onText({ text });
    return { text };
  }
  sample.limits = async () => ({ tools: true });
  const downloads = { save: async ({ filename, data }) => {
    const u = URL.createObjectURL(data), a = document.createElement('a');
    a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1500);
  } };
  window.claude = { use: async n => {
    if (n === 'downloads') return downloads;
    if (n !== 'sample') return null;
    try {
      const c = await (await fetch('/api/config')).json();
      if (c.needsCode && !code()) { const v = prompt('Enter the access code'); if (v) sessionStorage.setItem('ps_code', v); }
    } catch (e) { return null; }
    return sample;
  } };
})();

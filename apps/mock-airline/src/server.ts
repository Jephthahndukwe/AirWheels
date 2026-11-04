import { createServer } from 'node:http';
import { cancelBooking, changeBooking, flightAlert, getBooking, sendBooking } from './client';

/**
 * Tiny control panel for the mock airline at http://localhost:4100.
 * Buttons trigger the same signed calls as the CLI. Also accepts our webhooks at /webhooks.
 */
const port = Number(process.env.MOCK_AIRLINE_PORT ?? 4100);

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Mock airline</title>
<style>body{font-family:system-ui;max-width:760px;margin:40px auto;color:#14141A}button{background:#FF4D3D;color:#fff;border:0;border-radius:8px;padding:10px 14px;margin:4px;cursor:pointer}input{padding:9px;border:1px solid #ddd;border-radius:8px}pre{background:#F4F5F7;padding:12px;border-radius:8px;overflow:auto}</style></head>
<body><h1>Mock airline</h1><p>Sends signed partner calls to the Airwheels API.</p>
<button onclick="go('booking')">Send new booking</button>
<p><input id="ref" placeholder="Booking reference"> <button onclick="go('get')">Get</button><button onclick="go('change')">Change</button><button onclick="go('cancel')">Cancel</button></p>
<p><button onclick="go('alert','TIME_SHIFTED')">Delay MK101</button><button onclick="go('alert','CANCELLED')">Cancel MK101</button><button onclick="go('alert','LANDED')">MK101 landed</button></p>
<pre id="out">Ready.</pre>
<script>async function go(a,arg){const ref=document.getElementById('ref').value;const r=await fetch('/action/'+a+'?arg='+encodeURIComponent(arg||ref),{method:'POST'});const j=await r.json();if(j.reference)document.getElementById('ref').value=j.reference;document.getElementById('out').textContent=JSON.stringify(j,null,2)}</script>
</body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(page);
    }
    if (req.method === 'POST' && url.pathname === '/webhooks') {
      let body = '';
      for await (const chunk of req) body += chunk;
      console.log('[mock-airline] webhook received', body);
      return json(200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/action/')) {
      const action = url.pathname.split('/')[2];
      const arg = url.searchParams.get('arg') ?? '';
      const result = await {
        booking: () => sendBooking(),
        get: () => getBooking(arg),
        change: () => changeBooking(arg),
        cancel: () => cancelBooking(arg),
        alert: () => flightAlert(arg as 'TIME_SHIFTED'),
      }[action as 'booking']?.();
      return json(result ? 200 : 404, result ?? { error: 'unknown action' });
    }
    json(404, { error: 'not found' });
  } catch (e) {
    json(500, { error: (e as Error).message });
  }
}).listen(port, () => console.log(`[mock-airline] control panel on http://localhost:${port}`));

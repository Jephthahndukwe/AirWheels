'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '@/lib/utils';

type Item = {
  id: string;
  channel: 'WHATSAPP' | 'SMS' | 'VOICE';
  to: string;
  kind: string;
  body: string;
  template?: string;
  buttons?: { payload: string; title: string }[];
  at: string;
};

export function Phone({ to: initial }: { to: string }) {
  const [to, setTo] = useState(initial);
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');
  const [log, setLog] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`${API_URL}/v1/dev/phone/outbox?to=${encodeURIComponent(to)}`);
    if (r.ok) setItems(((await r.json()) as { messages: Item[] }).messages);
  }, [to]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const reply = async (
    channel: 'WHATSAPP' | 'SMS',
    body: { text?: string; buttonPayload?: string; contextId?: string },
  ) => {
    const r = await fetch(`${API_URL}/v1/dev/phone/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, from: to, ...body }),
    });
    const j = (await r.json()) as { replies?: { action: string; intent: string | null }[] };
    setLog(
      r.ok
        ? `Recorded: ${j.replies?.map((x) => `${x.intent ?? 'unclear'} → ${x.action}`).join(', ')}`
        : 'Failed',
    );
    void load();
  };

  return (
    <div className="space-y-4 pb-10">
      <h1 className="text-xl font-bold">Fake phone (development only)</h1>
      <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), void load())}>
        <input
          className="h-10 flex-1 rounded-md border border-border px-3 text-sm"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="+2348012345678"
        />
        <button className="rounded-md bg-ink px-4 text-sm text-white">Open</button>
      </form>
      {log && (
        <p className="rounded-md bg-muted p-2 text-xs" role="status">
          {log}
        </p>
      )}
      <ul className="space-y-3">
        {items.map((m) => (
          <li
            key={m.id}
            className={`rounded-lg p-3 text-sm ${m.channel === 'WHATSAPP' ? 'bg-green-50' : 'bg-white'} border border-border`}
          >
            <p className="mb-1 text-[10px] uppercase text-muted-foreground">
              {m.channel} · {m.kind.toLowerCase()} {m.template ? `· ${m.template}` : ''} ·{' '}
              {new Date(m.at).toLocaleTimeString()}
            </p>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            {m.channel === 'WHATSAPP' && !!m.buttons?.length && (
              <div className="mt-2 grid gap-1">
                {m.buttons.map((b) => (
                  <button
                    key={b.payload}
                    className="rounded-md border border-green-600 bg-white py-2 text-green-700"
                    onClick={() =>
                      reply('WHATSAPP', {
                        buttonPayload: b.payload,
                        text: b.title,
                        contextId: m.id,
                      })
                    }
                  >
                    {b.title}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => (e.preventDefault(), void reply('WHATSAPP', { text }), setText(''))}
      >
        <input
          className="h-10 flex-1 rounded-md border border-border px-3 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a reply (WhatsApp)"
        />
        <button className="rounded-md bg-green-700 px-3 text-sm text-white">Send</button>
        <button
          type="button"
          className="rounded-md bg-ink px-3 text-sm text-white"
          onClick={() => (void reply('SMS', { text }), setText(''))}
        >
          SMS
        </button>
      </form>
    </div>
  );
}

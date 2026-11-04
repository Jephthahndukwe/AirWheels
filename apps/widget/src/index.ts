import { POWERED_BY, type AirlineTheme, resolveTheme, themeToCssVars } from '@airwheels/ui';

/**
 * Airwheels transfer widget (PRD 6.1 option B, CHN-01, CHN-10, CHN-13).
 *
 *   <div id="airwheels-transfer"></div>
 *   <script src="https://cdn.airwheels.ng/airwheels-widget.js"></script>
 *   <script>AirwheelsWidget.mount({ el: '#airwheels-transfer', airline: 'MOCK', onChange: (s) => ... })</script>
 *
 * Rules: renders inside a shadow root so it never touches the airline's styles or DOM, and if
 * anything fails (config, network, our API down) it removes itself so checkout carries on.
 * The full form and the quote call to the airline's checkout come in M5.
 */
export interface MountOptions {
  el: string | HTMLElement;
  airline: string;
  apiUrl?: string;
  /** Called when the traveller adds or removes the transfer. The quote id travels with checkout. */
  onChange?: (state: { added: boolean; quoteId?: string }) => void;
}

interface WidgetConfig {
  serviceName: string;
  theme: AirlineTheme;
  wording: { title?: string; subtitle?: string };
}

const DEFAULT_API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';
const TIMEOUT_MS = 4_000;

export async function mount(opts: MountOptions): Promise<void> {
  const host = typeof opts.el === 'string' ? document.querySelector<HTMLElement>(opts.el) : opts.el;
  if (!host) return;
  try {
    const cfg = await fetchConfig(opts.apiUrl ?? DEFAULT_API, opts.airline);
    render(host, cfg, opts);
  } catch {
    host.remove(); // fail quietly (CHN-10, 19.4)
  }
}

async function fetchConfig(api: string, airline: string): Promise<WidgetConfig> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${api}/v1/widget/config/${encodeURIComponent(airline)}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(String(r.status));
    const body = (await r.json()) as WidgetConfig;
    return { ...body, theme: resolveTheme(body.theme) };
  } finally {
    clearTimeout(timer);
  }
}

function render(host: HTMLElement, cfg: WidgetConfig, opts: MountOptions) {
  const root = host.attachShadow({ mode: 'closed' });
  const vars = Object.entries(themeToCssVars(cfg.theme))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  root.innerHTML = `
    <style>
      :host{all:initial;display:block}
      .card{${vars};font-family:var(--aw-font);color:var(--aw-fg);background:var(--aw-bg);border:1px solid #e5e7eb;border-radius:12px;padding:16px}
      h3{margin:0 0 4px;font-size:16px}
      p{margin:0 0 12px;color:var(--aw-muted);font-size:14px}
      button{background:var(--aw-primary);color:var(--aw-primary-fg);border:0;border-radius:8px;padding:10px 14px;font:600 14px var(--aw-font);cursor:pointer}
      button[aria-pressed="true"]{background:#14141A}
      .pb{margin-top:10px;font-size:11px;color:#6B7280}
    </style>
    <div class="card" role="group" aria-label="${escapeHtml(cfg.serviceName)}">
      <h3>${escapeHtml(cfg.wording.title ?? 'Add airport transfer?')}</h3>
      <p>${escapeHtml(cfg.wording.subtitle ?? `${cfg.serviceName}: a vetted driver at your door and at arrivals.`)}</p>
      <button type="button" aria-pressed="false">Add transfer</button>
      <div class="pb">${POWERED_BY}</div>
    </div>`;
  const btn = root.querySelector('button')!;
  btn.addEventListener('click', () => {
    const added = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(added));
    btn.textContent = added ? 'Transfer added ✓' : 'Add transfer';
    opts.onChange?.({ added });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

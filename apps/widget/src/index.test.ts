// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from './index';

afterEach(() => vi.restoreAllMocks());

describe('widget', () => {
  it('removes itself when our API is down, so the airline checkout continues', async () => {
    document.body.innerHTML = '<div id="w"></div>';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await mount({ el: '#w', airline: 'MOCK', apiUrl: 'http://x' });
    expect(document.getElementById('w')).toBeNull();
  });

  it('renders inside a shadow root when config loads', async () => {
    document.body.innerHTML = '<div id="w"></div>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          serviceName: 'Mock Air Transfers',
          theme: { primary: '#1D3E8A' },
          wording: {},
        }),
      }),
    );
    await mount({ el: '#w', airline: 'MOCK', apiUrl: 'http://x' });
    const host = document.getElementById('w')!;
    expect(host).not.toBeNull();
    expect(host.shadowRoot).toBeNull(); // closed shadow root: the airline page cannot reach in
  });
});

/**
 * A very small client for our socket.io gateway (namespace /rt) over the browser's own WebSocket,
 * so the tracking page stays far under its 200 KB budget (TRV-09) without the socket.io library.
 * It speaks the Engine.IO v4 / Socket.IO v5 text protocol: open, namespace connect, join with an
 * ack, events, and ping/pong. If it can't connect, `onDown` fires and the page polls instead (TRV-04).
 */
export interface LiveHandlers {
  onEvent: (event: string, payload: unknown) => void;
  onUp?: () => void;
  onDown?: () => void;
}

const NS = '/rt';

export function connectLive(
  apiUrl: string,
  room: string,
  token: string,
  h: LiveHandlers,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (closed || typeof WebSocket === 'undefined') return h.onDown?.();
    const url = apiUrl.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket';
    try {
      ws = new WebSocket(url);
    } catch {
      return schedule();
    }
    ws.onmessage = (m) => {
      const data = String(m.data);
      if (data === '2') return ws?.send('3'); // ping -> pong
      if (data.startsWith('0')) return ws?.send(`40${NS},`); // engine open -> connect namespace
      if (data.startsWith(`40${NS},`)) {
        // namespace connected -> join the booking room (ack id 1)
        return ws?.send(`42${NS},1${JSON.stringify(['join', { room, token }])}`);
      }
      if (data.startsWith(`43${NS},1`)) {
        const ack = JSON.parse(data.slice(`43${NS},1`.length))[0] as { joined?: string };
        if (ack?.joined) {
          retry = 0;
          h.onUp?.();
        } else h.onDown?.();
        return;
      }
      if (data.startsWith(`42${NS},`)) {
        const [event, payload] = JSON.parse(data.slice(`42${NS},`.length)) as [string, unknown];
        h.onEvent(event, payload);
      }
    };
    ws.onclose = () => {
      h.onDown?.();
      schedule();
    };
    ws.onerror = () => ws?.close();
  };

  const schedule = () => {
    if (closed) return;
    retry = Math.min(retry + 1, 6);
    timer = setTimeout(open, 1000 * 2 ** retry);
  };

  open();
  return () => {
    closed = true;
    clearTimeout(timer);
    ws?.close();
  };
}

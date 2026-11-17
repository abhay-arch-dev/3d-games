// Shared WebSocket helper with auto-reconnect.
export function connect(role, onMessage, onStatus = () => {}) {
  let ws = null;
  let retry = 500;

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?role=${role}`);
    ws.onopen = () => { retry = 500; onStatus(true); };
    ws.onclose = () => {
      onStatus(false);
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 4000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      onMessage(msg);
    };
  }
  open();

  return {
    send(obj) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    },
    get connected() { return !!ws && ws.readyState === 1; },
  };
}

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

export interface SocketHandlers {
  onMessage(message: ServerMessage): void;
  onStatus(status: SocketStatus, detail?: string): void;
}

const MAX_BACKOFF_MS = 10_000;

/**
 * One controlling connection per seat, with exponential backoff and jitter.
 * Credentials stay in the cookie; nothing secret is ever put in the URL.
 */
export class RoomSocket {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private timer: number | null = null;
  private stopped = false;

  constructor(
    private readonly roomId: string,
    private readonly handlers: SocketHandlers,
  ) {}

  connect(): void {
    this.stopped = false;
    this.open();
  }

  private open(): void {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}/api/rooms/${this.roomId}/socket`);
    this.socket = socket;
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    socket.addEventListener('open', () => {
      this.attempt = 0;
      this.handlers.onStatus('open');
      this.send({ type: 'snapshot' });
    });

    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === 'ping') {
          this.send({ type: 'pong' });
          return;
        }
        this.handlers.onMessage(message);
      } catch {
        // ignore unparseable frames
      }
    });

    socket.addEventListener('close', (event) => {
      this.socket = null;
      if (this.stopped) return;
      if (event.code === 4001) {
        this.handlers.onStatus('closed', 'replaced');
        return;
      }
      if (event.code === 4003) {
        this.handlers.onStatus('closed', 'expired');
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // 'close' always follows; the reconnect is scheduled there.
    });
  }

  private scheduleReconnect(): void {
    this.handlers.onStatus('reconnecting');
    const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt);
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempt += 1;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.open(), delay);
  }

  send(message: unknown): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.stopped = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
  }
}

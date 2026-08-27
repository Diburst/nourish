/**
 * Local fake servers for the three optional services, so the real HTTP wiring is
 * exercised in tests — no mocks of our own code, only of the remote side.
 */
import { createServer, Server, IncomingMessage } from 'http';
import type { AddressInfo } from 'net';

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

// ---------------- fake Upstash (Redis REST) ----------------

export interface FakeUpstash {
  url: string;
  token: string;
  /** advance the fake clock (ms) so window expiry is testable */
  tick: (ms: number) => void;
  close: () => Promise<void>;
}

export async function startFakeUpstash(): Promise<FakeUpstash> {
  const token = 'fake-upstash-token';
  const store = new Map<string, { value: number | string; expiresAt: number | null }>();
  let clock = 1_000_000;

  function alive(key: string) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= clock) {
      store.delete(key);
      return undefined;
    }
    return entry;
  }

  function run(cmd: (string | number)[]): unknown {
    const [op, ...args] = cmd.map(String);
    switch (op.toUpperCase()) {
      case 'INCR': {
        const entry = alive(args[0]);
        const next = entry ? Number(entry.value) + 1 : 1;
        store.set(args[0], { value: next, expiresAt: entry?.expiresAt ?? null });
        return next;
      }
      case 'PEXPIRE': {
        const entry = alive(args[0]);
        if (!entry) return 0;
        const nx = args[2]?.toUpperCase() === 'NX';
        if (nx && entry.expiresAt !== null) return 0;
        entry.expiresAt = clock + Number(args[1]);
        return 1;
      }
      case 'GET': {
        const entry = alive(args[0]);
        return entry ? String(entry.value) : null;
      }
      case 'SET': {
        store.set(args[0], { value: args[1], expiresAt: null });
        return 'OK';
      }
      case 'DEL': {
        const existed = alive(args[0]) ? 1 : 0;
        store.delete(args[0]);
        return existed;
      }
      default:
        throw new Error(`fake upstash: unsupported command ${op}`);
    }
  }

  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    try {
      const body = await readJson(req);
      const isPipeline = req.url?.startsWith('/pipeline');
      const commands = (isPipeline ? body : [body]) as (string | number)[][];
      const results = commands.map((c) => ({ result: run(c) }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(isPipeline ? results : results[0]));
    } catch (error) {
      res.writeHead(400).end(JSON.stringify({ error: error instanceof Error ? error.message : 'bad request' }));
    }
  });

  const url = await listen(server);
  return {
    url,
    token,
    tick: (ms) => {
      clock += ms;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

// ---------------- fake Resend ----------------

export interface SentEmail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export interface FakeResend {
  url: string;
  sent: SentEmail[];
  failNext: { on: boolean };
  close: () => Promise<void>;
}

export async function startFakeResend(): Promise<FakeResend> {
  const sent: SentEmail[] = [];
  const failNext = { on: false };
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/emails') {
      if (!req.headers.authorization?.startsWith('Bearer ')) {
        res.writeHead(401).end(JSON.stringify({ message: 'missing key' }));
        return;
      }
      if (failNext.on) {
        failNext.on = false;
        res.writeHead(500).end(JSON.stringify({ message: 'simulated outage' }));
        return;
      }
      const body = (await readJson(req)) as SentEmail;
      sent.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `email_${sent.length}` }));
      return;
    }
    res.writeHead(404).end();
  });
  const url = await listen(server);
  return { url, sent, failNext, close: () => new Promise((r) => server.close(() => r())) };
}

// ---------------- fake PostHog ----------------

export interface CapturedEvent {
  api_key: string;
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
}

export interface FakePosthog {
  url: string;
  events: CapturedEvent[];
  close: () => Promise<void>;
}

export async function startFakePosthog(): Promise<FakePosthog> {
  const events: CapturedEvent[] = [];
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/capture')) {
      events.push((await readJson(req)) as CapturedEvent);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 1 }));
      return;
    }
    res.writeHead(404).end();
  });
  const url = await listen(server);
  return { url, events, close: () => new Promise((r) => server.close(() => r())) };
}

/** Poll until fn() is true or timeout — for fire-and-forget captures. */
export async function eventually(fn: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return fn();
}

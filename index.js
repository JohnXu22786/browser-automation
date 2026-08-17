// dsh Cordis bundle bridge for web-bridge-mcp (Web Bridge browser
// automation MCP server).
//
// The plugin's real work is done by the TypeScript MCP server
// (`node dist/index.js`, stdio transport, newline-delimited JSON-RPC). This
// module is the adapter a dsh profile loads: it spawns that server as a child
// process, performs the MCP handshake, re-exposes the 22 `web_*` tools to the
// harness, and forwards calls over the stdio pipe. None of the browser logic
// is re-implemented here.
//
// Build note: `dist/` is gitignored. When the bundle is loaded from a source
// checkout the bridge builds on demand (`npm run build`); installed npm
// packages ship `dist/` in their `files` list so no build is needed.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'web-bridge-mcp';

/** Require the dsh tools service; without it there is nothing to bind. */
export const inject = ['tools'];

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVER_ENTRY = join(__dirname, 'dist', 'index.js');
const PROTOCOL_VERSION = '2025-03-26';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function buildServerEntry(log) {
  if (existsSync(SERVER_ENTRY)) return true;
  log('info', 'dist/index.js missing — running `npm run build` once');
  const result = spawnSync(NPM, ['run', 'build'], { cwd: __dirname, encoding: 'utf8', timeout: 300000 });
  if (result.status !== 0) {
    log('error', (result.stderr || result.stdout || 'npm run build failed').slice(0, 1200));
    return false;
  }
  return existsSync(SERVER_ENTRY);
}

/** Read dsh-plugin.json for the static tool list (name + title). */
function manifestTools() {
  try {
    const manifest = JSON.parse(readFileSync(join(__dirname, 'dsh-plugin.json'), 'utf8'));
    return Array.isArray(manifest.tools) ? manifest.tools : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio client for the SDK's newline-delimited JSON-RPC framing.
// ---------------------------------------------------------------------------

function createMcpClient(log) {
  let proc = null;
  let ready = null;
  let buffer = '';
  let counter = 0;
  const pending = new Map();

  function ensureStarted() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SERVER_ENTRY], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      proc = child;
      child.once('error', (err) => {
        for (const waiter of pending.values()) waiter.reject(err);
        pending.clear();
        reject(err);
      });
      child.once('exit', (code, signal) => {
        const err = new Error(`web-bridge server exited (code=${code} signal=${signal || 'none'})`);
        for (const waiter of pending.values()) waiter.reject(err);
        pending.clear();
      });
      child.once('spawn', () => {
        initialize()
          .then(resolve, reject);
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        drain();
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        for (const line of chunk.trim().split('\n')) if (line) log('info', line);
      });
    });
    return ready;
  }

  function drain() {
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message && message.id !== undefined && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message || JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      }
    }
  }

  async function initialize() {
    const serverInfo = await request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'dsh-web-bridge', version: '0.1.0' },
    });
    void notify('notifications/initialized', {});
    return serverInfo;
  }

  function request(method, params) {
    return ensureSpawnedPrimitive().then(
      () =>
        new Promise((resolve, reject) => {
          const id = ++counter;
          pending.set(id, { resolve, reject });
          proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }) + '\n');
        }),
    );
  }

  function notify(method, params) {
    if (!proc) return;
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {} }) + '\n');
  }

  function ensureSpawnedPrimitive() {
    // `ensureStarted` is awaited by callers; `request` additionally guards that
    // the pipe exists. In-flight requests after a crash reject via 'exit'.
    if (proc && proc.stdin.writable) return Promise.resolve();
    return ensureStarted().then(() => undefined);
  }

  async function callTool(name, arguments_) {
    await ensureStarted();
    const result = await request('tools/call', { name, arguments: arguments_ ?? {} });
    const text = [];
    let image = null;
    for (const item of result && result.content ? result.content : []) {
      if (item.type === 'text') text.push(item.text);
      else if (item.type === 'image') image = { data: item.data, mimeType: item.mimeType };
    }
    if (result && result.isError) {
      return { ok: false, error: { message: text.join('\n') || 'tool call failed' } };
    }
    return { ok: true, result: { text: text.join('\n'), image } };
  }

  async function listTools() {
    await ensureStarted();
    const result = await request('tools/list', {});
    return result && Array.isArray(result.tools) ? result.tools : [];
  }

  function teardown() {
    if (!proc) return;
    try {
      proc.stdin.end();
    } catch {
      /* ignore */
    }
    const child = proc;
    proc = null;
    const killer = setTimeout(() => child.kill(), 2000);
    killer.unref();
    child.on('exit', () => clearTimeout(killer));
  }

  return { callTool, listTools, teardown };
}

function makeLogger(ctx) {
  return (level, msg) => {
    if (ctx.logger && typeof ctx.logger[level] === 'function') ctx.logger[level](`[web-bridge] ${msg}`);
    else if (level === 'error') console.error(`[web-bridge] ${msg}`);
    else console.log(`[web-bridge] ${msg}`);
  };
}

export function apply(ctx, rowConfig = {}) {
  const disposers = [];
  const log = makeLogger(ctx);
  const client = createMcpClient(log);

  if (!buildServerEntry(log)) {
    log('error', 'could not build the server bundle; web_* tools will return errors');
  }

  // Register the tools immediately from dsh-plugin.json so the harness sees a
  // stable, complete tool set after load; the authoritative schemas from the
  // server's tools/list are applied in place as soon as the handshake lands.
  const defs = [];
  const row = rowConfig && typeof rowConfig === 'object' ? rowConfig : {};
  const envPrefix = 'WEB_BRIDGE_';
  for (const tool of manifestTools()) {
    if (!tool || typeof tool.name !== 'string') continue;
    const def = {
      name: tool.name,
      description: tool.title || `web-bridge browser tool: ${tool.name}`,
      parameters: { type: 'object', properties: {}, additionalProperties: true },
      metadata: { envPrefix },
      output: { schema: { type: 'object', additionalProperties: true } },
      execute: (args) => client.callTool(tool.name, args),
    };
    const ret = ctx.tools && ctx.tools.register ? ctx.tools.register(def) : null;
    if (typeof ret === 'function') disposers.push(ret);
    defs.push(def);
  }

  void (async () => {
    try {
      const tools = await client.listTools();
      for (const serverTool of tools) {
        const def = defs.find((d) => d.name === serverTool.name);
        if (!def) continue;
        if (serverTool.title) def.description = `${serverTool.title} — ${def.description}`;
        if (serverTool.inputSchema && typeof serverTool.inputSchema === 'object') {
          def.parameters = serverTool.inputSchema;
        }
      }
      log('info', `registered ${tools.length} web_* tools from the MCP server`);
    } catch (err) {
      log('error', `MCP handshake failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();

  const dispose = () => {
    for (const fn of disposers) {
      try {
        fn();
      } catch {
        /* unregister must not throw */
      }
    }
    client.teardown();
  };

  if (ctx.effect && typeof ctx.effect === 'function') ctx.effect(dispose);
  return dispose;
}
'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UI_FILE = path.join(__dirname, 'test_server_manager.html');
const DEFAULT_MANAGER_PORT = 8124;
const WORKTREE_NAMES = ['codex', 'claude', 'antigravity'];
const REGISTRY_FILE = path.join(
  os.tmpdir(),
  `idle-rpg-test-servers-${path.basename(ROOT).toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.json`
);
const activeServers = new Map();
let managerPort = null;
let registryLoaded = false;

function validPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function stripRuntimeFields(record) {
  const { server, child, ...serializable } = record;
  return serializable;
}

function loadRegistry() {
  if (registryLoaded) return;
  registryLoaded = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return;
    for (const record of parsed) {
      if (!record || !validPort(Number(record.port))) continue;
      activeServers.set(Number(record.port), {
        ...record,
        port: Number(record.port),
        managed: true,
      });
    }
  } catch (_) {
    // No registry is normal on the first launch.
  }
}

function persistRegistry() {
  const records = Array.from(activeServers.values()).map(stripRuntimeFields);
  const temporaryFile = `${REGISTRY_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(records, null, 2), 'utf8');
    fs.renameSync(temporaryFile, REGISTRY_FILE);
  } catch (_) {
    try { fs.unlinkSync(temporaryFile); } catch (_) {}
  }
}

function readRecords() {
  loadRegistry();
  return Array.from(activeServers.values())
    .map(stripRuntimeFields)
    .sort((a, b) => a.port - b.port);
}

function getSourceRoots() {
  const parent = path.dirname(ROOT);
  const candidates = [ROOT, ...WORKTREE_NAMES.map((name) => path.join(parent, name))];
  const seen = new Set();
  return candidates
    .map((candidate) => path.resolve(candidate))
    .filter((candidate) => {
      if (seen.has(candidate) || !fs.existsSync(path.join(candidate, 'index.html'))) return false;
      seen.add(candidate);
      return true;
    })
    .map((root) => {
      const key = path.basename(root).toLowerCase();
      return { key, label: key.charAt(0).toUpperCase() + key.slice(1), root };
    });
}

function resolveSourceRoot(sourceKey) {
  const key = String(sourceKey || path.basename(ROOT)).trim().toLowerCase();
  const source = getSourceRoots().find((item) => item.key === key);
  if (!source) throw new Error(`找不到開服來源資料夾：${sourceKey}`);
  return source;
}

function runPowerShell(script) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 3000, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? '' : stdout.trim())
    );
  });
}

async function listListeningPorts() {
  if (process.platform !== 'win32') return [];
  const script = `
    $ErrorActionPreference = 'SilentlyContinue'
    $processNames = @{}
    Get-Process | ForEach-Object { $processNames[[int]$_.Id] = $_.ProcessName }
    $processDetails = @{}
    Get-CimInstance Win32_Process | ForEach-Object { $processDetails[[int]$_.ProcessId] = $_ }
    Get-NetTCPConnection -State Listen |
      Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::1', '::') } |
      ForEach-Object {
        [pscustomobject]@{
          LocalAddress = $_.LocalAddress
          LocalPort = $_.LocalPort
          OwningProcess = $_.OwningProcess
          ProcessName = $processNames[[int]$_.OwningProcess]
          CommandLine = $processDetails[[int]$_.OwningProcess].CommandLine
          ExecutablePath = $processDetails[[int]$_.OwningProcess].ExecutablePath
        }
      } |
      ConvertTo-Json -Compress
  `;
  const text = await runPowerShell(script);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((row) => ({
        address: String(row.LocalAddress || ''),
        port: Number(row.LocalPort),
        pid: Number(row.OwningProcess),
        processName: String(row.ProcessName || ''),
        commandLine: String(row.CommandLine || ''),
        executablePath: String(row.ExecutablePath || ''),
      }))
      .filter((row) => validPort(row.port) && Number.isInteger(row.pid));
  } catch (_) {
    return [];
  }
}

function probeHttp(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const request = http.get({ host, port, path: '/', timeout: 700, headers: { Connection: 'close' } }, (response) => {
      const result = { statusCode: response.statusCode || 0, server: response.headers.server || '' };
      response.resume();
      response.once('end', () => resolve(result));
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(null));
  });
}

function isRelevantEndpoint(endpoint) {
  const processName = endpoint.processName || '';
  const details = `${processName} ${endpoint.commandLine || ''} ${endpoint.executablePath || ''}`.toLowerCase();
  if (/claude|codex|antigravity/.test(details)) return true;
  if (/idle-rpg/.test(details)) return true;
  return /^(node|nodejs|python|python3|deno|bun|ruby|php|dotnet|java)$/i.test(processName);
}

async function discoverLocalServers() {
  const endpoints = await listListeningPorts();
  const candidates = new Map();
  for (const endpoint of endpoints) {
    if (endpoint.port === managerPort || activeServers.has(endpoint.port)) continue;
    if (!isRelevantEndpoint(endpoint)) continue;
    if (!candidates.has(endpoint.port)) candidates.set(endpoint.port, endpoint);
  }

  const discovered = await Promise.all(Array.from(candidates.values()).map(async (endpoint) => {
    const preferredHost = endpoint.address.includes(':') ? '::1' : '127.0.0.1';
    const probe = await probeHttp(endpoint.port, preferredHost) ||
      (preferredHost === '::1' ? await probeHttp(endpoint.port, '127.0.0.1') : null);
    if (!probe) return null;
    return {
      pid: endpoint.pid,
      port: endpoint.port,
      url: `http://127.0.0.1:${endpoint.port}/`,
      startedAt: null,
      managed: false,
      statusCode: probe.statusCode,
      server: probe.server,
      processName: endpoint.processName,
    };
  }));
  return discovered.filter(Boolean);
}

async function readAllRecords() {
  const managed = [];
  let registryChanged = false;
  for (const record of readRecords()) {
    if (await isManagedRecordAlive(record)) {
      managed.push({ ...record, managed: true });
    } else {
      activeServers.delete(record.port);
      registryChanged = true;
    }
  }
  if (registryChanged) persistRegistry();
  const external = await discoverLocalServers();
  return [...managed, ...external].sort((a, b) => a.port - b.port);
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(400, () => done(false));
  });
}

async function isManagedRecordAlive(record) {
  if (!validPort(record.port) || !Number.isInteger(Number(record.pid))) return false;
  const probe = await probeHttp(record.port);
  if (!probe) return false;
  if (process.platform !== 'win32') return true;

  const endpoints = (await listListeningPorts()).filter((item) => item.port === record.port);
  if (endpoints.length === 0) return true;
  return endpoints.some((item) => item.pid === Number(record.pid));
}

function getPage(port) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/', method: 'HEAD', timeout: 700 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.once('timeout', () => request.destroy(new Error('timeout')));
    request.once('error', () => reject(new Error('not ready')));
    request.end();
  });
}

async function waitUntilReady(port, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if (await getPage(port)) return true;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function startServer(port, sourceKey) {
  if (!validPort(port)) throw new Error('Port must be an integer from 1 to 65535.');
  const source = resolveSourceRoot(sourceKey);
  const existing = readRecords().find((record) => record.port === port);
  if (existing) {
    if (existing.sourceKey && existing.sourceKey !== source.key) {
      throw new Error(`Port ${port} 已由 ${existing.sourceLabel || existing.sourceKey} 來源啟動，請先關閉它或改用其他 Port。`);
    }
    if (await isManagedRecordAlive(existing)) return existing;
    activeServers.delete(port);
    persistRegistry();
  }
  if (await isPortOpen(port)) throw new Error(`Port ${port} 已被其他程式使用。`);

  const child = spawn(process.execPath, [
    __filename,
    '--server',
    '--server-port', String(port),
    '--server-root', source.root,
  ], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const record = {
    pid: child.pid,
    port,
    url: `http://127.0.0.1:${port}/`,
    startedAt: new Date().toISOString(),
    managed: true,
    sourceKey: source.key,
    sourceLabel: source.label,
    sourceRoot: source.root,
    child,
  };
  try {
    if (!await waitUntilReady(port)) throw new Error(`Port ${port} test server did not become ready.`);
  } catch (error) {
    try { await terminateProcess(child.pid); } catch (_) {}
    throw error;
  }
  activeServers.set(port, record);
  persistRegistry();
  return readRecords().find((item) => item.port === port);
}

async function stopServer(port) {
  loadRegistry();
  const record = activeServers.get(port);
  if (!record) throw new Error(`找不到 port ${port} 的測試服。`);
  await terminateProcess(record.pid);
  activeServers.delete(port);
  persistRegistry();
  return { pid: record.pid, port: record.port, url: record.url, startedAt: record.startedAt };
}

function terminateExternalProcess(pid) {
  return new Promise((resolve, reject) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/F'], { windowsHide: true, timeout: 5000 }, (error) => {
      if (error) reject(new Error(`無法關閉外部程序 PID ${pid}。`));
      else resolve();
    });
  });
}

function terminateProcess(pid) {
  if (process.platform === 'win32') return terminateExternalProcess(pid);
  return new Promise((resolve, reject) => {
    try {
      process.kill(pid);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

async function stopExternalServer(port) {
  const record = (await discoverLocalServers()).find((item) => item.port === port);
  if (!record) throw new Error(`找不到仍在運行的外部服務 Port ${port}。`);
  if (!Number.isInteger(record.pid) || record.pid <= 4 || record.pid === process.pid) {
    throw new Error(`基於安全原因，無法關閉 Port ${port} 的系統或控制台程序。`);
  }
  await terminateExternalProcess(record.pid);
  return { pid: record.pid, port: record.port, url: record.url, startedAt: record.startedAt };
}

async function stopExternalServerByPid(port, pidHint = null) {
  const hintedPid = Number(pidHint);
  const endpoints = await listListeningPorts();
  const endpoint = endpoints.find((item) => item.port === port && (!Number.isInteger(hintedPid) || item.pid === hintedPid));
  if (!endpoint) throw new Error(`找不到仍在監聽的外部服務 Port ${port}。`);
  const pid = endpoint.pid;
  if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid) {
    throw new Error(`基於安全原因，無法關閉 Port ${port} 的系統或控制台程序。`);
  }
  await terminateExternalProcess(pid);
  return { pid, port, url: `http://127.0.0.1:${port}/`, startedAt: null };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg'
};

function createStaticServer(root = ROOT) {
  return http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405); response.end(); return;
    }
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/') pathname = '/index.html';
      const target = path.resolve(root, `.${pathname}`);
      const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
      if (target !== root && !target.startsWith(rootPrefix)) {
        response.writeHead(403); response.end(); return;
      }
      const bytes = fs.readFileSync(target);
      const contentType = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'Content-Length': bytes.length });
      if (request.method !== 'HEAD') response.end(bytes); else response.end();
    } catch (_) {
      response.writeHead(404); response.end();
    }
  });
}

function listenServer(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function openBrowser(url) {
  const child = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function bodyJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; if (body.length > 10000) reject(new Error('request too large')); });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (_) { reject(new Error('JSON 格式錯誤。')); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, data) {
  const text = JSON.stringify(data);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(text);
}

function createManager() {
  return http.createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        response.end(fs.readFileSync(UI_FILE));
        return;
      }
      if (request.method === 'GET' && request.url === '/api/servers') {
        sendJson(response, 200, { servers: await readAllRecords() });
        return;
      }
      if (request.method === 'GET' && request.url === '/api/sources') {
        sendJson(response, 200, { sources: getSourceRoots() });
        return;
      }
      if (request.method === 'POST' && request.url === '/api/servers/start') {
        const payload = await bodyJson(request);
        const record = await startServer(Number(payload.port), payload.sourceKey);
        sendJson(response, 200, { server: record });
        return;
      }
      if (request.method === 'POST' && request.url === '/api/servers/stop') {
        const payload = await bodyJson(request);
        const port = Number(payload.port);
        const record = readRecords().some((item) => item.port === port)
          ? await stopServer(port)
          : await stopExternalServerByPid(port, payload.pid);
        sendJson(response, 200, { stopped: record });
        return;
      }
      sendJson(response, 404, { error: '找不到這個路徑。' });
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
  });
}

function parseArgs(args) {
  const options = {
    port: DEFAULT_MANAGER_PORT,
    open: false,
    quiet: false,
    launchManager: false,
    server: false,
    serverPort: null,
    serverRoot: ROOT,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server') options.server = true;
    else if (args[i] === '--launch-manager') options.launchManager = true;
    else if (args[i] === '--open') options.open = true;
    else if (args[i] === '--quiet') options.quiet = true;
    else if (args[i] === '--port') options.port = Number(args[++i]);
    else if (args[i] === '--server-port') options.serverPort = Number(args[++i]);
    else if (args[i] === '--server-root') options.serverRoot = path.resolve(args[++i]);
  }
  if (options.server) {
    if (!validPort(options.serverPort)) throw new Error('Server port must be an integer from 1 to 65535.');
    return options;
  }
  if (!validPort(options.port)) throw new Error('Manager port 必須是 1 到 65535 的整數。');
  return options;
}

function launchDetachedManager(options) {
  const childArgs = [__filename, '--port', String(options.port)];
  if (options.open) childArgs.push('--open');
  if (options.quiet) childArgs.push('--quiet');
  const child = spawn(process.execPath, childArgs, {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function runStandaloneServer(options) {
  const server = createStaticServer(options.serverRoot);
  server.once('error', (error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
  server.listen(options.serverPort, '127.0.0.1');
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

function listenOnAvailablePort(server, port, open, quiet) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && port < DEFAULT_MANAGER_PORT + 20) {
      listenOnAvailablePort(server, port + 1, open, quiet);
      return;
    }
    throw error;
  });
  server.listen(port, '127.0.0.1', () => {
    managerPort = port;
    const url = `http://127.0.0.1:${port}/`;
    if (!quiet) console.log(`Idle-RPG test server manager: ${url}`);
    if (open) setTimeout(() => openBrowser(url), 250);
  });
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.server) runStandaloneServer(options);
    else if (options.launchManager) launchDetachedManager(options);
    else listenOnAvailablePort(createManager(), options.port, options.open, options.quiet);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { createManager, parseArgs, startServer, stopServer, stopExternalServer, readRecords, readAllRecords, discoverLocalServers, isRelevantEndpoint, getSourceRoots, resolveSourceRoot };

'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { execFile, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UI_FILE = path.join(__dirname, 'test_server_manager.html');
const DEFAULT_MANAGER_PORT = 8124;
const activeServers = new Map();
let managerPort = null;

function validPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function readRecords() {
  return Array.from(activeServers.values())
    .map(({ server, ...record }) => record)
    .sort((a, b) => a.port - b.port);
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
  const managed = readRecords().map((record) => ({ ...record, managed: true }));
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

async function startServer(port) {
  if (!validPort(port)) throw new Error('Port 必須是 1 到 65535 的整數。');
  const existing = readRecords().find((record) => record.port === port);
  if (existing) return existing;
  if (await isPortOpen(port)) throw new Error(`Port ${port} 已被其他程式使用。`);

  const record = {
    pid: process.pid,
    port,
    url: `http://127.0.0.1:${port}/`,
    startedAt: new Date().toISOString(),
    managed: true,
    server: createStaticServer()
  };
  try {
    await listenServer(record.server, port);
  } catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${port} 已被其他程式使用。`);
    throw error;
  }
  activeServers.set(port, record);
  return readRecords().find((item) => item.port === port);
}

async function stopServer(port) {
  const record = activeServers.get(port);
  if (!record) throw new Error(`找不到 port ${port} 的測試服。`);
  await new Promise((resolve, reject) => record.server.close((error) => error ? reject(error) : resolve()));
  activeServers.delete(port);
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

function createStaticServer() {
  return http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405); response.end(); return;
    }
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/') pathname = '/index.html';
      const target = path.resolve(ROOT, `.${pathname}`);
      const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
      if (target !== ROOT && !target.startsWith(rootPrefix)) {
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
      if (request.method === 'POST' && request.url === '/api/servers/start') {
        const payload = await bodyJson(request);
        const record = await startServer(Number(payload.port));
        sendJson(response, 200, { server: record });
        return;
      }
      if (request.method === 'POST' && request.url === '/api/servers/stop') {
        const payload = await bodyJson(request);
        const port = Number(payload.port);
        const record = activeServers.has(port)
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
  const options = { port: DEFAULT_MANAGER_PORT, open: false, quiet: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--open') options.open = true;
    else if (args[i] === '--quiet') options.quiet = true;
    else if (args[i] === '--port') options.port = Number(args[++i]);
  }
  if (!validPort(options.port)) throw new Error('Manager port 必須是 1 到 65535 的整數。');
  return options;
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
    listenOnAvailablePort(createManager(), options.port, options.open, options.quiet);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { createManager, parseArgs, startServer, stopServer, stopExternalServer, readRecords, readAllRecords, discoverLocalServers, isRelevantEndpoint };

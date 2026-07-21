import fs from 'fs';
import path from 'path';

// Max in-memory log entries to retain
const MAX_LOGS = 500;
const logsBuffer = [];

let logFilePath = null;

export function initLogger(dataDir) {
  try {
    if (dataDir) {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      logFilePath = path.join(dataDir, 'activity.log');
    }
  } catch (err) {
    console.error('Failed to initialize log file:', err);
  }
}

export function addLog(level = 'INFO', source = 'System', message = '', details = null) {
  const timestamp = new Date().toISOString();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp,
    level: level.toUpperCase(),
    source,
    message: typeof message === 'object' ? JSON.stringify(message) : String(message),
    details: details ? (typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details)) : null
  };

  logsBuffer.push(entry);
  if (logsBuffer.length > MAX_LOGS) {
    logsBuffer.shift();
  }

  // Also write to log file if initialized
  if (logFilePath) {
    try {
      const line = `[${timestamp}] [${entry.level}] [${entry.source}] ${entry.message}${entry.details ? ' | ' + entry.details : ''}\n`;
      fs.appendFileSync(logFilePath, line, 'utf8');
    } catch (e) {
      // Ignore file append errors
    }
  }

  return entry;
}

export const logger = {
  info: (source, msg, details) => addLog('INFO', source, msg, details),
  success: (source, msg, details) => addLog('SUCCESS', source, msg, details),
  warn: (source, msg, details) => addLog('WARN', source, msg, details),
  error: (source, msg, details) => addLog('ERROR', source, msg, details),
  getLogs: (limit = 200) => {
    return logsBuffer.slice(-limit).reverse();
  },
  clearLogs: () => {
    logsBuffer.length = 0;
    if (logFilePath && fs.existsSync(logFilePath)) {
      try {
        fs.writeFileSync(logFilePath, '', 'utf8');
      } catch (e) {}
    }
  },
  getLogFilePath: () => logFilePath
};

// Hook console logging to capture server logs automatically
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = (...args) => {
  originalConsoleLog(...args);
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  if (msg.startsWith('[Electron]') || msg.startsWith('[Server]') || msg.startsWith('[DB]') || msg.startsWith('[Whisper]') || msg.startsWith('[Gemini]')) {
    const parts = msg.match(/^\[(.*?)\]\s*(.*)/);
    if (parts) {
      addLog('INFO', parts[1], parts[2]);
      return;
    }
  }
  addLog('INFO', 'Console', msg);
};

console.error = (...args) => {
  originalConsoleError(...args);
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  if (msg.startsWith('[Electron]') || msg.startsWith('[Server]') || msg.startsWith('[DB]') || msg.startsWith('[Whisper]') || msg.startsWith('[Gemini]')) {
    const parts = msg.match(/^\[(.*?)\]\s*(.*)/);
    if (parts) {
      addLog('ERROR', parts[1], parts[2]);
      return;
    }
  }
  addLog('ERROR', 'Console', msg);
};

console.warn = (...args) => {
  originalConsoleWarn(...args);
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  addLog('WARN', 'Console', msg);
};

export default logger;

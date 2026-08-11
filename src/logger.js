function createLogger(output = console) {
  function write(level, message, details) {
    const entry = { time: new Date().toISOString(), level, message, ...details };
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    output[method](JSON.stringify(entry));
  }
  return {
    info: (message, details = {}) => write('info', message, details),
    warn: (message, details = {}) => write('warn', message, details),
    error: (message, details = {}) => write('error', message, details)
  };
}

module.exports = { createLogger };

'use strict';

function ts() {
  return new Date().toISOString();
}

function log(level, msg, extra) {
  const line = `[${ts()}] ${level.toUpperCase()} ${msg}`;
  if (extra) {
    console.log(line, extra);
  } else {
    console.log(line);
  }
}

module.exports = {
  info: (msg, extra) => log('info', msg, extra),
  warn: (msg, extra) => log('warn', msg, extra),
  error: (msg, extra) => log('error', msg, extra)
};

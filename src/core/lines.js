'use strict';
// Reads the complete new lines of a file from a byte offset. Never loads the whole file, never writes.
// A last line without a newline is left for the next read, so a line the tool is still writing is not
// parsed half-done. Lines longer than maxLineBytes are skipped (and counted) instead of buffered.
const fs = require('fs');

const NL = 10;

/**
 * @param {string} file
 * @param {number} start byte offset to start at (the end of the last complete line read before)
 * @param {(line: string) => void} onLine
 * @param {{ end?: number, chunkSize?: number, maxLineBytes?: number, isCancelled?: () => boolean }} [opts]
 * @returns {Promise<{ offset: number, lines: number, longLines: number, cancelled: boolean }>}
 *   offset = byte position just after the last complete line seen; read from there next time.
 */
function readNewLines(file, start, onLine, opts = {}) {
  const maxLineBytes = opts.maxLineBytes || 32 * 1024 * 1024;
  const isCancelled = opts.isCancelled || (() => false);
  const streamOpts = { start: Math.max(0, start || 0), highWaterMark: opts.chunkSize || 512 * 1024 };
  if (typeof opts.end === 'number' && opts.end > 0) streamOpts.end = opts.end - 1;
  return new Promise((resolve, reject) => {
    if (typeof streamOpts.end === 'number' && streamOpts.end < streamOpts.start) {
      resolve({ offset: streamOpts.start, lines: 0, longLines: 0, cancelled: false });
      return;
    }
    const stream = fs.createReadStream(file, streamOpts);
    let parts = [], partLen = 0, skipping = false, pos = streamOpts.start, lineEnd = streamOpts.start;
    const res = { offset: streamOpts.start, lines: 0, longLines: 0, cancelled: false };
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      res.offset = lineEnd;
      stream.destroy();
      resolve(res);
    };
    stream.on('data', (chunk) => {
      if (done) return;
      if (isCancelled()) { res.cancelled = true; finish(); return; }
      let s = 0, idx;
      while ((idx = chunk.indexOf(NL, s)) !== -1) {
        let buf;
        if (partLen) { parts.push(chunk.subarray(s, idx)); buf = Buffer.concat(parts); parts = []; partLen = 0; }
        else buf = chunk.subarray(s, idx);
        lineEnd = pos + idx + 1;
        s = idx + 1;
        if (skipping) { skipping = false; continue; }
        let line = buf.toString('utf8');
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line.length) { res.lines++; try { onLine(line); } catch { /* a bad line never stops the read */ } }
      }
      if (s < chunk.length && !skipping) {
        parts.push(chunk.subarray(s));
        partLen += chunk.length - s;
        if (partLen > maxLineBytes) { parts = []; partLen = 0; skipping = true; res.longLines++; }
      }
      pos += chunk.length;
    });
    stream.on('end', finish);
    stream.on('error', (err) => { if (!done) { done = true; reject(err); } });
  });
}

/** Parses one JSONL line into an object, or undefined for a bad line. */
function parseLine(s) {
  const c = s.charCodeAt(0);
  if (c !== 123 /* { */ && c !== 32 && c !== 9) return undefined;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

module.exports = { readNewLines, parseLine };

import { writeFileSync, appendFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Atomically writes JSON data to a file (write to .tmp, then rename).
 */
export function atomicWriteJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, filePath);
}

/**
 * Appends a single JSON line to a JSONL file.
 * Returns the number of bytes written.
 */
export function appendJsonLine(filePath: string, data: unknown): number {
  mkdirSync(dirname(filePath), { recursive: true });
  const line = JSON.stringify(data) + '\n';
  appendFileSync(filePath, line, 'utf-8');
  return Buffer.byteLength(line, 'utf-8');
}

/**
 * Formats a Date as a Windows-safe timestamp filename: YYYY-MM-DDTHH-mm-ssZ
 */
export function formatTimestampFilename(date: Date = new Date()): string {
  return date.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

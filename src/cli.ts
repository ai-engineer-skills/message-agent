#!/usr/bin/env node

// CLI entry point — dispatches to setup or main based on args
const arg = process.argv[2];

if (arg === 'setup') {
  await import('./setup.js');
} else {
  await import('./index.js');
}

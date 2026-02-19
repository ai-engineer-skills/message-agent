import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_DIR = '.message-agent-host';

/**
 * Resolves the data root directory.
 * Default: ~/.message-agent-host/
 * Override via MESSAGE_AGENT_DATA_DIR env var.
 */
export function getDataRoot(): string {
  const override = process.env.MESSAGE_AGENT_DATA_DIR;
  if (override) return override;

  return join(homedir(), APP_DIR);
}

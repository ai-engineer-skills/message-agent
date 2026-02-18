import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from 'agent-toolkit/logger';
import { SkillDefinition } from '../types/skill.js';
import { SkillRegistry } from './skill-registry.js';

const log = createLogger('skills:loader');

interface SkillFrontmatter {
  name: string;
  description: string;
  'disable-model-invocation'?: boolean;
  'user-invocable'?: boolean;
  'argument-hint'?: string;
  'allowed-tools'?: string;
  context?: 'fork' | 'inherit';
}

function parseFrontmatter(content: string): {
  meta: SkillFrontmatter;
  body: string;
} {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid SKILL.md: no frontmatter found');
  }

  const meta: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: string | boolean = line.slice(colonIdx + 1).trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    meta[key] = value;
  }

  return { meta: meta as unknown as SkillFrontmatter, body: match[2] };
}

function loadSkillFile(filePath: string): SkillDefinition {
  const content = readFileSync(filePath, 'utf-8');
  const { meta, body } = parseFrontmatter(content);

  return {
    name: meta.name,
    description: meta.description,
    userInvocable: meta['user-invocable'] !== false,
    argumentHint: meta['argument-hint'],
    disableModelInvocation: meta['disable-model-invocation'] === true,
    allowedTools: meta['allowed-tools']
      ? String(meta['allowed-tools']).split(',').map((s) => s.trim())
      : undefined,
    context: meta.context,
    instructions: body,
    source: 'skillmd',
  };
}

export function loadSkillsFromDirectory(
  dir: string,
  registry: SkillRegistry,
): number {
  if (!existsSync(dir)) {
    log.debug('Skill directory does not exist', { dir });
    return 0;
  }

  let count = 0;
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(dir, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;

    try {
      const skill = loadSkillFile(skillFile);
      registry.register(skill);
      count++;
    } catch (err) {
      log.error('Failed to load skill', {
        path: skillFile,
        error: String(err),
      });
    }
  }

  return count;
}

export function loadAllSkills(
  registry: SkillRegistry,
  additionalDirs?: string[],
): void {
  // 1. Bundled skills from submodule
  const bundledDir = join(
    process.cwd(),
    'vendor',
    'ai-engineer-skills',
    'skills',
  );
  const bundledCount = loadSkillsFromDirectory(bundledDir, registry);
  log.info('Loaded bundled skills', { count: bundledCount });

  // 2. Project-local custom skills
  const localDir = join(process.cwd(), 'skills');
  const localCount = loadSkillsFromDirectory(localDir, registry);
  if (localCount > 0) {
    log.info('Loaded local skills', { count: localCount });
  }

  // 3. Additional directories
  if (additionalDirs) {
    for (const dir of additionalDirs) {
      const count = loadSkillsFromDirectory(dir, registry);
      if (count > 0) {
        log.info('Loaded additional skills', { dir, count });
      }
    }
  }
}

#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { stringify } from 'yaml';

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function askYN(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? '(Y/n)' : '(y/N)';
  return new Promise((resolve) => {
    rl.question(`${question} ${hint}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

async function main(): Promise<void> {
  console.log('\n=== Message Agent Host Setup ===\n');

  // Check existing config
  if (existsSync('config.yaml')) {
    const reconfigure = await askYN('config.yaml already exists. Reconfigure?');
    if (!reconfigure) {
      console.log('Setup cancelled.');
      rl.close();
      return;
    }
  }

  // Persona
  console.log('\n--- Persona ---');
  const personaName = await ask('Agent name', 'Assistant');
  const systemPrompt = await ask(
    'System prompt',
    'You are a helpful assistant. Be concise and accurate.',
  );

  // LLM provider
  console.log('\n--- LLM Provider ---');
  console.log('  1. direct-api (OpenAI-compatible API)');
  console.log('  2. copilot (GitHub Copilot)');
  console.log('  3. claude-code (Claude Code CLI)');
  const providerChoice = await ask('Choose provider (1/2/3)', '1');

  const llm: Record<string, unknown> = {};
  switch (providerChoice) {
    case '2':
      llm.provider = 'copilot';
      llm.model = await ask('Model', 'gpt-4');
      const ghToken = await ask('GitHub token (or use GITHUB_TOKEN env var)', '${GITHUB_TOKEN}');
      llm.githubToken = ghToken;
      break;
    case '3':
      llm.provider = 'claude-code';
      const ccModel = await ask('Model (optional)');
      if (ccModel) llm.model = ccModel;
      break;
    case '1':
    default:
      llm.provider = 'direct-api';
      llm.apiKey = await ask('API key (or env var like ${OPENAI_API_KEY})', '${OPENAI_API_KEY}');
      const baseUrl = await ask('Base URL (optional)');
      if (baseUrl) llm.baseUrl = baseUrl;
      llm.model = await ask('Model', 'gpt-4o');
      const maxTokensStr = await ask('Max tokens', '4096');
      llm.maxTokens = parseInt(maxTokensStr, 10);
      break;
  }

  // Channels
  console.log('\n--- Channels ---');
  const channels: Record<string, unknown> = {};

  // Telegram
  if (await askYN('Enable Telegram?')) {
    const token = await ask('Telegram bot token');
    channels.telegram = { type: 'telegram', enabled: true, token };
  }

  // WhatsApp
  if (await askYN('Enable WhatsApp?')) {
    const sessionPath = await ask('Session data path', './data/whatsapp-session');
    channels.whatsapp = { type: 'whatsapp', enabled: true, sessionDataPath: sessionPath };
  }

  // WeChat
  if (await askYN('Enable WeChat?')) {
    const puppet = await ask('Puppet provider', 'wechaty-puppet-wechat4u');
    channels.wechat = { type: 'wechat', enabled: true, puppetProvider: puppet };
  }

  // iMessage
  if (await askYN('Enable iMessage?')) {
    channels.imessage = { type: 'imessage', enabled: true };
  }

  // Web UI
  console.log('\n--- Web UI ---');
  const webEnabled = await askYN('Enable Web UI?', true);
  const webConfig: Record<string, unknown> = { enabled: webEnabled };
  if (webEnabled) {
    const portStr = await ask('Web UI port', '3000');
    webConfig.port = parseInt(portStr, 10);
  }

  // Build config object
  const config: Record<string, unknown> = {
    persona: {
      name: personaName,
      systemPrompt,
    },
    llm,
    channels,
    web: webConfig,
  };

  // Write config
  const yamlContent = stringify(config);
  writeFileSync('config.yaml', yamlContent, 'utf-8');
  console.log('\nconfig.yaml written successfully.\n');

  // Build
  const doBuild = await askYN('Run build now?', true);
  if (doBuild) {
    console.log('Building...');
    try {
      execSync('npm run build', { stdio: 'inherit' });
      console.log('\nBuild successful!');
    } catch {
      console.error('\nBuild failed. Fix errors and run "npm run build" manually.');
    }
  }

  console.log('\nSetup complete! Run "npm start" to launch the agent.');
  if (webEnabled) {
    console.log(`Web UI will be available at http://localhost:${webConfig.port ?? 3000}`);
  }

  rl.close();
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});

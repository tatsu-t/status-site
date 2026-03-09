import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { dataPath, ensureDataDir } from './paths';
import { withFileLock } from './file-lock';

export interface ServiceAuth {
  user: string;
  pass: string;
}

export interface ServiceConfig {
  id: string;
  name: string;
  type: 'ping' | 'docker' | 'group' | 'external' | 'systemctl' | 'agent-push' | 'web' | 'tcp' | 'minecraft' | 'gamedig';
  target: string;
  protocol?: string;
  auth?: ServiceAuth;
  group: string;
  icon: string;
  docker_watch?: string;
  systemd_watch?: string;
}

export interface AppConfig {
  title: string;
  description: string;
  services: ServiceConfig[];
  group_order?: string[];
}

const CONFIG_PATH = dataPath('config.json');

let cachedConfig: AppConfig | null = null;
let cacheTime = 0;

const DEFAULT_CONFIG: AppConfig = {
  title: 'Status Dashboard',
  description: '',
  services: [],
};

export function loadConfig(): AppConfig {
  const now = Date.now();
  if (cachedConfig && now - cacheTime < 60000) return cachedConfig;
  if (!existsSync(CONFIG_PATH)) {
    cachedConfig = { ...DEFAULT_CONFIG, services: [] };
    cacheTime = now;
    return cachedConfig;
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    cachedConfig = JSON.parse(raw) as AppConfig;
  } catch (e) {
    console.error('Failed to parse config.json, using defaults:', e);
    cachedConfig = { ...DEFAULT_CONFIG, services: [] };
  }
  cacheTime = now;
  return cachedConfig;
}

export function invalidateCache(): void {
  cachedConfig = null;
  cacheTime = 0;
}

export function saveConfig(config: AppConfig): void {
  withFileLock(CONFIG_PATH, () => {
    ensureDataDir();
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  });
  cachedConfig = config;
  cacheTime = Date.now();
}

export function generateId(): string {
  return randomBytes(12).toString('hex');
}

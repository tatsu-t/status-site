import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataPath, ensureDataDir } from './paths';

export interface ServiceAuth {
  user: string;
  pass: string;
}

export interface ServiceConfig {
  id: string;
  name: string;
  type: 'ping' | 'docker' | 'group' | 'external' | 'systemctl' | 'agent-push' | 'web' | 'tcp';
  target: string;
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
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  cachedConfig = JSON.parse(raw) as AppConfig;
  cacheTime = now;
  return cachedConfig;
}

export function invalidateCache(): void {
  cachedConfig = null;
  cacheTime = 0;
}

export function saveConfig(config: AppConfig): void {
  ensureDataDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  cachedConfig = config;
  cacheTime = Date.now();
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

import {
  addQuotaUsage,
  getDb,
  getQuotaUsed,
  getSettings,
  runMigrations,
  seedDefaultKeywords,
  seedDefaultSettings,
  type DbContext,
} from '@youtubeca/db';
import { LlmClient } from '@youtubeca/llm';
import { DEFAULT_KEYWORDS, type Settings } from '@youtubeca/shared';
import { loadEnv } from '@youtubeca/shared/env';
import { YouTubeClient, type QuotaGuard } from '@youtubeca/youtube';
import { Logger } from './logger.js';

export interface DaemonContext {
  db: DbContext;
  log: Logger;
  youtube: YouTubeClient;
  llm: LlmClient;
  settings(): Settings;
  quotaState(): { used: number; limit: number };
}

/** DB 기반 quota 가드 — 예산 초과가 예상되면 호출 자체를 막는다 (§4.1) */
function createQuotaGuard(db: DbContext, settings: () => Settings): QuotaGuard {
  return {
    reserve(units) {
      const limit = settings()['yt.dailyQuota'];
      return getQuotaUsed(db) + units <= limit;
    },
    consume(units) {
      addQuotaUsage(db, units);
    },
  };
}

export function createContext(): DaemonContext {
  const env = loadEnv();
  const db = getDb(env.DATABASE_URL);
  runMigrations(db);
  seedDefaultSettings(db);
  seedDefaultKeywords(db, DEFAULT_KEYWORDS);

  const log = new Logger(db);
  const settings = () => getSettings(db);

  const youtube = new YouTubeClient({
    apiKey: env.YOUTUBE_API_KEY,
    quota: createQuotaGuard(db, settings),
    onLog: (level, message, meta) => log[level](message, meta),
  });

  const llm = new LlmClient({
    baseURL: env.GEMINI_BASE_URL,
    apiKey: env.GEMINI_API_KEY,
    model: env.LLM_MODEL,
    timeoutMs: env.LLM_TIMEOUT_MS,
    onLog: (level, message, meta) => log[level](message, meta),
  });

  return {
    db,
    log,
    youtube,
    llm,
    settings,
    quotaState: () => ({ used: getQuotaUsed(db), limit: settings()['yt.dailyQuota'] }),
  };
}

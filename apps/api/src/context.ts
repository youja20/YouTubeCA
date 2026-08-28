import {
  getDb,
  runMigrations,
  seedDefaultKeywords,
  seedDefaultSettings,
  type DbContext,
} from '@youtubeca/db';
import { LlmClient } from '@youtubeca/llm';
import { DEFAULT_KEYWORDS } from '@youtubeca/shared';
import { loadEnvLoose } from '@youtubeca/shared/env';

export interface ApiContext {
  db: DbContext;
  llm: LlmClient | null;
}

export interface CreateApiContextOptions {
  databaseUrl?: string;
  /** 테스트에서 마이그레이션만 돌리고 LLM 연결은 생략할 때 */
  withLlm?: boolean;
}

export function createApiContext(options: CreateApiContextOptions = {}): ApiContext {
  const env = loadEnvLoose();
  const db = getDb(options.databaseUrl ?? env.DATABASE_URL);
  runMigrations(db);
  seedDefaultSettings(db);
  seedDefaultKeywords(db, DEFAULT_KEYWORDS);

  const withLlm = options.withLlm ?? true;
  const llm =
    withLlm && env.GEMINI_API_KEY
      ? new LlmClient({
          baseURL: env.GEMINI_BASE_URL,
          apiKey: env.GEMINI_API_KEY,
          model: env.LLM_MODEL,
          maxRetries: 1,
        })
      : null;

  return { db, llm };
}

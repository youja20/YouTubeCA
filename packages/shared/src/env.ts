import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 모노레포 루트를 찾아 .env를 로드한다 (apps/* 어디서 실행하든 동일하게 동작) */
export function findRepoRoot(from = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 패키지 내부에서 실행된 경우 이 파일 위치 기준으로 역추적
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../..');
}

export const REPO_ROOT = findRepoRoot();

let dotenvLoaded = false;
function ensureDotenv(): void {
  if (dotenvLoaded) return;
  loadDotenv({ path: join(REPO_ROOT, '.env') });
  dotenvLoaded = true;
}

/**
 * 외부 서비스 자격증명만 환경변수로 관리한다 (부록 A).
 * 누락 시 기동 실패시키되, 어떤 값이 비었는지 한국어로 알려준다.
 */
const envSchema = z.object({
  YOUTUBE_API_KEY: z.string().min(1, 'YOUTUBE_API_KEY 가 비어 있습니다 (.env 확인)'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY 가 비어 있습니다 (.env 확인)'),
  /** 비우면 CODE_DEFAULTS.llmBaseUrl (Gemini OpenAI 호환 엔드포인트)을 쓴다 */
  GEMINI_BASE_URL: z
    .string()
    .url('GEMINI_BASE_URL 이 올바른 URL이 아닙니다')
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
  /** 비우면 CODE_DEFAULTS.llmModel을 쓴다 */
  LLM_MODEL: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  PORT: z.coerce.number().int().positive().optional(),
  DATABASE_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(1_800_000).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  ensureDotenv();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`);
    throw new Error(`환경변수 설정이 올바르지 않습니다.\n${lines.join('\n')}\n\n.env.example을 참고해 .env를 채워주세요.`);
  }
  cached = parsed.data;
  return cached;
}

/** YouTube 키 없이도 동작해야 하는 도구(마이그레이션 등)를 위한 느슨한 로더 */
export function loadEnvLoose(): Partial<Env> {
  ensureDotenv();
  return envSchema.partial().parse(process.env);
}

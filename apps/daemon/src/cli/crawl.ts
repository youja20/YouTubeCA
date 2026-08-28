/**
 * 단일 키워드 CLI 실행 (부록 B)
 *   pnpm --filter @youtubeca/daemon crawl -- --keyword "무선이어폰"
 * 데몬을 거치지 않고 파이프라인을 인라인 실행한다 (M1 검증용).
 */
import { parseArgs } from 'node:util';
import { createRun, createKeyword, getKeywordByName, listKeywords } from '@youtubeca/db';
import { STAGES, type Stage } from '@youtubeca/shared';
import { createContext } from '../context.js';
import { executeRun } from '../pipeline/run.js';

const { values } = parseArgs({
  options: {
    keyword: { type: 'string', short: 'k', multiple: true },
    all: { type: 'boolean' },
    create: { type: 'boolean', default: true },
    stages: { type: 'string', short: 's' },
  },
  allowPositionals: true,
});

const ctx = createContext();

const keywordIds: number[] = [];

if (values.all) {
  for (const keyword of listKeywords(ctx.db, { sort: 'updated', activeOnly: true })) {
    keywordIds.push(keyword.id);
  }
} else {
  const names = values.keyword ?? [];
  if (names.length === 0) {
    console.error('사용법: crawl --keyword "키워드" [--keyword "키워드2"] | --all');
    process.exit(1);
  }
  for (const name of names) {
    const existing = getKeywordByName(ctx.db, name.trim());
    if (existing) {
      keywordIds.push(existing.id);
      continue;
    }
    if (!values.create) {
      console.error(`등록되지 않은 키워드입니다: ${name}`);
      process.exit(1);
    }
    const created = createKeyword(ctx.db, { name: name.trim() });
    console.log(`키워드 등록: ${created.name} (#${created.id})`);
    keywordIds.push(created.id);
  }
}

if (keywordIds.length === 0) {
  console.error('실행할 키워드가 없습니다');
  process.exit(1);
}

const stages = values.stages
  ? (values.stages
      .split(',')
      .map((v) => v.trim())
      .filter((v): v is Stage => (STAGES as readonly string[]).includes(v)))
  : undefined;
if (values.stages && (!stages || stages.length === 0)) {
  console.error(`유효한 스테이지가 없습니다. 사용 가능: ${STAGES.join(', ')}`);
  process.exit(1);
}

const run = createRun(ctx.db, { keywordIds, trigger: 'manual', stages });
console.log(`Run #${run.id} 시작 (키워드 ${keywordIds.length}개${stages ? `, 스테이지 ${stages.join('→')}` : ''})\n`);

const result = await executeRun(ctx, run.id);
console.log(`\nRun #${run.id} 종료: ${result.outcome}${result.error ? ` — ${result.error}` : ''}`);
const quota = ctx.quotaState();
console.log(`오늘 YouTube quota 사용량: ${quota.used} / ${quota.limit}`);

ctx.db.close();
process.exit(result.outcome === 'done' ? 0 : 1);

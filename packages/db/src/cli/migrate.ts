import { DEFAULT_KEYWORDS } from '@youtubeca/shared';
import { getDb } from '../client.js';
import { runMigrations } from '../migrate.js';
import { seedDefaultKeywords } from '../repositories/keywords.js';
import { seedDefaultSettings } from '../repositories/settings.js';

const ctx = getDb();
const result = runMigrations(ctx);
seedDefaultSettings(ctx);
const seed = seedDefaultKeywords(ctx, DEFAULT_KEYWORDS);

console.log(`DB: ${ctx.path}`);
if (result.applied.length > 0) console.log(`적용됨: ${result.applied.join(', ')}`);
else console.log('적용할 마이그레이션이 없습니다 (최신 상태)');

if (seed.created.length > 0) {
  console.log(`기본 키워드 ${seed.created.length}개 등록: ${seed.created.map((k) => k.name).join(', ')}`);
  console.log('수집은 설정뷰의 [전체 실행] 또는 `pnpm crawl --all`로 시작하세요.');
}
ctx.close();

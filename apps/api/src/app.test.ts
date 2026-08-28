import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommentDto, KeywordViewResponse, RunDto, TagViewResponse } from '@youtubeca/shared';
import { buildApp } from './app.js';
import { createTestContext, type SeedResult } from './testing.js';

let app: FastifyInstance;
let seed: SeedResult;

const json = <T>(payload: string): { data: T; meta?: { total?: number; cursor?: string | null } } =>
  JSON.parse(payload) as { data: T; meta?: { total?: number; cursor?: string | null } };

beforeAll(async () => {
  seed = createTestContext();
  app = await buildApp({ context: seed.ctx, logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  seed.db.close();
});

describe('GET /keywords', () => {
  it('키워드 목록을 반환한다', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/keywords' });
    expect(response.statusCode).toBe(200);
    const body = json<{ name: string; commentCount: number }[]>(response.payload);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.name).toBe('무선이어폰');
    expect(body.data[0]!.commentCount).toBe(4);
  });
});

describe('POST /keywords — 등록 시 자동 크롤링 (§7.4 ①)', () => {
  it('등록과 동시에 해당 키워드의 Run을 큐에 넣는다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/keywords',
      payload: { name: '자동실행테스트' },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload) as { data: { id: number }; meta: { runId: number } };
    expect(body.meta.runId).toBeGreaterThan(0);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/runs/${body.meta.runId}` });
    const run = JSON.parse(detail.payload) as {
      data: { keywordIds: number[]; stages: unknown[]; status: string };
    };
    expect(run.data.keywordIds).toEqual([body.data.id]);
    expect(run.data.status).toBe('queued');
    expect(run.data.stages).toHaveLength(5);
  });

  it('일괄 등록은 새로 만든 키워드만 하나의 Run으로 묶는다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/keywords/bulk',
      payload: { names: ['일괄A', '일괄B', '무선이어폰'] },
    });
    const body = JSON.parse(response.payload) as {
      data: { id: number }[];
      meta: { runId: number; total: number };
      duplicated: string[];
    };
    expect(body.meta.total).toBe(2);
    expect(body.duplicated).toEqual(['무선이어폰']);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/runs/${body.meta.runId}` });
    const run = JSON.parse(detail.payload) as { data: { keywordIds: number[] } };
    expect(run.data.keywordIds).toEqual(body.data.map((k) => k.id));
  });

  it('autoRun:false면 Run을 만들지 않는다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/keywords',
      payload: { name: '수동등록', autoRun: false },
    });
    expect(JSON.parse(response.payload).meta.runId).toBeNull();
  });

  it('crawl.autoRunOnRegister 설정이 꺼져 있으면 Run을 만들지 않는다', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { 'crawl.autoRunOnRegister': false },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/keywords',
      payload: { name: '설정으로끔' },
    });
    expect(JSON.parse(response.payload).meta.runId).toBeNull();

    // 요청 단위 override는 설정보다 우선한다
    const override = await app.inject({
      method: 'POST',
      url: '/api/v1/keywords',
      payload: { name: '설정꺼도강제실행', autoRun: true },
    });
    expect(JSON.parse(override.payload).meta.runId).toBeGreaterThan(0);

    await app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { 'crawl.autoRunOnRegister': true },
    });
  });
});

describe('POST /keywords', () => {
  it('중복 키워드는 409를 반환한다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/keywords',
      payload: { name: '무선이어폰' },
    });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.payload).error.code).toBe('CONFLICT');
  });

  it('빈 이름은 400을 반환한다', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/keywords', payload: { name: '  ' } });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /keywords/:id — 키워드뷰 집계', () => {
  it('통계·태그·샘플 댓글을 한 번에 반환한다', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/v1/keywords/${seed.keywordId}` });
    expect(response.statusCode).toBe(200);
    const view = json<KeywordViewResponse>(response.payload).data;

    expect(view.keyword.name).toBe('무선이어폰');
    expect(view.stats.commentCount).toBe(4);
    expect(view.stats.videoCount).toBe(1);
    expect(view.tags.map((t) => t.name)).toEqual(['가성비', '음질', '배터리']);
    expect(view.tags[0]!.strength).toBe(100);
    expect(view.analysis).toBeNull();

    const samples = view.sampleComments[seed.tagIds['가성비']!];
    expect(samples?.length).toBe(2);
    expect(samples?.[0]!.url).toMatch(/youtube\.com\/watch\?v=vid1&lc=/);
  });

  it('없는 키워드는 404를 반환한다', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/keywords/99999' });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /tags/:id — 태그뷰', () => {
  it('관련 키워드와 대표 댓글을 반환한다', async () => {
    const tagId = seed.tagIds['음질']!;
    const response = await app.inject({ method: 'GET', url: `/api/v1/tags/${tagId}` });
    const view = json<TagViewResponse>(response.payload).data;

    expect(view.tag.name).toBe('음질');
    expect(view.keywords[0]!.name).toBe('무선이어폰');
    expect(view.topComments).toHaveLength(2);
    expect(view.topComments[0]!.likeCount).toBeGreaterThanOrEqual(view.topComments[1]!.likeCount);
    expect(view.topComments[0]!.keywordName).toBe('무선이어폰');
  });
});

describe('GET /comments — 커멘트뷰', () => {
  it('tagId와 keywordId가 모두 없으면 400을 반환한다', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/comments' });
    expect(response.statusCode).toBe(400);
  });

  it('태그로 필터링하고 좋아요순으로 정렬한다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/comments?tagId=${seed.tagIds['가성비']}&sort=likes`,
    });
    const body = json<CommentDto[]>(response.payload);
    expect(body.meta?.total).toBe(2);
    expect(body.data.map((c) => c.id)).toEqual(['c1', 'c4']);
    expect(body.data[0]!.matchedTags.map((t) => t.name)).toContain('가성비');
  });

  it('감성 필터가 동작한다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/comments?keywordId=${seed.keywordId}&sentiment=negative`,
    });
    const body = json<CommentDto[]>(response.payload);
    expect(body.data.every((c) => (c.sentimentScore ?? 0) <= -0.15)).toBe(true);
    expect(body.data.map((c) => c.id)).toContain('c2');
  });

  it('커서 페이지네이션이 동작한다', async () => {
    const first = await app.inject({
      method: 'GET',
      url: `/api/v1/comments?keywordId=${seed.keywordId}&limit=2`,
    });
    const firstBody = json<CommentDto[]>(first.payload);
    expect(firstBody.data).toHaveLength(2);
    expect(firstBody.meta?.cursor).toBeTruthy();

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/comments?keywordId=${seed.keywordId}&limit=2&cursor=${encodeURIComponent(firstBody.meta!.cursor!)}`,
    });
    const secondBody = json<CommentDto[]>(second.payload);
    const firstIds = firstBody.data.map((c) => c.id);
    expect(secondBody.data.every((c) => !firstIds.includes(c.id))).toBe(true);
  });
});

describe('POST /runs', () => {
  it('실행을 큐에 넣고 스테이지를 생성한다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { keywordIds: [seed.keywordId] },
    });
    expect(response.statusCode).toBe(201);
    const run = json<RunDto>(response.payload).data;
    expect(run.status).toBe('queued');

    const detail = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}` });
    const body = JSON.parse(detail.payload) as { data: { stages: unknown[] } };
    expect(body.data.stages).toHaveLength(5);

    const jobs = seed.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs WHERE run_id = ?').get(run.id) as {
      n: number;
    };
    expect(jobs.n).toBe(1);
  });

  it('일부 스테이지만 지정하면 그 스테이지만 등록된다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { keywordIds: [seed.keywordId], stages: ['extract', 'score', 'analyze'] },
    });
    const run = json<RunDto>(response.payload).data;
    const detail = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}` });
    const body = JSON.parse(detail.payload) as { data: { stages: { stage: string }[] } };
    expect(body.data.stages.map((s) => s.stage).sort()).toEqual(['analyze', 'extract', 'score']);
  });

  it('취소 요청이 반영된다', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { keywordIds: [seed.keywordId] },
    });
    const run = json<RunDto>(created.payload).data;
    const cancel = await app.inject({ method: 'POST', url: `/api/v1/runs/${run.id}/cancel` });
    expect(cancel.statusCode).toBe(200);

    const row = seed.db.sqlite.prepare('SELECT cancel_requested FROM runs WHERE id = ?').get(run.id) as {
      cancel_requested: number;
    };
    expect(row.cancel_requested).toBe(1);
  });
});

describe('설정 / 헬스', () => {
  it('설정을 조회하고 부분 수정한다', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/v1/settings' });
    expect(JSON.parse(before.payload).data['yt.maxVideosPerKeyword']).toBe(20);

    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { 'yt.maxVideosPerKeyword': 15 },
    });
    expect(JSON.parse(patched.payload).data['yt.maxVideosPerKeyword']).toBe(15);
    // 지정하지 않은 값은 유지된다
    expect(JSON.parse(patched.payload).data['yt.minCommentCount']).toBe(100);
  });

  it('범위를 벗어난 설정은 400을 반환한다', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { 'scoring.wFreq': 5 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('헬스 응답에 DB·quota·데몬 상태가 포함된다', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    const health = JSON.parse(response.payload).data;
    expect(health.db.keywords).toBeGreaterThan(0);
    expect(health.youtube.quotaLimit).toBe(10000);
    expect(health.daemon.alive).toBe(false);
  });
});

describe('오류 규격', () => {
  it('없는 API 경로는 통일된 오류 포맷을 반환한다', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.payload)).toEqual({
      error: { code: 'NOT_FOUND', message: expect.stringContaining('/api/v1/nope') },
    });
  });
});

/** 파이프라인 스테이지 (실행 순서) */
export const STAGES = ['discover', 'collect', 'extract', 'score', 'analyze'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  discover: '영상 탐색',
  collect: '댓글 수집',
  extract: '태그 추출',
  score: '강도 산출',
  analyze: 'AI 분석',
};

export const RUN_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'cancelled',
  'paused_quota',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** 태그 카테고리 (§4.2 3-2) */
export const TAG_CATEGORIES = [
  '품질',
  '가격',
  '디자인',
  '감정',
  '신뢰',
  '성능',
  '서비스',
  '기타',
] as const;
export type TagCategory = (typeof TAG_CATEGORIES)[number];

/** YouTube Data API v3 호출 단가 (quota units) */
export const QUOTA_COST = {
  search: 100,
  videos: 1,
  commentThreads: 1,
} as const;

/**
 * 최초 기동 시 자동 등록되는 기본 키워드 (§7.4 ①)
 * config의 seed.defaultKeywordsAt로 1회만 적용되며, 이후 사용자가 지운 키워드는 되살아나지 않는다.
 */
export const DEFAULT_KEYWORDS = [
  '갤럭시 폴드 8',
  '아이폰 폴드',
  '뉴진스',
  '에스파',
  'BTS',
  '독도 토너',
  '호호바 오일',
  '클리오',
] as const;

/** 설정 기본값 — config 테이블 값으로 덮어써진다 (부록 A-1) */
export const DEFAULT_SETTINGS = {
  'yt.dailyQuota': 10000,
  'yt.maxVideosPerKeyword': 20,
  'yt.maxCommentsPerVideo': 500,
  'yt.minCommentCount': 100,
  'yt.relevanceLanguage': 'ko',
  'scoring.wFreq': 0.4,
  'scoring.wDistinct': 0.25,
  'scoring.wEngage': 0.15,
  'scoring.wIntensity': 0.2,
  'cron.enabled': false,
  'cron.schedule': '0 3 * * *',
  /** 키워드 등록 즉시 해당 키워드 크롤링 Run을 큐에 넣는다 (§7.4 ①) */
  'crawl.autoRunOnRegister': true,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

/** 코드 기본값 (설정뷰에서 변경하지 않음) */
export const CODE_DEFAULTS = {
  port: 3200,
  databaseUrl: './data/youtubeca.db',
  /** Gemini OpenAI 호환 엔드포인트 (GEMINI_BASE_URL로 재정의 가능) */
  llmBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  /** 기본 모델. LLM_MODEL로 재정의한다 (§4.4) */
  llmModel: 'gemini-3.7-flash',
  llmTimeoutMs: 120_000,
  daemonPollIntervalMs: 2000,
  /**
   * 하트비트 주기. 잡 실행은 수 분이 걸리므로 루프와 무관하게 이 주기로 갱신해야
   * API가 데몬을 죽은 것으로 오판하지 않는다(§6 DAEMON_ALIVE_MS = 30초).
   */
  daemonHeartbeatIntervalMs: 5000,
  daemonConcurrency: 1,
  /**
   * 좀비 잡 회수 임계. 워커가 살아 있는 동안 locked_at을 하트비트 주기로 갱신하므로
   * 잡의 실제 소요 시간과 무관하게 짧게 잡을 수 있다. 길게 잡으면 데몬이 크롤링
   * 도중 재시작했을 때 그동안 UI가 "진행 중"으로 잠긴 채 방치된다.
   */
  jobLockTimeoutMs: 60 * 1000,
} as const;

/** 태그 추출 파라미터 (§4.2) */
export const EXTRACTION = {
  /** 통계 후보 상위 N개를 LLM에 전달 */
  candidateLimit: 200,
  /** LLM이 확정할 최종 태그 수 범위 */
  minTags: 30,
  maxTags: 50,
  /** 후보당 LLM에 함께 보낼 대표 댓글 수 */
  sampleCommentsPerCandidate: 3,
  /**
   * 대표 댓글을 함께 보낼 상위 후보 수.
   * 200개 후보 전부에 샘플을 붙이면 프롬프트가 수만 토큰이 되어
   * 응답 지연과 비용이 함께 커진다 (§4.2 "총 토큰 제한 내").
   */
  sampleCandidateLimit: 60,
  /** n-gram 폴백 최대 길이 */
  maxNgram: 3,
} as const;

/** 관련 키워드 (§4.3) */
export const RELATION = {
  topK: 8,
  minSimilarity: 0.15,
  /** 키워드가 이 수 미만이면 관련 키워드 섹션 숨김 */
  minKeywordsForSection: 3,
} as const;

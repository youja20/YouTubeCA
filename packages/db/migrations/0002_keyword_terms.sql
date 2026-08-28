-- 통계 후보 추출용 term 통계 (§4.2 3-1의 IDF 계산에 필요)
-- 키워드 간 코퍼스 비교를 매번 재토크나이징하지 않도록 키워드별 상위 term을 보존한다.
CREATE TABLE IF NOT EXISTS keyword_terms (
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  comment_count INTEGER NOT NULL DEFAULT 0,
  tf REAL NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (keyword_id, term)
);
CREATE INDEX IF NOT EXISTS idx_keyword_terms_term ON keyword_terms(term);

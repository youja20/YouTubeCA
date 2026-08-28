-- YouTubeCA 초기 스키마 (계획서 §5.1)

CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_crawled_at TEXT,
  comment_count INTEGER NOT NULL DEFAULT 0,
  video_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_keywords_name ON keywords(name);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT,
  channel_id TEXT,
  channel_title TEXT,
  published_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  thumbnail_url TEXT,
  video_score REAL,
  comments_disabled INTEGER NOT NULL DEFAULT 0,
  last_collected_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS keyword_videos (
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL DEFAULT 0,
  score REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (keyword_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_kv_video ON keyword_videos(video_id);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  parent_id TEXT,
  author TEXT,
  author_channel_id TEXT,
  text_original TEXT NOT NULL,
  text_normalized TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  updated_at_source TEXT,
  lang TEXT,
  sentiment_score REAL,
  collected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
CREATE INDEX IF NOT EXISTS idx_comments_likes ON comments(like_count DESC);

-- 전문검색 (커멘트뷰 본문 검색)
CREATE VIRTUAL TABLE IF NOT EXISTS comments_fts
  USING fts5(text_normalized, content='comments', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS comments_ai AFTER INSERT ON comments BEGIN
  INSERT INTO comments_fts(rowid, text_normalized) VALUES (new.rowid, new.text_normalized);
END;
CREATE TRIGGER IF NOT EXISTS comments_ad AFTER DELETE ON comments BEGIN
  INSERT INTO comments_fts(comments_fts, rowid, text_normalized)
    VALUES ('delete', old.rowid, old.text_normalized);
END;
CREATE TRIGGER IF NOT EXISTS comments_au AFTER UPDATE ON comments BEGIN
  INSERT INTO comments_fts(comments_fts, rowid, text_normalized)
    VALUES ('delete', old.rowid, old.text_normalized);
  INSERT INTO comments_fts(rowid, text_normalized) VALUES (new.rowid, new.text_normalized);
END;

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  polarity REAL,
  total_comment_count INTEGER NOT NULL DEFAULT 0,
  keyword_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

CREATE TABLE IF NOT EXISTS tag_aliases (
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  match_key TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_aliases_key ON tag_aliases(match_key);
CREATE INDEX IF NOT EXISTS idx_tag_aliases_tag ON tag_aliases(tag_id);

CREATE TABLE IF NOT EXISTS keyword_tags (
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  strength INTEGER NOT NULL DEFAULT 0,
  raw_score REAL NOT NULL DEFAULT 0,
  polarity REAL NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  freq REAL NOT NULL DEFAULT 0,
  distinct_score REAL NOT NULL DEFAULT 0,
  engage REAL NOT NULL DEFAULT 0,
  intensity REAL NOT NULL DEFAULT 0,
  run_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (keyword_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_kt_tag_raw ON keyword_tags(tag_id, raw_score DESC);
CREATE INDEX IF NOT EXISTS idx_kt_keyword_strength ON keyword_tags(keyword_id, strength DESC);

CREATE TABLE IF NOT EXISTS comment_tags (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  weight REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (comment_id, tag_id, keyword_id)
);
CREATE INDEX IF NOT EXISTS idx_ct_tag_kw ON comment_tags(tag_id, keyword_id);
CREATE INDEX IF NOT EXISTS idx_ct_keyword ON comment_tags(keyword_id);

CREATE TABLE IF NOT EXISTS keyword_relations (
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  related_keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  similarity REAL NOT NULL,
  shared_tags TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (keyword_id, related_keyword_id)
);

CREATE TABLE IF NOT EXISTS keyword_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  run_id INTEGER,
  model TEXT NOT NULL,
  payload TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_analyses_keyword ON keyword_analyses(keyword_id, created_at DESC);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'queued',
  keyword_ids TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS run_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  keyword_id INTEGER,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_stages_run ON run_stages(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_stages_unique ON run_stages(run_id, keyword_id, stage);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_at TEXT,
  locked_by TEXT,
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, available_at);

CREATE TABLE IF NOT EXISTS run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  keyword_id INTEGER,
  stage TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  meta TEXT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_run_logs_run ON run_logs(run_id, id DESC);

CREATE TABLE IF NOT EXISTS quota_usage (
  date TEXT PRIMARY KEY,
  units_used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS daemon_state (
  id INTEGER PRIMARY KEY,
  last_seen_at TEXT,
  current_job_id INTEGER,
  version TEXT
);
INSERT OR IGNORE INTO daemon_state(id, last_seen_at) VALUES (1, NULL);

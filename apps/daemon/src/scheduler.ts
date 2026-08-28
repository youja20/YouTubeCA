import cron, { type ScheduledTask } from 'node-cron';
import { createRun, listKeywords } from '@youtubeca/db';
import type { DaemonContext } from './context.js';

/** 설정뷰에서 on/off 하는 자동 실행 (§8.2) — 기본 off */
export class CronScheduler {
  private task: ScheduledTask | undefined;
  private current: { enabled: boolean; schedule: string } = { enabled: false, schedule: '' };
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly ctx: DaemonContext) {}

  start(): void {
    this.sync();
    // 설정뷰에서 변경한 값을 반영하기 위해 주기적으로 재확인한다
    this.timer = setInterval(() => this.sync(), 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.task?.stop();
    this.task = undefined;
  }

  private sync(): void {
    const settings = this.ctx.settings();
    const enabled = settings['cron.enabled'];
    const schedule = settings['cron.schedule'];
    if (enabled === this.current.enabled && schedule === this.current.schedule) return;

    this.task?.stop();
    this.task = undefined;
    this.current = { enabled, schedule };

    if (!enabled) {
      this.ctx.log.info('자동 실행(cron) 비활성화됨');
      return;
    }
    if (!cron.validate(schedule)) {
      this.ctx.log.error(`cron 표현식이 올바르지 않습니다: ${schedule}`);
      return;
    }

    this.task = cron.schedule(schedule, () => this.trigger(), { timezone: 'Asia/Seoul' });
    this.ctx.log.info(`자동 실행 예약됨: ${schedule} (Asia/Seoul)`);
  }

  private trigger(): void {
    const keywords = listKeywords(this.ctx.db, { sort: 'updated', activeOnly: true });
    if (keywords.length === 0) {
      this.ctx.log.warn('자동 실행: 활성 키워드가 없어 건너뜁니다');
      return;
    }
    const run = createRun(this.ctx.db, {
      keywordIds: keywords.map((k) => k.id),
      trigger: 'scheduled',
    });
    this.ctx.log.info(`자동 실행 시작 — Run #${run.id} (키워드 ${keywords.length}개)`);
  }
}

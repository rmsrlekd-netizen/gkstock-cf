// 10분마다 실행되는 SEC 수집기 (Cloudflare Cron Trigger)
import { runSecWatch } from '../lib/sec-core.mjs';

export default async () => {
  try {
    const r = await runSecWatch();
    console.log('sec-watch', JSON.stringify(r));
  } catch (e) {
    console.error('sec-watch failed', e);
  }
};

export const config = { schedule: '*/10 * * * *' };

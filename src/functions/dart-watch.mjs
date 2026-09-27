// 10분마다 실행되는 DART 수집기 (Cloudflare Cron Trigger)
import { runDartWatch } from '../lib/dart-core.mjs';

export default async () => {
  try {
    const r = await runDartWatch();
    console.log('dart-watch', JSON.stringify(r));
  } catch (e) {
    console.error('dart-watch failed', e);
  }
};

export const config = { schedule: '*/10 * * * *' };

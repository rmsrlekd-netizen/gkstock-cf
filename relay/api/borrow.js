// IBKR(인터랙티브 브로커스) 공매도 가능 수량·대차 수수료 — IBKR가 누구나 받을 수 있게 공개하는 FTP 파일(usa.txt, 약 15분마다 갱신)
//  Cloudflare Worker는 FTP 접속을 못 해서 이 중계 서버가 받아서 JSON으로 넘겨줌
//  응답: { at, n, d: { SYM: [가능수량, 수수료%, 리베이트%] } }  (가능수량 >10,000,000 은 10000000 으로)
import net from 'node:net';

const HOSTS = ['ftp2.interactivebrokers.com', 'ftp3.interactivebrokers.com'];

function ftpGet(host, file, ms = 25000) {
  return new Promise((resolve, reject) => {
    const ctl = net.connect(21, host);
    const timer = setTimeout(() => { ctl.destroy(); reject(new Error('FTP 시간 초과')); }, ms);
    let buf = '', step = 0;
    const done = (e, v) => { clearTimeout(timer); try { ctl.end('QUIT\r\n'); } catch {} ctl.destroy(); e ? reject(e) : resolve(v); };
    const send = (s) => ctl.write(s + '\r\n');
    ctl.setEncoding('utf8');
    ctl.on('error', (e) => done(e));
    ctl.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!/^\d{3} /.test(line)) continue; // 여러 줄 응답의 중간 줄
        const code = Number(line.slice(0, 3));
        if (code >= 400) return done(new Error('FTP ' + line));
        if (step === 0 && code === 220) { step = 1; send('USER shortstock'); }
        else if (step === 1 && code === 331) { step = 2; send('PASS '); }
        else if (step === 1 && code === 230) { step = 3; send('TYPE I'); }
        else if (step === 2 && code === 230) { step = 3; send('TYPE I'); }
        else if (step === 3 && code === 200) { step = 4; send('PASV'); }
        else if (step === 4 && code === 227) {
          const m = line.match(/(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
          if (!m) return done(new Error('PASV 응답 오류'));
          const port = Number(m[5]) * 256 + Number(m[6]);
          const parts = [];
          const data = net.connect(port, `${m[1]}.${m[2]}.${m[3]}.${m[4]}`);
          data.on('data', (b) => parts.push(b));
          data.on('error', (e) => done(e));
          data.on('end', () => done(null, Buffer.concat(parts).toString('utf8')));
          step = 5; send('RETR ' + file);
        }
      }
    });
  });
}

const num = (s) => { const v = Number(String(s || '').replace(/[>,]/g, '')); return Number.isFinite(v) ? v : null; };

export async function GET(req) {
  const token = process.env.RELAY_TOKEN || '';
  if (!token || req.headers.get('x-relay-token') !== token) return new Response('forbidden', { status: 403 });
  let text = null, err = null;
  for (const h of HOSTS) { try { text = await ftpGet(h, 'usa.txt'); if (text && text.length > 10000) break; } catch (e) { err = e; } }
  if (!text) return new Response('borrow error: ' + (err?.message || '없음'), { status: 502 });
  const d = {};
  let at = null;
  for (const line of text.split('\n')) {
    const c = line.split('|');
    if (c[0] === '#BOF') { at = `${c[1]} ${c[2]}`.trim(); continue; }
    if (!c[0] || c[0].startsWith('#') || c.length < 8) continue;
    const sym = c[0].trim().toUpperCase().replace(/ /g, '.');
    if (!/^[A-Z][A-Z.]{0,6}$/.test(sym)) continue;
    const avail = num(c[7]);
    if (avail == null) continue;
    d[sym] = [Math.min(avail, 10000000), num(c[6]), num(c[5])];
  }
  const gz = await new Response(new Blob([JSON.stringify({ at, n: Object.keys(d).length, d })]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return new Response(gz, { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'cache-control': 'no-store' } });
}

import { parseGooglePage } from '../src/lib/gfin.mjs';
const html = `data:[[[["/m/04w0nf",["KOSPI","KRX"],"KOSPI",1,null,[7080.92,63.009766,0.8978423,2,2,2],null,7017.91,null]]]]
[["/m/x",[".INX","INDEXSP"],"S\\u0026P 500",1,null,[7743.41,39.280273,0.50986,2,2,2],null,7704.13,null]]
[["/g/11fk1qp2qr",["247540","KOSDAQ"],"에코프로비엠",0,"KRW",[105000,700,0.67114097,2,2,2],null,104300,"#003894"]]
data:[[[["/g/11bvvzrzcd",null,"USD / KRW",3,null,[1354.78922,-13.57078,-0.991755,4,4,2],null,1368.36,null,null,null,[1790370139],null,0]]]]`;
const q = parseGooglePage(html);
console.log(q);
if (!q['KOSPI:KRX'] || q['.INX:INDEXSP'].name !== 'S&P 500' || q['247540:KOSDAQ'].price !== 105000 || q['USD-KRW'].prev !== 1368.36) { console.error('FAIL'); process.exit(1); }
console.log('PASS');

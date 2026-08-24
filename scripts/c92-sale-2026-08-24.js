// 하우스귤 특가(2026-08-24 대표 GO): 카페24 c92 결제가 = 네이버 실시간 집합으로 맞춤
require('dotenv').config();
const {Client}=require('pg');
async function flag(c,req,ms=120000){await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);await c.query(`INSERT INTO agent_office_config(key,value) VALUES('cafe24_product_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[JSON.stringify(req)]);const t0=Date.now();while(Date.now()-t0<ms){await new Promise(r=>setTimeout(r,4000));const q=await c.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`);if(q.rows.length)return q.rows[0].value;}throw new Error('timeout');}
const BASE=23800; // 네이버 최종가 32,800 + min(-9,000)
const TARGET={ // 네이버 실시간 결제가(2026-08-24 12:0x 조회)
 P00000DO000B:32800, P00000DO000C:23800, P00000DO000D:38800, P00000DO000E:51800, P00000DO000F:39800, P00000DO000G:41800,
 P00000DO000H:37800, P00000DO000I:57800, P00000DO000J:42800, P00000DO000K:62800 };
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await c.connect();
const r1=await flag(c,{action:'raw',method:'PUT',path:'/api/v2/admin/products/92',body:{shop_no:1,request:{price:BASE}}});
console.log('base PUT →',JSON.stringify(r1).slice(0,200));
for(const [code,pay] of Object.entries(TARGET)){const add=pay-BASE;const r=await flag(c,{action:'raw',method:'PUT',path:`/api/v2/admin/products/92/variants/${code}`,body:{shop_no:1,request:{additional_amount:String(add)}}});const ok=r.raw&&r.raw.status<300||/additional_amount/.test(JSON.stringify(r));console.log(ok?'✅':'❌',code,'+'+add,'→',pay, ok?'':JSON.stringify(r).slice(0,200));}
// 재조회 검산
const pr=await flag(c,{action:'raw',method:'GET',path:'/api/v2/admin/products/92',query:{fields:'product_no,price'}});const base=Number(pr.raw.data.product.price);
const vr=await flag(c,{action:'raw',method:'GET',path:'/api/v2/admin/products/92/variants'});let bad=0;
for(const v of vr.raw.data.variants){const pay=base+Number(v.additional_amount);const t=TARGET[v.variant_code];const ok=pay===t;if(!ok)bad++;console.log(ok?'✅':'❌',v.variant_code,v.options[0].value.slice(-22),'결제가',pay,'목표',t);}
console.log(bad?`❌ 불일치 ${bad}`:'✅ c92 10종 결제가 = 네이버 실시간 집합 일치 (기본가 '+base+')');
await c.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name,created_at) VALUES('update','cafe24_product','92',$1,'cafe24-api','클코(대표 GO — 하우스귤 소과 특가)',NOW())`,[JSON.stringify({before:{price:26800,note:'소과 2.5/4.5 = 26,800/45,800'},after:{price:BASE,variants:TARGET}})]).catch(e=>console.log('audit skip',e.message));
await c.end();})().catch(e=>{console.error(e.message);process.exit(1)});

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { db } = await import('../server/src/db.ts');
const { publicApi } = await import('../server/src/routes/public.ts');
const { adminApi } = await import('../server/src/routes/admin.ts');

test('visitor counts deduplicate, handle returning users and protect overview', async () => {
  const visit = (body: unknown) => publicApi.request('/stats/visit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await adminApi.request('/overview')).status, 401);
  const token = 'a'.repeat(64);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(token, Date.now(), Date.now() + 60000);
  const overview = async () => {
    const res = await adminApi.request('/overview', { headers: { Cookie: `gpttest_admin_session=${token}` } });
    assert.equal(res.status, 200);
    return res.json();
  };
  assert.equal((await overview()).total_users, 0);
  for (const body of [null, {}, { anon_id: 'short' }, { anon_id: 'visitor-0001', api_key: 'must-not-store' }])
    assert.equal((await visit(body)).status, 400);
  assert.equal((await visit({ anon_id: 'visitor-0001' })).status, 200);
  assert.equal((await visit({ anon_id: 'visitor-0001' })).status, 200);
  assert.equal((await overview()).total_users, 1);
  assert.equal((await overview()).today_users, 1);
  const start = Math.floor((Date.now() + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
  db.prepare('INSERT INTO visitors VALUES (?, ?, ?)').run('visitor-0002', start - 1, start - 1);
  db.prepare('INSERT INTO visitors VALUES (?, ?, ?)').run('visitor-0003', start, start);
  assert.equal((await overview()).total_users, 3);
  assert.equal((await overview()).today_users, 2);
  await visit({ anon_id: 'visitor-0002' });
  assert.equal((await overview()).total_users, 3);
  assert.equal((await overview()).today_users, 3);
  assert.equal((db.prepare('SELECT first_seen_at FROM visitors WHERE anon_id=?').get('visitor-0002') as any).first_seen_at, start - 1);
  assert.equal((await overview()).total_tests, 0);
  db.close();
});

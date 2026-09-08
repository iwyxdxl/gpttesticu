// 判定逻辑离线自测：聚合 mock 流式输出 → 采样 → 计分，校验三种预期结论
import { takeSample, judge } from '../web/src/lib/judge.ts';

const DUMBED = ['内嵌SVG', '内联SVG', '连续的骑行动画', '循环的骑行动画', '循环骑行', '循环运动'];
const NORMAL = ['踩踏', '踩动脚踏', '沿途风景', '背景移动'];

async function collect(model: string): Promise<string> {
  const res = await fetch('http://localhost:9797/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: 'x' }),
  });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) {
        try {
          const evt = JSON.parse(line.slice(5));
          if (evt.type === 'response.output_text.delta') text += evt.delta;
        } catch {}
      }
    }
  }
  return text;
}

const expect: Record<string, string> = {
  'gpt-6astra-dumbed': 'dumbed',
  'gpt-6astra-normal': 'normal',
  'gpt-6astra-mystery': 'unknown',
};

let fail = 0;
for (const [model, want] of Object.entries(expect)) {
  const text = await collect(model);
  const { sample, stoppedBy } = takeSample(text, 3, 2000);
  const r = judge(sample, DUMBED, NORMAL);
  const ok = r.verdict === want;
  if (!ok) fail++;
  console.log(
    `${ok ? '✓' : '✗'} ${model}: verdict=${r.verdict} (期望 ${want}) dumbed=${r.dumbedScore} normal=${r.normalScore} stoppedBy=${stoppedBy} sampleLen=${sample.length}`
  );
  if (!ok) console.log('  sample 前200字:', sample.slice(0, 200));
}
process.exit(fail ? 1 : 0);

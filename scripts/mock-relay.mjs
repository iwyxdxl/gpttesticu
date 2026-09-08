// 本地 mock 中转站：模拟支持 CORS 的 OpenAI Responses 格式端点，用于端到端测试。
// 用法：node scripts/mock-relay.mjs  （监听 http://localhost:9797/v1）
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ref = fs.readFileSync(
  fileURLToPath(new URL('../server/src/assets/pelican-bike_gpt6astra_low.html', import.meta.url)),
  'utf8'
);

const DUMBED_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>骑行的鹈鹕</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#eef7f4;font-family:system-ui}svg{max-width:92vw}</style></head>
<body><svg viewBox="0 0 360 240" xmlns="http://www.w3.org/2000/svg">
<rect width="360" height="240" fill="#dff1ea"/>
<circle cx="90" cy="60" r="26" fill="#f7d98b"/>
<g stroke="#7fae9f" stroke-width="5" fill="none">
<circle cx="120" cy="180" r="34"/><circle cx="250" cy="180" r="34"/>
<path d="M120 180 L185 118 L250 180"/>
</g>
<g fill="#fff" stroke="#4a7a6a" stroke-width="3">
<ellipse cx="185" cy="96" rx="30" ry="24"/>
<path d="M210 92 l24 6 -22 8z" fill="#f2a13c" stroke="none"/>
<circle cx="178" cy="88" r="3" fill="#123"/>
</g>
<g stroke="#4a7a6a" stroke-width="4" fill="none">
<path d="M185 120 q-6 18 4 34"/>
<path d="M189 120 q10 16 6 34"/>
</g>
<script>
let a=0;
function f(){a+=0.04;document.querySelectorAll('circle').forEach(function(c){if(c.getAttribute('r')==='34'){c.setAttribute('transform','rotate('+(a*30)+' '+c.getAttribute('cx')+' '+c.getAttribute('cy')+')')}});requestAnimationFrame(f)}
f();
</script>
</svg></body></html>`;

const MYSTERY_HTML = DUMBED_HTML.replace('骑行的鹈鹕', '测试样本');

const TEXTS = {
  dumbed: `好的，我来创建一个 HTML，其中使用内嵌SVG 绘制一个鹈鹕骑自行车的 2D 动画。

这个内联SVG 将展示一个循环运动：车轮持续转动，构成连续的骑行动画。

整体采用循环骑行的表现方式，循环的骑行动画让画面保持流畅自然。

下面是完整代码：

\`\`\`html
${DUMBED_HTML}
\`\`\`

完成，直接保存为 html 打开即可。`,
  normal: `我来创建这个页面：鹈鹕的双腿踩踏踏板，通过链条带动后轮；沿途风景（云朵、草丛、路牌）向左移动，营造前进感。

车轮辐条与踏板围绕轴心旋转，踩动脚踏的节奏与轮速同步，背景移动速度与之匹配，避免“滑步”感。

围巾与帽檐加入轻微摆动，增强速度感。

\`\`\`html
${ref}
\`\`\`

直接打开即可播放，附带暂停与调速控件。`,
  mystery: `好的，收到任务，我先梳理实现思路。

我将分三步完成：先搭好 HTML 结构，再用 SVG 绘制场景元素，最后处理动画细节。

完成后会输出一个自包含的文件，无需任何外部依赖。

\`\`\`html
${MYSTERY_HTML}
\`\`\`

以上即可运行。`,
};

const server = http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,originator,version,session-id,thread-id,x-client-request-id,x-codex-window-id',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    return res.end(
      JSON.stringify({
        object: 'list',
        data: ['gpt-6astra-dumbed', 'gpt-6astra-mystery', 'gpt-6astra-normal', 'gpt-4o-mini'].map((id) => ({
          id,
          object: 'model',
        })),
      })
    );
  }
  if (req.method === 'POST' && url.pathname === '/v1/responses') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let model = '';
    try {
      model = JSON.parse(body).model || '';
    } catch {}
    const kind = /dumbed/.test(model) ? 'dumbed' : /mystery/.test(model) ? 'mystery' : 'normal';
    const text = TEXTS[kind];
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
    const send = (obj) => res.write(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`);
    send({ type: 'response.created', response: { id: 'resp_mock' } });
    const CHUNK = 36;
    for (let i = 0; i < text.length; i += CHUNK) {
      await new Promise((r) => setTimeout(r, 12));
      if (res.destroyed) return;
      send({ type: 'response.output_text.delta', delta: text.slice(i, i + CHUNK) });
    }
    send({ type: 'response.completed', response: { id: 'resp_mock' } });
    return res.end();
  }
  res.writeHead(404, cors);
  res.end('not found');
});

const port = Number(process.env.MOCK_PORT || 9797);
server.listen(port, '127.0.0.1', () => console.log(`mock relay on http://127.0.0.1:${port}/v1`));

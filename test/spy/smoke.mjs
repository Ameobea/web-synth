#!/usr/bin/env node
// Smoke test: engine boots through async wasm-bindgen init, no page exceptions.
import process from 'node:process';

const CDP_PORT = process.env.CDP_PORT || 9222;
const URL_HINT = process.env.URL_HINT || 'localhost:9000';

const tabs = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
const tab = tabs.find(t => t.type === 'page' && t.url.includes(URL_HINT));
if (!tab) {
  console.error(`no tab matching '${URL_HINT}'`);
  process.exit(1);
}
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));

const errors = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  }
});

let nextID = 1;
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = nextID++;
    const onMsg = e => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });

const evalP = async expr => {
  const res = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`${res.exceptionDetails.text}: ${res.exceptionDetails.exception?.description ?? ''}`);
  }
  return res.result.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.reload', { ignoreCache: true });
await new Promise(r => setTimeout(r, 3000));

const spyOk = await evalP(`
  (async () => {
    for (let i = 0; i < 60; i++) {
      if (window.__webSynthSpy) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  })()
`);
console.log('engine booted (spy installed):', spyOk);

if (spyOk) {
  const summary = await evalP(`
    JSON.stringify({
      ctxState: __webSynthSpy.ctx.state,
      nodeCount: Object.keys(window.getState().viewContextManager.patchNetwork.connectables.toJS ? window.getState().viewContextManager.patchNetwork.connectables.toJS() : {}).length,
      activeVcName: window.getState().viewContextManager.activeViewContexts.map(vc => vc.name).join(','),
    })
  `);
  console.log('app summary:', summary);
}

console.log('page errors:', errors.length ? errors : 'none');
process.exit(spyOk && errors.length === 0 ? 0 : 1);

// Workers do not inherit the page's import map. Carry the deployed version into this import.
let cad;
const ready = (async () => {
  cad = await import(new URL('./cad.js' + new URL(import.meta.url).search, import.meta.url));
  await cad.init();
})();
const caches = new Map();
const build = (features, channel) => {
  if (!caches.has(channel)) caches.set(channel, []);
  return cad.rebuild(features, caches.get(channel));
};
const pack = result => ({ ...result, body: result.body?.serialize() || null });

self.onmessage = async ({ data: { id, channel, features, before, goal, showDiff } }) => {
  try {
    await ready; // register the handler before WASM loads, so the first request is retained
    const result = build(features, ['preview', 'compare'].includes(channel) ? 'model' : channel);
    if (goal) {
      const compared = cad.compare(result.body, build(goal, 'goal').body, showDiff);
      if (compared.diff) for (const key of ['missing', 'extra']) compared.diff[key] = compared.diff[key]?.serialize() || null;
      self.postMessage({ id, result: compared });
    } else {
      const response = pack(result);
      if (before !== undefined) response.before = pack(cad.rebuild(features.slice(0, before), caches.get('model')));
      self.postMessage({ id, result: response });
    }
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};

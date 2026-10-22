import { deserialize } from './cad.js';

// One running request, one latest request per purpose. Rapid input never queues obsolete builds.
let worker, active, serial = 0;
const queued = new Map();
function fail(error) {
  active?.reject(error);
  for (const job of queued.values()) job.reject(error);
  active = null;
  queued.clear();
  worker?.terminate();
  worker = null;
}

function pump() {
  if (active || !queued.size) return;
  try {
    if (!worker) {
      worker = new Worker(new URL('./cad-worker.js' + new URL(import.meta.url).search, import.meta.url), { type: 'module' });
      const current = worker;
      worker.onmessage = ({ data }) => {
        if (data.id !== active?.id) return;
        const job = active;
        active = null;
        if (data.fatal) { worker.terminate(); worker = null; }
        data.error ? job.reject(new Error(data.error)) : job.resolve(data.result);
        pump();
      };
      worker.onerror = event => {
        event.preventDefault();
        if (worker === current) fail(new Error(event.message || 'Geometry worker failed'));
      };
    }
    const [channel, job] = queued.entries().next().value;
    queued.delete(channel);
    active = job;
    worker.postMessage(job.message);
  } catch (error) { fail(error); }
}

export async function requestGeometry(features, options = {}) {
  const channel = options.channel || 'model', id = ++serial;
  const result = await new Promise((resolve, reject) => {
    queued.get(channel)?.resolve(null);
    queued.set(channel, { id, resolve, reject, message: structuredClone({ features, ...options, channel, id }) });
    pump();
  });
  if (!result) return null;
  if ('body' in result) result.body = deserialize(result.body);
  if (result.before) result.before.body = deserialize(result.before.body);
  if (result.diff) for (const key of ['missing', 'extra']) result.diff[key] = deserialize(result.diff[key]);
  return result;
}

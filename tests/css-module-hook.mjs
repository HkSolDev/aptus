import { register } from 'node:module';

export async function load(url, context, nextLoad) {
  if (url.includes('.module.css') || url.endsWith('.css')) {
    return {
      format: 'module',
      shortCircuit: true,
      source:
        "export default new Proxy({}, { get: (_target, key) => typeof key === 'string' ? key : undefined });",
    };
  }
  return nextLoad(url, context);
}

register('./css-module-hook.mjs', import.meta.url);

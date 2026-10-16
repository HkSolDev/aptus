import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, nextLoad) {
    if (!url.includes('.module.css')) return nextLoad(url, context);
    return {
      format: 'module',
      shortCircuit: true,
      source:
        "export default new Proxy({}, { get: (_target, key) => typeof key === 'string' ? key : undefined });",
    };
  },
});

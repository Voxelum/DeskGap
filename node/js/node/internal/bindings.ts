const bindings = (global as any).__embedder_mod;
export = bindings;
delete (global as any).__embedder_mod;
export function makeFakeDriver(config = {}) {
  const isGit = config.isGit ?? true;
  const bindings = (config.bindings ?? []).map((b) => ({ ...b }));
  const threads = { ...(config.threads ?? {}) };
  const observations = { ...(config.observations ?? {}) };
  const newBranchObservations = { ...(config.newBranchObservations ?? {}) };
  const repoBranches = { ...(config.repoBranches ?? {}) };
  const bySlug = { ...(config.bySlug ?? {}) };
  const indexFiles = { ...(config.indexFiles ?? {}) };

  const calls = { writeBinding: [], observeBranch: [], writeIndexFile: [], commit: 0, sync: 0 };

  const driver = {
    isGit() {
      return isGit;
    },
    async listBindings() {
      return bindings.map((b) => ({ ...b }));
    },
    async listThreads() {
      return Object.values(threads).map((t) => ({ ...t }));
    },
    async readThread(id) {
      return threads[id] ? { ...threads[id] } : null;
    },
    async writeBinding(binding) {
      calls.writeBinding.push(binding);
      return binding;
    },
    async readIndexFile(name) {
      if (name === 'by-slug') return { ...bySlug };
      return indexFiles[name] ?? {};
    },
    async writeIndexFile(name, obj) {
      calls.writeIndexFile.push(name);
      indexFiles[name] = obj;
    },
    async observeBranch(binding) {
      calls.observeBranch.push(binding.id);
      if (!(binding.id in observations)) {
        throw new Error(`fake observeBranch: no observation for ${binding.id}`);
      }
      return observations[binding.id];
    },
    async observeNewBranch(repo, branch) {
      return newBranchObservations[`${repo} ${branch}`] ?? { thread_id_trailer: null, first_commit: null };
    },
    async listRepoBranches(repo) {
      return repoBranches[repo] ?? [];
    },
    async commit() {
      calls.commit += 1;
      return { committed: false };
    },
    async sync() {
      calls.sync += 1;
      return { synced: false };
    },
  };

  return { driver, calls, indexFiles };
}

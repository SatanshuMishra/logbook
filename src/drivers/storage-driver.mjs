export class StorageDriver {
  isGit() {
    throw new Error('StorageDriver.isGit not implemented');
  }

  async init() {
    throw new Error('StorageDriver.init not implemented');
  }

  async root() {
    throw new Error('StorageDriver.root not implemented');
  }

  async readThread(id) {
    throw new Error('StorageDriver.readThread not implemented');
  }

  async writeThread(thread) {
    throw new Error('StorageDriver.writeThread not implemented');
  }

  async listThreads() {
    throw new Error('StorageDriver.listThreads not implemented');
  }

  async readBinding(id) {
    throw new Error('StorageDriver.readBinding not implemented');
  }

  async writeBinding(binding) {
    throw new Error('StorageDriver.writeBinding not implemented');
  }

  async listBindings() {
    throw new Error('StorageDriver.listBindings not implemented');
  }

  async nextDecisionNumber() {
    throw new Error('StorageDriver.nextDecisionNumber not implemented');
  }

  async writeDecision(nnnn, slug, markdown) {
    throw new Error('StorageDriver.writeDecision not implemented');
  }

  async readDecision(nnnn) {
    throw new Error('StorageDriver.readDecision not implemented');
  }

  async listDecisions() {
    throw new Error('StorageDriver.listDecisions not implemented');
  }

  async appendSessionEvent(threadId, isoTs, actor, markdown) {
    throw new Error('StorageDriver.appendSessionEvent not implemented');
  }

  async readIndexFile(name) {
    throw new Error('StorageDriver.readIndexFile not implemented');
  }

  async writeIndexFile(name, obj) {
    throw new Error('StorageDriver.writeIndexFile not implemented');
  }

  async deleteIndexFile(name) {
    throw new Error('StorageDriver.deleteIndexFile not implemented');
  }

  async commit(message) {
    throw new Error('StorageDriver.commit not implemented');
  }

  async sync() {
    throw new Error('StorageDriver.sync not implemented');
  }

  async observeBranch(binding) {
    throw new Error('observeBranch: git drivers only');
  }

  async observeNewBranch(repo, branch) {
    throw new Error('observeNewBranch: git drivers only');
  }

  async listRepoBranches(repo) {
    throw new Error('listRepoBranches: git drivers only');
  }
}

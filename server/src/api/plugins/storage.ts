import fp from 'fastify-plugin';
import { Semaphore } from '../../core/images/semaphore.js';
import { createStorage, type StorageDriver } from '../../core/storage/index.js';

export const IMAGE_CONCURRENCY = 2;

export const storagePlugin = fp<{ storage?: StorageDriver }>(
  async (app, options) => {
    app.decorate('storage', options.storage ?? createStorage(app.config));
    app.decorate('imageSemaphore', new Semaphore(IMAGE_CONCURRENCY));
  },
  { name: 'storage', dependencies: ['config'] },
);

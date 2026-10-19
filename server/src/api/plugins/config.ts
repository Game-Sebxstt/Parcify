import fp from 'fastify-plugin';
import type { Config } from '../../core/config.js';

export const configPlugin = fp<{ config: Config }>(
  async (app, { config }) => {
    app.decorate('config', config);
    for (const warning of config.warnings) app.log.warn(warning);
  },
  { name: 'config' },
);

import type { Hocuspocus } from '@hocuspocus/server';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

const MiB = 1024 * 1024;

export function createCollabMetrics(instanceId: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ service: 'collab', instance: instanceId });
  collectDefaultMetrics({ register: registry });

  let hocuspocus: Hocuspocus | null = null;

  const metrics = {
    registry,
    bind(instance: Hocuspocus) {
      hocuspocus = instance;
    },
    connections: new Gauge({
      name: 'collab_connections',
      help: 'Conexiones activas en esta instancia',
      registers: [registry],
      collect() {
        this.set(hocuspocus?.getConnectionsCount() ?? 0);
      },
    }),
    documents: new Gauge({
      name: 'collab_documents_loaded',
      help: 'Documentos cargados en esta instancia',
      registers: [registry],
      collect() {
        this.set(hocuspocus?.getDocumentsCount() ?? 0);
      },
    }),
    storeDuration: new Histogram({
      name: 'collab_store_duration_seconds',
      help: 'Duración de cada guardado del documento en Postgres',
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    storeErrors: new Counter({
      name: 'collab_store_errors_total',
      help: 'Guardados fallidos (se reintentan)',
      registers: [registry],
    }),
    documentSize: new Histogram({
      name: 'collab_document_size_bytes',
      help: 'Tamaño de los documentos guardados',
      buckets: [64 * 1024, 256 * 1024, MiB, 4 * MiB, 15 * MiB, 25 * MiB, 32 * MiB],
      registers: [registry],
    }),
    strikes: new Counter({
      name: 'collab_strikes_total',
      help: 'Strikes de validación',
      registers: [registry],
    }),
    corrections: new Counter({
      name: 'collab_normalize_corrections_total',
      help: 'Correcciones aplicadas por la normalización',
      registers: [registry],
    }),
    rejections: new Counter({
      name: 'collab_rejections_total',
      help: 'Conexiones rechazadas al autenticar, por motivo',
      labelNames: ['reason'] as const,
      registers: [registry],
    }),
  };
  return metrics;
}

export type CollabMetrics = ReturnType<typeof createCollabMetrics>;

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

// Cola de procesado de imágenes: lo que corre y lo que espera hueco.
export interface QueueSource {
  readonly running: number;
  readonly pending: number;
}

// Series de la API. Un registro por app: cada prueba que construye una tiene el suyo.
export function createApiMetrics(instanceId: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ service: 'api', instance: instanceId });
  collectDefaultMetrics({ register: registry });

  const queues = new Map<string, QueueSource>();
  const queueGauge = (name: string, help: string, read: (queue: QueueSource) => number) =>
    new Gauge({
      name,
      help,
      labelNames: ['queue'] as const,
      registers: [registry],
      collect() {
        for (const [queue, source] of queues) this.set({ queue }, read(source));
      },
    });

  return {
    registry,
    httpDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duración de las peticiones HTTP',
      labelNames: ['method', 'route', 'status_code'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    }),
    aiUsage: new Counter({
      name: 'ai_usage_total',
      help: 'Acciones de IA por función y estado',
      labelNames: ['feature', 'status'] as const,
      registers: [registry],
    }),
    imagesRunning: queueGauge('images_processing_running', 'Imágenes que se están procesando', (queue) => queue.running),
    imagesQueued: queueGauge('images_processing_queued', 'Imágenes que esperan hueco para procesarse', (queue) => queue.pending),
    watchQueue(name: string, source: QueueSource) {
      queues.set(name, source);
    },
  };
}

export type ApiMetrics = ReturnType<typeof createApiMetrics>;

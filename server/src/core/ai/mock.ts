import { customProvider } from 'ai';

// PNG de 1×1 px.
export const MOCK_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export const MOCK_AI_TEXT = {
  assistant: JSON.stringify({
    summary: 'Plan de prueba',
    ops: [{ op: 'create', tempId: 'mock-rect', node: { type: 'rect', x: 0, y: 0, w: 120, h: 80, fill: '#FF7A59', name: 'Rectángulo de prueba' } }],
  }),
  animation: JSON.stringify({ summary: 'Animación de prueba', animations: [] }),
  chat: 'Respuesta de prueba.',
  vision: 'Descripción de prueba.',
} as const;

// La animación simulada mueve 100 px el primer nodo de «nodeIds» que aparece en la petición.
function mockAnimation(prompt: string): string {
  const nodeId = /"nodeIds":\["([^"]+)"/.exec(prompt)?.[1];
  if (!nodeId) return MOCK_AI_TEXT.animation;
  const animation = {
    duration: 1000,
    tracks: [{ prop: 'offsetX', keyframes: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }],
  };
  return JSON.stringify({ summary: 'Animación de prueba', animations: [{ nodeId, animation }] });
}

type PromptMessage = { role: string; content: unknown };

function promptText(prompt: readonly PromptMessage[]): string {
  return prompt
    .flatMap((message) => {
      if (typeof message.content === 'string') return [message.content];
      if (!Array.isArray(message.content)) return [];
      return message.content.flatMap((part: { type?: unknown; text?: unknown }) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : []));
    })
    .join('\n');
}

export const MOCK_AI_USAGE = { inputTokens: 10, outputTokens: 5 } as const;

const usage = {
  inputTokens: { total: MOCK_AI_USAGE.inputTokens, noCache: MOCK_AI_USAGE.inputTokens, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: MOCK_AI_USAGE.outputTokens, text: MOCK_AI_USAGE.outputTokens, reasoning: undefined },
};

// ai/test se importa en caliente para que fuera de las pruebas no se cargue.
export async function createMockProvider() {
  const { MockImageModelV4, MockLanguageModelV4, simulateReadableStream } = await import('ai/test');

  const languageModel = (modelId: keyof typeof MOCK_AI_TEXT) => {
    const text = MOCK_AI_TEXT[modelId];
    return new MockLanguageModelV4({
      provider: 'mock',
      modelId,
      doGenerate: async (options) => ({
        content: [{ type: 'text', text: modelId === 'animation' ? mockAnimation(promptText(options.prompt)) : text }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      }),
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 't1' },
            ...text.split(/(?<= )/).map((delta) => ({ type: 'text-delta' as const, id: 't1', delta })),
            { type: 'text-end', id: 't1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ],
        }),
      }),
    });
  };

  return customProvider({
    languageModels: {
      assistant: languageModel('assistant'),
      animation: languageModel('animation'),
      chat: languageModel('chat'),
      vision: languageModel('vision'),
    },
    imageModels: {
      image: new MockImageModelV4({
        provider: 'mock',
        modelId: 'image',
        maxImagesPerCall: 4,
        doGenerate: async (options) => ({
          images: Array.from({ length: options.n }, () => MOCK_IMAGE_BASE64),
          warnings: [],
          response: { timestamp: new Date(0), modelId: 'image', headers: undefined },
        }),
      }),
    },
  });
}

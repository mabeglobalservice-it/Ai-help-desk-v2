// Shared, reusable mock for the `voyageai` SDK used by
// src/knowledge/rag/embedding.util.ts. Wired in the same way as
// test/support/anthropic-mock.ts (see that file and the root README "Tests"
// section for the full rationale) via:
//
//   jest.mock('voyageai', () =>
//     require('<relative-path-to-this-file>').voyageSdkMockFactory(),
//   );
//
// so tests exercise embed()/embedWithProvider()'s real-Voyage code path
// deterministically, without spending real API credits or requiring network
// access.

export interface VoyageEmbedResponse {
  object?: string;
  data?: Array<{ object?: string; embedding?: number[]; index?: number }>;
  model?: string;
  usage?: { total_tokens?: number };
}

type QueueItem = () => Promise<VoyageEmbedResponse>;

const queue: QueueItem[] = [];

// A default, plausible 1024-dim vector (voyage-multilingual-2's default
// dimension) so tests that don't care about the exact values still get a
// realistic shape back.
function defaultVector(): number[] {
  return new Array(1024).fill(0).map((_, i) => (i % 7 === 0 ? 0.05 : 0));
}

export const mockVoyageEmbed = jest.fn(
  async (): Promise<VoyageEmbedResponse> => {
    const next = queue.shift();
    if (next) return next();
    return {
      object: 'list',
      data: [{ object: 'embedding', embedding: defaultVector(), index: 0 }],
      model: 'voyage-multilingual-2',
      usage: { total_tokens: 10 },
    };
  },
);

export function voyageSdkMockFactory() {
  return {
    __esModule: true,
    VoyageAIClient: jest.fn().mockImplementation(() => ({
      embed: mockVoyageEmbed,
    })),
  };
}

export function queueVoyageResponse(vector: number[]): void {
  queue.push(() =>
    Promise.resolve({
      object: 'list',
      data: [{ object: 'embedding', embedding: vector, index: 0 }],
      model: 'voyage-multilingual-2',
      usage: { total_tokens: 10 },
    }),
  );
}

export function queueVoyageError(
  error: Error = new Error('Voyage AI timeout (simulated by test)'),
): void {
  queue.push(() => Promise.reject(error));
}

export function resetVoyageMock(): void {
  queue.length = 0;
  mockVoyageEmbed.mockClear();
}

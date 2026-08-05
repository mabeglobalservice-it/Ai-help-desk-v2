// Shared, reusable mock for the `@anthropic-ai/sdk` client used by
// AiService. Every unit test and the vast majority of e2e tests wire this in
// via:
//
//   jest.mock('@anthropic-ai/sdk', () =>
//     require('<relative-path-to-this-file>').anthropicSdkMockFactory(),
//   );
//
// so they exercise the real-Claude response-parsing code paths
// deterministically, without spending real API credits or requiring network
// access. See the "Tests" section of the root README for the full rationale
// and the small, explicitly-tagged set of tests that still call the real API
// on purpose (test/live/*.e2e-spec.ts, run only via `npm run test:integration:live`).

export interface AnthropicToolUseResponse {
  content: Array<{
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  usage: { input_tokens: number; output_tokens: number };
}

interface MessagesCreateParams {
  tool_choice?: { type: 'tool'; name: string };
  tools?: Array<{ name: string }>;
}

type QueueItem = () => Promise<AnthropicToolUseResponse>;

const queue: QueueItem[] = [];
const defaultsByTool = new Map<string, () => AnthropicToolUseResponse>();

function randomToolUseId(): string {
  return `toolu_mock_${Math.random().toString(36).slice(2, 10)}`;
}

// Builds a canned tool_use response mirroring exactly what AiService's
// private aiXxx methods parse: `response.content.find(block => block.type
// === 'tool_use').input`. `usage` defaults to plausible small token counts.
export function toolUseResponse(
  toolName: string,
  input: Record<string, unknown>,
  usage: { input_tokens: number; output_tokens: number } = {
    input_tokens: 200,
    output_tokens: 80,
  },
): AnthropicToolUseResponse {
  return {
    content: [
      { type: 'tool_use', id: randomToolUseId(), name: toolName, input },
    ],
    usage,
  };
}

// Generic, plausible "happy path" response per tool — good enough for e2e
// tests that only assert loose things ("is a non-empty string", "status is
// 200") and don't care about the AI's exact wording. Unit tests that need a
// specific scenario (high/low confidence, ambiguous category, error) call
// queueAnthropicResponse()/queueAnthropicError() to override this for their
// next call only — the queue always takes priority over these defaults.
function registerBuiltinDefaults(): void {
  defaultsByTool.set('suggest_ticket_details', () =>
    toolUseResponse('suggest_ticket_details', {
      title: 'Problème signalé par un employé',
      // AiService falls back to categories[0]/priorities[0] if the id
      // returned here doesn't match any real option, so an arbitrary
      // placeholder is safe regardless of what the test seeded.
      categoryId: '__mock_default_category__',
      priorityId: '__mock_default_priority__',
    }),
  );
  defaultsByTool.set('continue_diagnostic', () =>
    toolUseResponse('continue_diagnostic', {
      needsMoreInfo: false,
      title: 'Problème signalé par un employé',
      categoryId: '__mock_default_category__',
      priorityId: '__mock_default_priority__',
      causeProbable: 'Cause probable générée par le mock de test.',
      suggestedSteps: ['Étape suggérée par le mock de test.'],
      confidence: 0.75,
    }),
  );
  defaultsByTool.set('assist_technician', () =>
    toolUseResponse('assist_technician', {
      explanation: 'Explication générée par le mock de test.',
      suggestedScript: null,
    }),
  );
  defaultsByTool.set('propose_knowledge_article', () =>
    toolUseResponse('propose_knowledge_article', {
      title: 'Article proposé par le mock de test',
      content:
        'Cause probable : générée par le mock de test.\n' +
        'Solution appliquée : générée par le mock de test.',
    }),
  );
  defaultsByTool.set('suggest_automation_script', () =>
    toolUseResponse('suggest_automation_script', {
      scriptId: 'aucun',
      justification: '',
    }),
  );
  defaultsByTool.set('evaluate_auto_resolution', () =>
    toolUseResponse('evaluate_auto_resolution', {
      eligible: false,
    }),
  );
}
registerBuiltinDefaults();

// A single shared jest.fn() instance: the `jest.mock()` factory (evaluated
// via a lazy `require()` to dodge Jest's module-factory hoisting) and the
// test file's normal `import` both resolve to this same module instance, so
// configuring responses here is visible to whatever calls `messages.create`.
export const mockMessagesCreate = jest.fn(
  async (params: MessagesCreateParams): Promise<AnthropicToolUseResponse> => {
    const next = queue.shift();
    if (next) return next();

    const toolName = params.tool_choice?.name ?? params.tools?.[0]?.name;
    const byTool = toolName ? defaultsByTool.get(toolName) : undefined;
    if (byTool) return byTool();

    throw new Error(
      `anthropic-mock: no response configured for tool "${String(toolName)}" — ` +
        'call queueAnthropicResponse() before invoking the AiService method under test.',
    );
  },
);

export function anthropicSdkMockFactory() {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockMessagesCreate },
    })),
  };
}

export function queueAnthropicResponse(
  response: AnthropicToolUseResponse,
): void {
  queue.push(() => Promise.resolve(response));
}

// Simulates an API error or timeout — AiService wraps every real-Claude call
// in a try/catch that falls back to its degraded (local) logic, so this
// exercises that fallback path deterministically instead of waiting on a
// real network timeout.
export function queueAnthropicError(
  error: Error = new Error('Anthropic API timeout (simulated by test)'),
): void {
  queue.push(() => Promise.reject(error));
}

export function resetAnthropicMock(): void {
  queue.length = 0;
  defaultsByTool.clear();
  registerBuiltinDefaults();
  mockMessagesCreate.mockClear();
}

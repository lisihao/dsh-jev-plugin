import type { Agent } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
/** Return the visible direct-user messages belonging to the current turn. */
export declare function currentTurnUserMessages(session: Agent['session'], pending: readonly UserMessage[]): UserMessage[];
//# sourceMappingURL=instruction-turn.d.ts.map
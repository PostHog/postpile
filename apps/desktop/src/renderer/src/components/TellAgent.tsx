import { createContext, useContext } from 'react';

/** "Tell the agent" (what's wrong): opens the topic's agent pane with a draft. */
export interface TellAgent {
  /** False while no tile is selected, so there is no chat to open. */
  available: boolean;
  tell(draft: string): void;
}

export const TellAgentContext = createContext<TellAgent>({ available: false, tell: () => {} });

export function useTellAgent(): TellAgent {
  return useContext(TellAgentContext);
}

/** A request to open the agent pane of `topicId` with `draft`; `seq` tells two equal drafts apart. */
export interface ChatRequest {
  seq: number;
  topicId: string;
  draft: string;
}

/** The draft that quotes a memory line for the user to finish. */
export function quoteLineDraft(line: string): string {
  return `About "${line}": `;
}

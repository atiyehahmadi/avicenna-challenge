import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import {
  createMessage,
  initialOutboxState,
  outboxReducer,
  type OutboxState,
} from './outboxReducer';

/**
 * State and actions are two separate contexts on purpose.
 *
 * A component that only acts — the compose form, the toolbar buttons — reads
 * from OutboxActionsContext, whose value is memoised once and never changes
 * identity. Those components therefore do not re-render when a message changes
 * status, which happens constantly during a bulk dispatch.
 *
 * This split does NOT stop the message list itself from re-rendering, because
 * every row would still read the same state context. That is solved separately:
 * MessageList reads state and passes each message down as a prop, and
 * MessageRow is memoised. The reducer's structural sharing (see setMessage in
 * outboxReducer.ts) is what makes that shallow compare succeed.
 */

export interface MessageDraft {
  recipient: string;
  subject: string;
  body: string;
}

export interface OutboxActions {
  addMessage: (draft: MessageDraft) => void;
  deleteMessage: (id: string) => void;
  toggleSelect: (id: string) => void;
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
  setFocus: (id: string | null) => void;
  toggleExpand: (id: string) => void;
}

const OutboxStateContext = createContext<OutboxState | null>(null);
const OutboxActionsContext = createContext<OutboxActions | null>(null);

export function OutboxProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(outboxReducer, initialOutboxState);

  // `dispatch` from useReducer is referentially stable for the life of the
  // component, so an empty dependency list is correct here: this object is
  // created once and every consumer keeps the same reference forever.
  const actions = useMemo<OutboxActions>(
    () => ({
      addMessage: (draft) =>
        dispatch({ type: 'ADD_MESSAGE', message: createMessage(draft) }),
      deleteMessage: (id) => dispatch({ type: 'DELETE_MESSAGE', id }),
      toggleSelect: (id) => dispatch({ type: 'TOGGLE_SELECT', id }),
      setSelection: (ids) => dispatch({ type: 'SET_SELECTION', ids }),
      clearSelection: () => dispatch({ type: 'CLEAR_SELECTION' }),
      setFocus: (id) => dispatch({ type: 'SET_FOCUS', id }),
      toggleExpand: (id) => dispatch({ type: 'TOGGLE_EXPAND', id }),
    }),
    [],
  );

  return (
    <OutboxStateContext value={state}>
      <OutboxActionsContext value={actions}>{children}</OutboxActionsContext>
    </OutboxStateContext>
  );
}

export function useOutboxState(): OutboxState {
  const state = useContext(OutboxStateContext);
  if (state === null) {
    throw new Error('useOutboxState must be used inside <OutboxProvider>');
  }
  return state;
}

export function useOutboxActions(): OutboxActions {
  const actions = useContext(OutboxActionsContext);
  if (actions === null) {
    throw new Error('useOutboxActions must be used inside <OutboxProvider>');
  }
  return actions;
}

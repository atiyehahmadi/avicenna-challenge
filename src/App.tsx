import { OutboxProvider, useOutboxState } from './state/OutboxContext';
import { ComposeForm } from './components/ComposeForm';
import { MessageList } from './components/MessageList';
import { Toolbar } from './components/Toolbar';
import { StatusAnnouncer } from './components/StatusAnnouncer';
import { ErrorBoundary } from './components/ErrorBoundary';
import styles from './App.module.scss';

function OutboxShell() {
  const { order } = useOutboxState();

  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>Outbox Manager</h1>
        <p className={styles.count}>
          {order.length === 0
            ? 'No messages yet'
            : `${order.length} message${order.length === 1 ? '' : 's'}`}
        </p>
      </header>

      <ComposeForm />
      <StatusAnnouncer />
      <Toolbar />
      <MessageList />
    </main>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <OutboxProvider>
        <OutboxShell />
      </OutboxProvider>
    </ErrorBoundary>
  );
}

import { OutboxProvider, useOutboxState } from './state/OutboxContext';
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
    </main>
  );
}

export default function App() {
  return (
    <OutboxProvider>
      <OutboxShell />
    </OutboxProvider>
  );
}

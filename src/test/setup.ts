// Adds the jest-dom matchers (toBeInTheDocument, toHaveFocus, ...) to Vitest's
// expect. Imported once via the setupFiles entry in vitest.config.ts.
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only registers its own automatic cleanup when it can find a
// global afterEach. Because this project runs Vitest with globals disabled,
// that registration never happens and rendered trees would pile up in
// document.body across tests, making queries ambiguous. So it is wired up here.
afterEach(cleanup);

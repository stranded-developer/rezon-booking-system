/**
 * The PIN-verified operator token lives in memory only: a page reload returns to the lock screen.
 * Kept outside React state because the API client reads it at request time, not during render.
 */
let token: string | null = null;

export const operatorToken = {
  get: () => token,
  set: (next: string | null) => {
    token = next;
  },
};

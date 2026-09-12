/**
 * The `?u=` parameter is the whole sharing story: paste a link, get that person's city.
 * Parsing and formatting live here as plain string work so the rules can be tested
 * without a document.
 */

/** GitHub allows alphanumerics and single hyphens, up to 39 characters. */
const USERNAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export function isValidUsername(value: string): boolean {
  return USERNAME.test(value.trim());
}

/** The requested username, or null for the sample city. Invalid values are ignored. */
export function usernameFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get('u');
  if (raw === null) return null;
  const trimmed = raw.trim();
  return isValidUsername(trimmed) ? trimmed : null;
}

/**
 * Build the search string for a username. Existing parameters are preserved so a future
 * option cannot be dropped by switching cities.
 */
export function searchForUsername(search: string, username: string | null): string {
  const parameters = new URLSearchParams(search);
  if (username === null) parameters.delete('u');
  else parameters.set('u', username);
  const query = parameters.toString();
  return query === '' ? '' : `?${query}`;
}

/** Split only at delimiters outside URI references and quoted parameter values. */
function splitOutsideValues(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let inUri = false;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (quoted && character === '\\') {
      escaped = true;
    } else if (!inUri && character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === '<') {
      inUri = true;
    } else if (!quoted && character === '>') {
      inUri = false;
    } else if (!quoted && !inUri && character === delimiter) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

/** Only the next relation matters; URI targets are never resolved or fetched. */
export function hasNextLink(header: string | null): boolean {
  if (!header) return false;
  return splitOutsideValues(header, ',').some(link => {
    const [target, ...parameters] = splitOutsideValues(link, ';');
    if (!target || !/^\s*<[^<>]*>\s*$/.test(target)) return false;
    for (const parameter of parameters) {
      const relation = /^\s*rel\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s";]+))\s*$/i.exec(parameter);
      if (!relation) continue;
      const value = (relation[1] ?? relation[2] ?? '').replace(/\\(.)/g, '$1');
      // The first rel parameter wins; repeated rel parameters are not valid link syntax.
      return value.toLowerCase().split(/\s+/).includes('next');
    }
    return false;
  });
}

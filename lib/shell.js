// Shell helpers. The extension may not import core modules, so shellQuote is a
// copy of core's (server/agents/claude.js), byte-compatible with its output.

// POSIX single-quote: wrap in '…' and turn each embedded ' into '\'' (close the
// span, an escaped quote, reopen). Safe for any byte string.
export function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Split a POSIX shell command line into words: single quotes, double quotes
// (with \\, \", \$ and \` escapes) and bare backslash escapes. Enough for core's
// launch commands, where every argument is shellQuote'd. Operators (&&, ;) are
// not recognised: core's `inner` is one simple command.
export function splitShellWords(cmd) {
  const s = String(cmd ?? '');
  const words = [];
  let cur = '';
  let inWord = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) throw new Error('Unterminated single quote in launch command');
      cur += s.slice(i + 1, end);
      i = end;
      inWord = true;
    } else if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length && '\\"$`'.includes(s[i + 1])) i++;
        cur += s[i++];
      }
      if (i >= s.length) throw new Error('Unterminated double quote in launch command');
      inWord = true;
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[++i];
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) words.push(cur);
      cur = '';
      inWord = false;
    } else {
      cur += c;
      inWord = true;
    }
  }
  if (inWord) words.push(cur);
  return words;
}

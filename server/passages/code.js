'use strict';

// Code mode: real one-liners, typed exactly — brackets, quotes and all.
module.exports = { lang: 'en', category: 'code', passages: [
  { id: 'code-js-reduce', title: 'JavaScript: filter, map, reduce', text: "const total = items.filter((i) => i.active).map((i) => i.price * i.qty).reduce((a, b) => a + b, 0);" },
  { id: 'code-py-counts', title: 'Python: word counts', text: "for word in text.split(): counts[word] = counts.get(word, 0) + 1" },
  { id: 'code-sql-join', title: 'SQL: top customers', text: "SELECT u.name, COUNT(o.id) AS orders FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.name ORDER BY orders DESC LIMIT 10;" },
  { id: 'code-bash-clean', title: 'Bash: clean old logs', text: "find . -name \"*.log\" -mtime +7 -print0 | xargs -0 rm -f && echo \"cleaned $(date +%F)\"" },
  { id: 'code-css-hover', title: 'CSS: hover lift', text: ".card:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35); transition: transform 0.15s ease; }" },
  { id: 'code-json-pkg', title: 'JSON: package manifest', text: "{\"name\": \"typedash\", \"version\": \"1.2.0\", \"scripts\": {\"start\": \"node server/index.js\", \"test\": \"npm run test:race\"}}" },
  { id: 'code-go-fib', title: 'Go: recursive fib', text: "func fib(n int) int { if n < 2 { return n }; return fib(n-1) + fib(n-2) }" },
  { id: 'code-html-button', title: 'HTML: a button', text: "<button class=\"btn primary\" id=\"btn-quick\" type=\"button\" aria-label=\"Quick race\">Quick Race</button>" },
  { id: 'code-ts-clamp', title: 'TypeScript: clamp', text: "export function clamp(value: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, value)); }" },
  { id: 'code-js-slug', title: 'JavaScript: slugify', text: "const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, \"-\").replace(/^-+|-+$/g, \"\");" },
  { id: 'code-py-dataclass', title: 'Python: a small dataclass', text: "@dataclass(frozen=True) class Point: x: float = 0.0; y: float = 0.0; label: str = \"origin\"" },
  { id: 'code-js-debounce', title: 'JavaScript: debounce', text: "const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };" },
  { id: 'code-git-log', title: 'Git: what changed this week', text: "git log --since='7 days ago' --pretty=format:'%h %an %s' --no-merges | grep -v 'Merge branch'" },
  { id: 'code-css-grid', title: 'CSS: a responsive grid', text: "grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: clamp(8px, 2vw, 24px);" },
  { id: 'code-sql-window', title: 'SQL: rank inside each group', text: "SELECT name, score, RANK() OVER (PARTITION BY country ORDER BY score DESC) AS place FROM results WHERE score > 0;" },
  { id: 'code-rs-iter', title: 'Rust: sum the even squares', text: "let total: u32 = (1..=20).filter(|n| n % 2 == 0).map(|n| n * n).sum();" },
  { id: 'code-go-err', title: 'Go: handle the error first', text: "f, err := os.Open(path); if err != nil { return fmt.Errorf(\"open %s: %w\", path, err) }; defer f.Close()" },
  { id: 'code-sh-pipeline', title: 'Shell: top ten lines', text: "cat access.log | awk '{print $7}' | sort | uniq -c | sort -rn | head -n 10" },
  { id: 'code-ts-generic', title: 'TypeScript: a tiny generic', text: "function first<T>(xs: readonly T[], fallback: T): T { return xs.length > 0 ? xs[0] : fallback; }" },
  { id: 'code-yaml-ci', title: 'YAML: a build step', text: "steps: [{ uses: actions/checkout@v4 }, { run: npm ci && npm test -- --reporter=dot --bail }]" },
] };

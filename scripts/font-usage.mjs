// Extract source characters for the manual font generator; excludes comments.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const files = fs.readdirSync('src', { recursive: true }).filter(f => /\.(tsx?|css)$/.test(f)).sort();
const characters = new Set();
for (const file of files) {
  const text = fs.readFileSync(path.join('src', file), 'utf8');
  const add = value => { for (const ch of value) characters.add(ch.codePointAt(0)); };
  if (file.endsWith('.css')) {
    for (const match of text.matchAll(/content\s*:[^;}]+/g)) add(match[0]);
  } else {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) add(node.text);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
console.log(JSON.stringify([...characters].sort((a, b) => a - b)));

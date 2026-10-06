import fs from 'node:fs/promises';

// Small HTML partials keep the page readable. They are assembled by Node, not fetched by the browser.
export async function renderHome(): Promise<string> {
  const names = ['profile', 'results', 'templates'];
  const [page, ...parts] = await Promise.all([
    fs.readFile(new URL('../../public/index.html', import.meta.url), 'utf-8'),
    ...names.map((name) =>
      fs.readFile(
        new URL(`../../public/parts/${name}.html`, import.meta.url),
        'utf-8',
      ),
    ),
  ]);
  return names.reduce(
    (html, name, index) => html.replace(`<!-- ${name} -->`, parts[index]),
    page,
  );
}

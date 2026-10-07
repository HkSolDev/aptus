import fs from 'node:fs/promises';
import { renderCatalogue } from './render-catalogue.js';

// Small HTML partials keep the page readable. They are assembled by Node, not fetched by the browser.
export async function renderHome(
  params = new URLSearchParams(),
): Promise<string> {
  const names = ['catalogue', 'profile', 'results', 'templates'];
  const [page, ...parts] = await Promise.all([
    fs.readFile(new URL('../../public/index.html', import.meta.url), 'utf-8'),
    ...names.map((name) =>
      fs.readFile(
        new URL(`../../public/parts/${name}.html`, import.meta.url),
        'utf-8',
      ),
    ),
  ]);
  const catalogue = await renderCatalogue(params);
  return names
    .reduce(
      (html, name, index) =>
        html.replace(`<!-- ${name} -->`, () => parts[index]),
      page,
    )
    .replace('<!-- job-list -->', () => catalogue);
}

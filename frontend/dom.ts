// A missing element is a markup/code mismatch. Fail early rather than silently skip it.
export function find<T extends HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing page element: ${selector}`);
  return element;
}

export function cloneTemplate<T extends HTMLElement>(id: string): T {
  const template = find<HTMLTemplateElement>(`#${id}`);
  const fragment = document.importNode(template.content, true);
  return fragment.firstElementChild as T;
}

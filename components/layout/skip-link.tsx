'use client';

export function SkipLink() {
  return (
    <a
      className="skip-link"
      href="#main"
      onClick={(event) => {
        const main = document.getElementById('main');
        if (!main) return;
        // Move keyboard focus without adding a hash entry to router history.
        event.preventDefault();
        main.focus({ preventScroll: true });
        main.scrollIntoView();
      }}
    >
      Skip to content
    </a>
  );
}

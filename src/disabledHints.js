// While a button is disabled, its tooltip shows its data-disabled-title explaining why.
export function showDisabledHints(root = document.body) {
  const update = (button) => {
    if (!button.matches("button[data-disabled-title]")) return;
    button.dataset.enabledTitle ??= button.title;
    button.title = button.disabled ? button.dataset.disabledTitle : button.dataset.enabledTitle;
  };
  root.querySelectorAll("button[data-disabled-title]").forEach(update);
  new MutationObserver((records) => records.forEach((r) => update(r.target)))
    .observe(root, { subtree: true, attributes: true, attributeFilter: ["disabled"] });
}

// Copy-to-clipboard for every <button data-copy="...">.
// The button keeps its accessible name; the result is announced through the
// button's own [data-copy-status] live region.

async function writeText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('copy failed');
}

document.addEventListener('click', async (event) => {
  const button = event.target instanceof Element ? event.target.closest('button[data-copy]') : null;
  if (!button) return;
  const label = button.querySelector('[data-copy-text]');
  const status = button.parentElement?.querySelector('[data-copy-status]');
  const idle = button.dataset.idle || 'Copy';
  try {
    await writeText(button.dataset.copy || '');
    if (label) label.textContent = button.dataset.done || 'Copied';
    if (status) status.textContent = button.dataset.done || 'Copied';
    button.dataset.state = 'done';
  } catch {
    if (label) label.textContent = button.dataset.fail || 'Select and copy';
    if (status) status.textContent = button.dataset.fail || 'Select and copy';
  }
  clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(setTimeout(() => {
    if (label) label.textContent = idle;
    if (status) status.textContent = '';
    delete button.dataset.state;
  }, 2200));
});

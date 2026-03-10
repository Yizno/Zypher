export function selectAllInputText(input: HTMLInputElement): void {
  window.requestAnimationFrame(() => {
    if (!input.isConnected) {
      return;
    }

    try {
      input.select();
      return;
    } catch {
      // Some input types do not support select().
    }

    try {
      input.setSelectionRange(0, input.value.length);
    } catch {
      // Ignore unsupported selection APIs.
    }
  });
}

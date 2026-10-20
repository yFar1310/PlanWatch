import type { Ref } from 'vue';

/** Native dialogs receive backdrop clicks on the dialog itself, including its padding. */
export function useDialogBackdrop(dialog: Ref<HTMLDialogElement | null>, busy: () => boolean, close: () => void) {
  let startedOutside = false;
  function outside(event: MouseEvent) {
    const element = dialog.value;
    if (!element || event.target !== element) return false;
    const rect = element.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  return {
    backdropStart(event: PointerEvent) { startedOutside = event.button === 0 && outside(event); },
    backdropClick(event: MouseEvent) {
      const dismiss = startedOutside && outside(event);
      startedOutside = false;
      if (dismiss && !busy()) close();
    },
  };
}

/**
 * Copy text, on any origin. The async clipboard only exists in a secure
 * context, and a self-hosted box is often reached over plain http (a tailnet
 * name, a LAN address), where navigator.clipboard is undefined. The old
 * execCommand path still works there.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the old way */
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  // Inside an open dialog, the textarea has to live in the dialog too: its
  // focus trap pulls focus back out of anything else, and the selection with it.
  const active = document.activeElement as HTMLElement | null;
  const host = active?.closest?.('[role="dialog"], [role="alertdialog"]') ?? document.body;
  host.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  active?.focus?.();
  return ok;
}

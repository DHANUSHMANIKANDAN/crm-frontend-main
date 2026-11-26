/** Portal roots and overlays — legacy modals, drawer, toasts, and auth mount here. */
export function OverlayHosts() {
  return (
    <>
      <div id="drawer" className="drawer" aria-hidden="true" />
      <div id="scrim" className="scrim" data-act="closeDrawer" role="presentation" />
      <div id="modal-root" />
      <div id="palette-root" />
      <div id="toasts" className="toasts" />
      <div id="auth" className="auth" />
    </>
  );
}
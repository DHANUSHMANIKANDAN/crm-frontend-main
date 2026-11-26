export function Sidebar() {
  return (
    <aside className="side" id="side">
      <div className="brand">
        <div className="logo">S</div>
        <div className="brand-text">
          <div className="brand-name">SriLead</div>
          <div className="brand-sub">Lead → Order engine</div>
        </div>
        <button
          className="collapse-btn"
          data-act="collapseSide"
          id="collapseBtn"
          type="button"
          aria-label="Collapse sidebar"
          title="Collapse sidebar (⌘B)"
        >
          «
        </button>
      </div>
      <nav id="nav" />
      <div className="side-foot">
        <button className="btn ghost sm full" data-act="simulate" type="button" title="Simulate inbound lead">
          ⚡<span className="nl"> Simulate inbound lead</span>
        </button>
        <div className="hint">
          Press <kbd>⌘</kbd>
          <kbd>K</kbd> to search &amp; act
        </div>
      </div>
    </aside>
  );
}
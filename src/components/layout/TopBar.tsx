import { SaveStatus } from './SaveStatus';

export function TopBar() {
  return (
    <header className="top">
      <button className="icon-btn menu" data-act="toggleSide" type="button" aria-label="Menu">
        ☰
      </button>
      <div className="crumbs" id="crumbs" />
      <button className="search" data-act="palette" type="button">
        <span>Search leads, deals, quotes…</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="top-right">
        <SaveStatus />
        <div className="me-wrap">
          <button className="me" id="userBtn" data-act="userMenu" type="button" aria-haspopup="menu">
            <span className="avatar" id="meAvatar" />
            <span className="me-text">
              <b id="meName" />
              <small id="meRole" />
            </span>
            <span className="faint">▾</span>
          </button>
          <div className="user-menu" id="userMenu" role="menu">
            <button data-act="changePassword" role="menuitem" type="button">
              🔑 Change password
            </button>
            <button data-act="signOut" role="menuitem" type="button">
              ⎋ Sign out
            </button>
          </div>
        </div>
        <div className="bell-wrap">
          <button
            className="icon-btn"
            data-act="bell"
            id="bellBtn"
            type="button"
            aria-label="Reminders and notifications"
            title="Reminders"
          >
            🔔
            <span className="bell-count" id="bellCount" style={{ display: 'none' }} />
          </button>
          <div className="bell-panel" id="bellPanel" />
        </div>
        <button className="icon-btn" data-act="theme" type="button" aria-label="Toggle theme" id="themeBtn">
          ◐
        </button>
        <button className="btn primary" data-act="newLead" type="button">
          + New lead
        </button>
      </div>
    </header>
  );
}
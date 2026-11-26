/** CRM primary views — hash routes used by the legacy layer until each view is a React page. */
export const CRM_VIEWS = {
  dashboard: { title: 'Command center', icon: '◎' },
  leads: { title: 'Leads', icon: '✦' },
  inbox: { title: 'Review & pool', icon: '⚑' },
  pipeline: { title: 'Pipeline', icon: '▤' },
  opps: { title: 'Opportunities', icon: '◆' },
  quotes: { title: 'Quotations', icon: '₹' },
  orders: { title: 'Sales orders', icon: '✓' },
  accounts: { title: 'Accounts', icon: '⌂' },
  tasks: { title: 'My tasks', icon: '◷' },
  audit: { title: 'Audit trail', icon: '≡' },
  settings: { title: 'Team & rules', icon: '⚙' },
} as const;

export type CrmViewId = keyof typeof CRM_VIEWS;
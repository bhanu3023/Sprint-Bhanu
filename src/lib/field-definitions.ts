export const ALL_FILTER_FIELDS = [
  { key: 'type', label: 'Issue Type' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'reporter', label: 'Reporter' },
  { key: 'sprint', label: 'Sprint' },
  { key: 'storyPoints', label: 'Story Points' },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'label', label: 'Label' },
  { key: 'createdAt', label: 'Created' },
  { key: 'updatedAt', label: 'Updated' },
]

export type FieldKey = (typeof ALL_FILTER_FIELDS)[number]['key']

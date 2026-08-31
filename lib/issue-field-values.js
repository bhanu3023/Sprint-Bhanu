/**
 * Upsert a single custom field value for an issue — the one implementation,
 * shared by PUT /api/issues/:id/field-values/:fieldId (custom-fields.js) and
 * the bulk CSV import (issues.js), so a value set through either path gets
 * the exact same upsert + history behavior: an empty value deletes the row
 * rather than storing '', and a value that did not actually change writes no
 * issue_history row (the debounced Product Type + Combination picker on the
 * drawer PUTs this field on every save, changed or not).
 */
async function upsertIssueFieldValue(deps, issueId, fieldId, value, actorUserId) {
  const { q, uid } = deps;
  const existing = await q('SELECT id, value FROM issue_field_values WHERE issue_id=$1 AND field_id=$2', [issueId, fieldId]);
  const oldValue = existing.rows.length ? (existing.rows[0].value || '') : '';
  const newValue = String(value || '');
  if (existing.rows.length) {
    if (value === '' || value === null || value === undefined) {
      await q('DELETE FROM issue_field_values WHERE issue_id=$1 AND field_id=$2', [issueId, fieldId]);
    } else {
      await q('UPDATE issue_field_values SET value=$1 WHERE issue_id=$2 AND field_id=$3', [String(value), issueId, fieldId]);
    }
  } else if (value !== '' && value !== null && value !== undefined) {
    await q('INSERT INTO issue_field_values(id,issue_id,field_id,value) VALUES($1,$2,$3,$4)',
      [uid(), issueId, fieldId, String(value)]);
  }
  if (oldValue !== newValue) {
    await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value,created_at)
      VALUES($1,$2,$3,$4,$5,$6,NOW())`, [uid(), issueId, actorUserId, 'custom_field_' + fieldId, oldValue, newValue]);
  }
}

module.exports = { upsertIssueFieldValue };

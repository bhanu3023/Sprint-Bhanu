const { requireAuth } = require('../auth');
const { LINK_TYPE_INVERSE, uid, wrap } = require('../core');
const { q } = require('../db');
const { denyUnlessCanAct, getIssueSpaceId } = require('../deps');
const { app } = require('../express-app');
// ── Issue Links ───────────────────────────────────────────
app.post('/api/links', requireAuth, wrap(async (req, res) => {
  const { source_id, target_id, link_type } = req.body;
  if (!source_id || !target_id || !link_type) return res.status(400).json({ error: 'source_id, target_id and link_type are required' });
  if (source_id === target_id) return res.status(400).json({ error: 'An issue cannot be linked to itself' });
  if (!LINK_TYPE_INVERSE[link_type]) return res.status(400).json({ error: 'Unknown link type' });
  const sourceSpace = await getIssueSpaceId(q, source_id);
  const targetSpace = await getIssueSpaceId(q, target_id);
  if (!sourceSpace || !targetSpace || sourceSpace !== targetSpace) return res.status(400).json({ error: 'Invalid issue link' });
  if (!(await denyUnlessCanAct(q, req.user, res, sourceSpace, 'link.manage'))) return;
  // Reject one link family per pair. Checking only the exact (pair, link_type)
  // let contradictions through, because a family's two names are different
  // strings: A "blocks" B could coexist with A "is blocked by" B, and with
  // B "blocks" A. Comparing against the whole family (type + its inverse) in
  // both directions collapses all four of those into one check, while still
  // allowing genuinely different relationships on the same pair (e.g. both
  // "blocks" and "relates to"), which is how Jira behaves.
  const family = [link_type, LINK_TYPE_INVERSE[link_type]].filter(Boolean);
  const existing = await q(
    `SELECT id, source_id, link_type FROM issue_links
     WHERE ((source_id=$1 AND target_id=$2) OR (source_id=$2 AND target_id=$1))
       AND link_type = ANY($3::varchar[])`,
    [source_id, target_id, family]
  );
  if (existing.rows.length) {
    const clash = existing.rows[0];
    const same = clash.source_id === source_id && clash.link_type === link_type;
    return res.status(409).json({
      error: same
        ? 'These two issues are already linked that way'
        : 'These two issues already have a conflicting link (' + clash.link_type.replace(/_/g, ' ') + ') — remove it first'
    });
  }
  const r = await q('INSERT INTO issue_links(id,source_id,target_id,link_type) VALUES($1,$2,$3,$4) RETURNING *',
    [uid(), source_id, target_id, link_type]);
  res.status(201).json(r.rows[0]);
}));

app.delete('/api/links/:id', requireAuth, wrap(async (req, res) => {
  const linkRow = (await q('SELECT source_id FROM issue_links WHERE id=$1', [req.params.id])).rows[0];
  if (!linkRow) return res.status(404).json({ error: 'Not found' });
  const spaceId = await getIssueSpaceId(q, linkRow.source_id);
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'link.manage'))) return;
  await q('DELETE FROM issue_links WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));


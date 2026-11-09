'use strict';

const { query } = require('../pool');

async function nextRoll(widgetKey) {
  const result = await query(
    `INSERT INTO widget_states (widget_key, kind, rolls, revision, updated_at)
     VALUES ($1, 'dice', 1, 1, now())
     ON CONFLICT (widget_key) DO UPDATE SET
       rolls = widget_states.rolls + 1,
       revision = widget_states.revision + 1,
       updated_at = now()
     RETURNING rolls, revision`,
    [widgetKey]
  );
  return result.rows[0];
}

module.exports = { nextRoll };

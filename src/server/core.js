var __dirname = require("path").dirname(require.resolve("../../package.json"));
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const uid = () => crypto.randomUUID();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// Custom fields live in a separate issue_field_values table — a custom field
// named e.g. "Story Points" would render right next to the real built-in
// story_points field in the drawer, but editing it writes to a completely
// different column that reports never read, silently diverging from what
// the user thinks they're updating. Block creating/renaming a custom field
// to reuse a built-in field's name (case/spacing-insensitive).
const RESERVED_FIELD_NAMES = new Set([
  'title', 'status', 'priority', 'assignee', 'assigneeid', 'reporter', 'reporterid',
  'sprint', 'sprintid', 'labels', 'storypoints', 'points', 'sp', 'startdate', 'duedate',
  'description', 'fixdescription', 'type', 'key', 'team', 'producttype'
]);
function normalizeFieldName(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function isReservedFieldName(name) { return RESERVED_FIELD_NAMES.has(normalizeFieldName(name)); }

// Issue-link types come in inverse pairs: storing A "blocks" B is the same
// relationship as storing B "is blocked by" A. POST /api/links uses this to
// treat a pair's whole family as one link, so contradictory duplicates can't
// be created. Mirrors LINK_TYPES in app.js — keep the two in sync.
// `is_child_of`/`is_parent_of` are still accepted so pre-existing rows can be
// edited/removed, but app.js no longer offers them for new links (issue
// hierarchy belongs to issues.parent_id).
const LINK_TYPE_INVERSE = {
  blocks: 'is_blocked_by',
  is_blocked_by: 'blocks',
  clones: 'is_cloned_by',
  is_cloned_by: 'clones',
  duplicates: 'is_duplicated_by',
  is_duplicated_by: 'duplicates',
  relates_to: 'relates_to',
  is_child_of: 'is_parent_of',
  is_parent_of: 'is_child_of'
};

/** Reserved names are OK when updating an existing built-in registry row (not renaming). */
function reservedNameBlockedForUpdate(name, existing) {
  if (!isReservedFieldName(name)) return false;
  if (!existing) return true;
  if (existing.is_builtin) return false;
  return normalizeFieldName(existing.name) !== normalizeFieldName(name);
}


// Install multer if not present
let multer;
try {
  multer = require('multer');
} catch(e) {
  try {
    console.log('Installing multer...');
    execSync('npm install multer', { cwd: __dirname, stdio: 'inherit' });
    multer = require('multer');
    console.log('multer installed');
  } catch(err) { console.error('Could not install multer:', err.message); }
}

// Install compression if not present
let compression;
try {
  compression = require('compression');
} catch(e) {
  try {
    console.log('Installing compression...');
    execSync('npm install compression', { cwd: __dirname, stdio: 'inherit' });
    compression = require('compression');
    console.log('compression installed');
  } catch(err) { console.error('Could not install compression:', err.message); }
}


module.exports = { express, Pool, path, crypto, execSync, uid, wrap, multer, compression, RESERVED_FIELD_NAMES, normalizeFieldName, isReservedFieldName, LINK_TYPE_INVERSE, reservedNameBlockedForUpdate };

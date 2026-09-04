#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const shellCss = read('app/assets/dashboard-shell.css');
const roleSimulation = read('app/assets/phase-c-role-simulation.js');
const navPriority = read('app/assets/role-navigation-priority.js');
const dashboardShell = read('app/assets/dashboard-shell.js');

test('manager shell shows one logout header while general worker keeps the legacy header', () => {
  assert.match(shellCss, /\.staff-shell > \.staff-header\s*\{\s*display:\s*none;/);
  assert.match(shellCss, /\.general-worker-mode \.staff-shell > \.staff-header\s*\{\s*display:\s*flex;/);
  assert.match(shellCss, /\.environment-label\s*\{\s*display:\s*none !important;/);
});

test('mobile role simulation remains available normally but never covers an open sidebar', () => {
  assert.match(roleSimulation, /\.role-simulation-switcher\s*\{[\s\S]*position:\s*fixed;/);
  assert.match(shellCss, /\.desktop-app-shell\.sidebar-open \.role-simulation-switcher\s*\{\s*display:\s*none;/);
  assert.match(roleSimulation, /홍보직원 보기/);
  assert.match(roleSimulation, /운영팀장 보기/);
  assert.match(roleSimulation, /운영총괄 복귀/);
});

test('unfinished manager manual entry is hidden without deleting worker guide infrastructure', () => {
  assert.match(navPriority, /const HIDDEN_NAV_ITEMS = new Set\(\['작업 매뉴얼'\]\)/);
  assert.match(navPriority, /HIDDEN_NAV_ITEMS\.has\(cleanLabel\(node\)\)/);
  assert.match(navPriority, /window\.TaejangRoleNavigationPriority = \{ ROLE_ORDER, ROLE_SECTIONS, HIDDEN_NAV_ITEMS, reorder \}/);
  assert.match(dashboardShell, /label:\s*'공식 유튜브'/);
  assert.match(dashboardShell, /https:\/\/youtube\.com\/@taejangofficial/);
});

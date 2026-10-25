import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveView, tabOf, STUDY_TABS } from '../app/js/grammar/routes.js';

test('old addresses land on their new home', () => {
  assert.deepEqual(resolveView('map', {}), { name: 'today', params: {} });
  assert.deepEqual(resolveView('map', { chapter: 7 }), { name: 'chapter', params: { chapter: 7 } });
  assert.deepEqual(resolveView('wwdrills', { chapter: 3 }), { name: 'chapter', params: { chapter: 3 } });
  assert.deepEqual(resolveView('catalogue', {}), { name: 'paradigms', params: { list: true } });
  assert.deepEqual(resolveView('catalogue', { table: 'decl1' }), { name: 'catalogue', params: { table: 'decl1' } });
  assert.deepEqual(resolveView('map', { category: 'noun-case' }), { name: 'course', params: { by: 'area', area: 'nouns' } });
  assert.deepEqual(resolveView('path', {}), { name: 'course', params: { by: 'chapter' } });
  assert.deepEqual(resolveView('path', { area: 'verbs', at: 'future-perfect' }), { name: 'course', params: { by: 'area', area: 'verbs', at: 'future-perfect' } });
  assert.deepEqual(resolveView('wwpath', { area: 'nouns' }), { name: 'course', params: { by: 'area', area: 'nouns' } });
  for (const v of ['lesson', 'learn', 'part', 'drill', 'blocked', 'unlimited', 'mixed', 'redo', 'paradigms', 'chart', 'stats', 'history', 'wordwork', 'wwtable', 'chapter', 'sheets', 'setup', 'today', 'course']) {
    assert.equal(resolveView(v, { skill: 'x' }).name, v, `${v} still opens itself`);
  }
});

test('every view sits under one of the four tabs', () => {
  assert.deepEqual(STUDY_TABS.map((t) => t.label), ['Today', 'Course', 'Tables', 'Progress']);
  assert.equal(tabOf('lesson'), 'course');
  assert.equal(tabOf('wordwork'), 'course');
  assert.equal(tabOf('paradigms'), 'tables');
  assert.equal(tabOf('stats'), 'progress');
  assert.equal(tabOf('setup'), 'today');
});

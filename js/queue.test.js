import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueGroupKey, computeQueue } from './queue.js';

test('queueGroupKey falls back to genre when nothing is grouped', () => {
  assert.equal(queueGroupKey('none'), 'genre');
  assert.equal(queueGroupKey(undefined), 'genre');
  assert.equal(queueGroupKey(''), 'genre');
});

test('queueGroupKey follows the active grouping when one is set', () => {
  assert.equal(queueGroupKey('album'), 'album');
  assert.equal(queueGroupKey('mood'), 'mood');
  assert.equal(queueGroupKey('genre'), 'genre');
});

const SONGS = [
  { id: 'a', genre: 'folk', album: 'Roots' },
  { id: 'b', genre: 'indie', album: 'Roots' },
  { id: 'c', genre: 'folk', album: 'Leaves' },
  { id: 'd', genre: '', album: 'Leaves' },
];

test('with no view grouping, the queue is the start song genre-mates', () => {
  const q = computeQueue(SONGS, 'none', SONGS[0]);
  assert.deepEqual(q, ['a', 'c']);
});

test('an active view grouping wins over genre', () => {
  const q = computeQueue(SONGS, 'album', SONGS[0]);
  assert.deepEqual(q, ['a', 'b']);
});

test('a start song with no value for the group key queues everything', () => {
  const q = computeQueue(SONGS, 'none', SONGS[3]);
  assert.deepEqual(q, ['a', 'b', 'c', 'd']);
});

test('an unknown / null start song yields an empty queue', () => {
  assert.deepEqual(computeQueue(SONGS, 'none', undefined), []);
  assert.deepEqual(computeQueue(SONGS, 'none', null), []);
});

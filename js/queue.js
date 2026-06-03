// Pure play-queue logic for the mini-player. No DOM, no IO — so it stays
// unit-testable and the player code below just feeds it the current state.

// The dimension the queue groups by. It follows the active view grouping, but
// when nothing is grouped, music still plays genre-by-genre.
export function queueGroupKey(groupBy) {
  return groupBy && groupBy !== 'none' ? groupBy : 'genre';
}

// Given the playable songs (already filtered to those with audio) and the song
// to start from, return the ordered song ids to queue. Songs sharing the start
// song's value for the grouping dimension play together; if the start song has
// no value there, everything plays.
export function computeQueue(playable, groupBy, song) {
  if (!song) return [];
  const key = queueGroupKey(groupBy);
  if (song[key]) {
    return playable.filter(s => s[key] === song[key]).map(s => s.id);
  }
  return playable.map(s => s.id);
}

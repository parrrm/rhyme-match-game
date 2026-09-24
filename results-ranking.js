(function(root){
  'use strict';

  function rankBy(items, score){
    return [...items].map((player, index) => ({ player, index }))
      .sort((a, b) => score(b.player) - score(a.player) || a.index - b.index)
      .map(item => item.player);
  }

  function build(players){
    const all = Array.isArray(players) ? players : [];
    const standings = rankBy(all, player => Number(player.score) || 0);
    const previous = rankBy(all, player => (Number(player.score) || 0) - (Number(player.delta) || 0));
    const currentRank = new Map(standings.map((player, index) => [player.id, index + 1]));
    const previousRank = new Map(previous.map((player, index) => [player.id, index + 1]));
    const round = rankBy(all, player => Number(player.delta) || 0);
    return {
      standings,
      round:round.map((player, index) => ({
        player,
        roundRank:index + 1,
        currentRank:currentRank.get(player.id),
        previousRank:previousRank.get(player.id),
        movement:previousRank.get(player.id) - currentRank.get(player.id)
      }))
    };
  }

  root.ResultsRanking = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = { build };
})(typeof window !== 'undefined' ? window : globalThis);

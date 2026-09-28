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


function buildHeadline(results){
  const valid = results.submissions.filter(s => !s.outOfGame && !s.timeout && s.valid);
  const groups = {};
  valid.forEach(s => { groups[s.word] = (groups[s.word] || 0) + 1; });
  const best = Object.entries(groups).sort((a,b) => b[1]-a[1])[0];
  if (best && best[1] >= 2) return `${best[1]}-way match on "${best[0]}"!`;
  if (valid.length === 0) return "Nobody landed a valid rhyme this round.";
  if (results.mode === 'lonewolf') return 'Lone wolves ruled this round!';
  return "No matches this round — everyone went their own way.";
}


export { build, buildHeadline };

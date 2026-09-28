const MODES = {
  classic: {
    label: "Classic Rhyme", emoji: "🎤", timerSeconds: 20, elimination: false,
    objective: "Write a secret rhyme. Match exactly one other player for the biggest reward.",
    tutorialScore: "TUNE +3", tutorialDetail: "Two players chose TUNE · +3 each",
    tutorialFinish: "Match one other player for +3; larger matching groups earn +1.",
    desc: "Match one other player for +3. Larger matching groups get +1.",
    points(matchCount){ if (matchCount === 2) return 3; if (matchCount > 2) return 1; return 0; },
    invalid: -2, timeout: -1
  },
  speed: {
    label: "Speed Round", emoji: "⚡", timerSeconds: 12, elimination: false,
    objective: "Write a secret rhyme before time runs out. Matching scores are doubled.",
    tutorialScore: "TUNE +6", tutorialDetail: "Two players matched · +6 each",
    tutorialFinish: "Think fast: Classic rewards and penalties are doubled.",
    desc: "12 seconds by default. Classic points and penalties are doubled.",
    points(matchCount){ if (matchCount === 2) return 6; if (matchCount > 2) return 2; return 0; },
    invalid: -4, timeout: -2
  },
  lonewolf: {
    label: "Lone Wolf", emoji: "🐺", timerSeconds: 15, elimination: false,
    objective: "Write a valid rhyme nobody else chooses to earn +4.",
    tutorialScore: "SPOON +4", tutorialDetail: "Only one player chose SPOON · +4",
    tutorialFinish: "A unique valid rhyme earns +4; a shared rhyme earns +1.",
    desc: "A valid answer nobody else chose gets +4; matching gets +1.",
    points(matchCount){ if (matchCount === 1) return 4; if (matchCount >= 2) return 1; return 0; },
    invalid: -2, timeout: -1
  },
  suddendeath: {
    label: "Sudden Death", emoji: "💀", timerSeconds: 15, elimination: true,
    objective: "Write a secret rhyme and score points. The lowest total is eliminated.",
    tutorialScore: "TUNE +3", tutorialDetail: "Two players matched · +3 each",
    tutorialFinish: "After scoring, the player with the lowest total is eliminated.",
    desc: "Classic points. The lowest total is eliminated each round.",
    points(matchCount){ if (matchCount === 2) return 3; if (matchCount > 2) return 1; return 0; },
    invalid: -2, timeout: -1
  }
};
const MODE_MODIFIERS = {
  classic: [
    { key:'none', label:'No modifier', detail:'The relaxed, social rhyme round.' },
    { key:'prediction', label:'🔮 Match Prediction', detail:'Pick who will match you while locking your first rhyme in a five-round window.' },
    { key:'twist', label:'🎭 Rhyme Twist', detail:'A surprise answer challenge appears before the clock starts.' },
    { key:'streak', label:'🔥 Streak Mode', detail:'Consecutive matching rounds earn growing bonus points.' }
  ],
  speed: [
    { key:'none', label:'No modifier', detail:'Fast rhymes with doubled Classic scoring.' },
    { key:'streak', label:'🔥 Streak Mode', detail:'Consecutive matches earn +2, +3, +4 and more.' },
    { key:'shrinking', label:'⏳ Shrinking Clock', detail:'One second less each consecutive round, down to a playable floor.' },
    { key:'chaos', label:'🎲 Chaos Timer', detail:'One surprise clock from 7–10 seconds each round; Default Timer only.' }
  ],
  lonewolf: [
    { key:'none', label:'No modifier', detail:'A unique valid rhyme earns +4.' },
    { key:'bounty', label:'🎯 Bounty', detail:'Stay solo across rounds to grow an extra reward.' }
  ],
  suddendeath: [
    { key:'none', label:'No modifier', detail:'The lowest total is eliminated each round.' },
    { key:'lives', label:'❤️ Three Lives', detail:'The lowest total loses a life; zero lives means elimination.' }
  ]
};
const MIN_CUSTOM_TIMER = 7;
const MAX_CUSTOM_TIMER = 90;
function defaultModeSettings(){
  return Object.fromEntries(Object.entries(MODES).map(([key, mode]) => [key, {
    timerMode:'default', customSeconds:mode.timerSeconds, modifier:'none'
  }]));
}
function normalizeModeSettings(raw){
  const defaults = defaultModeSettings();
  Object.keys(defaults).forEach(key => {
    const source = raw?.[key] || {};
    defaults[key].timerMode = source.timerMode === 'custom' ? 'custom' : 'default';
    const seconds = Number(source.customSeconds);
    if (Number.isInteger(seconds) && seconds >= MIN_CUSTOM_TIMER && seconds <= MAX_CUSTOM_TIMER) defaults[key].customSeconds = seconds;
    if (MODE_MODIFIERS[key].some(item => item.key === source.modifier)) defaults[key].modifier = source.modifier;
    if (defaults[key].modifier === 'chaos' && defaults[key].timerMode === 'custom') defaults[key].modifier = 'none';
  });
  return defaults;
}
function configuredTimer(modeKey, settings){
  const config = settings[modeKey];
  return config.timerMode === 'custom' ? config.customSeconds : MODES[modeKey].timerSeconds;
}
function shrinkingFloor(start){ return Math.max(7, Math.ceil(start * 2 / 3)); }
function previewTimer(modeKey, settings, run){
  const config = settings[modeKey];
  if (config.modifier === 'chaos') return '7–10 seconds, chosen each round';
  const start = configuredTimer(modeKey, settings);
  if (config.modifier === 'shrinking'){
    const nextIndex = run?.key === `${modeKey}:shrinking:${start}` ? run.count : 0;
    return `${Math.max(shrinkingFloor(start), start - nextIndex)} seconds next round · floor ${shrinkingFloor(start)}s`;
  }
  return `${start} seconds${config.timerMode === 'custom' ? ' · custom' : ' · default'}`;
}


export { MODES, MODE_MODIFIERS, MIN_CUSTOM_TIMER, MAX_CUSTOM_TIMER, defaultModeSettings, normalizeModeSettings, configuredTimer, shrinkingFloor, previewTimer };

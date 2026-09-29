const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value))
  }
});
const bank = import('../client/game/words.js');

test('families, tiers, and legacy exports retain a usable shape', async () => {
  const { FAMILY_TIERS, WORD_FAMILIES, WORD_BANK, QUALITY_WORDS, TIER_OF, TARGET_POOLS, familyOf } = await bank;
  assert.ok(Array.isArray(WORD_FAMILIES.core) && WORD_FAMILIES.core.includes('CAT'));
  assert.ok(Array.isArray(WORD_FAMILIES.longWords) && WORD_FAMILIES.longWords.includes('ASTRONAUT'));
  assert.ok(WORD_BANK.length > 2000 && QUALITY_WORDS.length > 1000);
  const owners = new Map();
  for (const [family, tiers] of Object.entries(FAMILY_TIERS)) {
    const words = [...tiers.easy, ...tiers.medium, ...tiers.hard];
    assert.ok(words.length >= 4, `${family} has too few alternatives`);
    for (const [tier, entries] of Object.entries(tiers)) {
      for (const word of entries) {
        assert.match(word, /^[A-Z]+$/);
        assert.equal(owners.has(word), false, `${word} belongs to two families`);
        owners.set(word, family);
        assert.equal(TIER_OF.get(word), tier);
        assert.equal(familyOf(word.toLowerCase()), family);
      }
    }
  }
  for (const [level, tiers] of Object.entries({ easy: ['easy'], normal: ['easy', 'medium'], hard: ['medium', 'hard'] })) {
    assert.ok(TARGET_POOLS[level].length > 0);
    assert.ok(TARGET_POOLS[level].every(word => tiers.includes(TIER_OF.get(word))));
  }
});

test('known rhyme lookups do not certify mismatches or unknown guesses', async () => {
  const { familyOf, getRhymes, isKnownRhyme } = await bank;
  for (const [target, rhyme] of [['AIR', 'CARE'], ['BOAT', 'NOTE'], ['FOOD', 'RUDE'], ['MOON', 'TUNE'], ['WHEEL', 'STEAL'], ['PEACE', 'LEASE'], ['MAZE', 'RAISE']]) {
    assert.equal(isKnownRhyme(target, rhyme), true);
    assert.ok(getRhymes(target.toLowerCase()).includes(rhyme));
    assert.ok(getRhymes(target).every(word => familyOf(word) === familyOf(target)));
  }
  for (const [target, guess] of [['BOOT', 'CUTE'], ['SOUP', 'COUP'], ['OIL', 'ROYAL'], ['OWL', 'VOWEL'], ['CAT', 'MARZIPAN'], ['FISH', 'SQUISH']]) {
    assert.equal(isKnownRhyme(target, guess), false);
  }
  assert.deepEqual(getRhymes('not-in-bank'), []);
  assert.deepEqual(getRhymes('CAT', { tier: 'invalid' }), []);
  assert.equal(isKnownRhyme('CAT', 'unknown-valid-rhyme'), false);
  assert.equal(isKnownRhyme('CAT', 'CAT'), false);
});

test('target choice respects difficulty and recent family and word history', async () => {
  const { TARGET_POOLS, familyOf, pickTarget, rememberTarget } = await bank;
  storage.clear();
  for (const level of ['easy', 'normal', 'hard']) {
    for (let i = 0; i < 100; i++) assert.ok(TARGET_POOLS[level].includes(pickTarget(level)));
  }
  rememberTarget('CAT');
  for (let i = 0; i < 100; i++) {
    assert.notEqual(pickTarget('easy'), 'CAT');
    assert.notEqual(familyOf(pickTarget('easy')), 'AT');
  }
  const saved = JSON.parse(storage.get('rhymeMatchTargets'));
  assert.ok(saved.words.includes('CAT'));
  assert.ok(saved.families.includes('AT'));
});

test('target history still cools down when browser storage is unavailable', async () => {
  const { familyOf, pickTarget, rememberTarget } = await bank;
  const workingStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  try {
    rememberTarget('BOAT');
    for (let i = 0; i < 30; i++) assert.notEqual(familyOf(pickTarget('easy')), 'OAT');
  } finally {
    globalThis.localStorage = workingStorage;
  }
});

test('every selected family has rhyme alternatives and a satisfiable twist', async () => {
  const { FAMILY_TIERS, pickTwistChallenge, getRhymes, familyOf } = await bank;
  assert.equal(pickTwistChallenge('not-in-bank', []), null);
  for (const [family, tiers] of Object.entries(FAMILY_TIERS)) {
    const target = [...tiers.easy, ...tiers.medium, ...tiers.hard][0];
    assert.ok(getRhymes(target).length >= 3);
    assert.ok(getRhymes(target).every(word => familyOf(word) === family), family);
    const challenge = pickTwistChallenge(target, []);
    assert.ok(challenge?.id && challenge?.text, family);
  }
});

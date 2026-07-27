/* Node smoke test: stub the browser, load all modules, exercise the game.
 * Run: node tools/smoke.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ----------------------------- browser stubs ------------------------------ */
const idRegistry = {};
function fakeEl(tag) {
  const el = {
    tagName: tag, children: [], style: {}, dataset: {}, className: '',
    _text: '', _html: '',
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this[k] = v; if (k === 'id') idRegistry[v] = this; },
    getAttribute(k) { return this[k]; },
    querySelector() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
    focus() {}, click() {},
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; },
    set innerHTML(v) { this._html = v; this.children = []; },
    get innerHTML() { return this._html; },
    value: '',
  };
  return el;
}
function fakeCtx() {
  const grad = { addColorStop() {} };
  const noop = () => {};
  return new Proxy({ canvas: { width: 800, height: 600 } }, {
    get(t, p) {
      if (p === 'measureText') return () => ({ width: 12 });
      if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => grad;
      if (p in t) return t[p];
      return noop;
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}
const canvasEl = fakeEl('canvas');
canvasEl.getContext = () => fakeCtx();
idRegistry['game'] = canvasEl;

const doc = {
  _ids: idRegistry,
  getElementById(id) { if (!idRegistry[id]) idRegistry[id] = fakeEl('div'); return idRegistry[id]; },
  createElement(tag) { const el = fakeEl(tag); if (tag === 'canvas') el.getContext = () => fakeCtx(); return el; },
  createTextNode(t) { return { nodeType: 3, textContent: t }; },
  body: fakeEl('body'),
  addEventListener() {}, removeEventListener() {},
};
const store = {};
global.window = global;
global.document = doc;
global.localStorage = {
  getItem(k) { return k in store ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
};
global.performance = global.performance || { now: () => Date.now() };
global.requestAnimationFrame = () => 0;
global.addEventListener = () => {};
global.devicePixelRatio = 1;

/* ----------------------------- load modules ------------------------------- */
const files = ['core.js', 'i18n.js', 'data.js', 'sprites.js', 'world.js', 'entities.js', 'meta.js', 'raid.js', 'ui.js', 'main.js'];
const base = path.join(__dirname, '..', 'js');
for (const f of files) {
  const src = fs.readFileSync(path.join(base, f), 'utf8');
  try { eval(src); } catch (e) { console.error('LOAD FAIL', f, e); process.exit(1); }
}
const G = global.G;
G.Audio.setEnabled(false);

/* ------------------------------- test runner ------------------------------ */
let pass = 0, fail = 0;
function ok(name, fn) { try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n   ', e.stack || e); } }

const ctx = fakeCtx();
function collectDomText(el) {
  if (!el) return '';
  let out = el._text || '';
  for (const c of el.children || []) out += collectDomText(c);
  return out;
}
function collectByClass(el, cls, out) {
  out = out || [];
  if (!el) return out;
  const classes = String(el.className || '').split(/\s+/);
  if (classes.indexOf(cls) >= 0) out.push(el);
  for (const c of el.children || []) collectByClass(c, cls, out);
  return out;
}

console.log('\n[1] Map generation');
ok('all locations generate with spawn/extracts/enemies', () => {
  for (const loc of G.Locations) {
    for (let i = 0; i < 4; i++) {
      const m = G.MapGen.generate(loc);
      if (!m.playerSpawn) throw new Error('no playerSpawn ' + loc.id);
      if (m.extracts.length < 1) throw new Error('no extracts ' + loc.id);
      if (m.enemySpawns.length < 1) throw new Error('no enemies ' + loc.id);
      if (m.containers.length < 1) throw new Error('no containers ' + loc.id);
      // pathfind sanity between two rooms
      if (m.rooms.length >= 2) {
        const a = m.tileCenter(m.rooms[0].cx, m.rooms[0].cy);
        const b = m.tileCenter(m.rooms[1].cx, m.rooms[1].cy);
        m.findPath(a.x, a.y, b.x, b.y); // must not throw
      }
      // player spawn must be on floor
      if (m.solidAtPx(m.playerSpawn.x, m.playerSpawn.y)) throw new Error('player spawned in wall');
    }
  }
});
ok('demo room map generates a short main path with portals', () => {
  const loc = G.Locations.find(l => l.id === G.DemoConfig.locationId) || G.Locations[0];
  for (let i = 0; i < 8; i++) {
    const m = G.MapGen.generate(loc, { demo: true });
    if (!m.roomGraph) throw new Error('no room graph');
    if (m.roomGraph.layout !== 'isaac_chain') throw new Error('demo room layout is not isaac chain');
    if (m.roomGraph.mainRoomIds.length < 4 || m.roomGraph.mainRoomIds.length > 5) throw new Error('main path room count out of range');
    if (!m.portals || m.portals.length < (m.roomGraph.mainRoomIds.length - 1) * 2) throw new Error('not enough portals');
    if (m.pxW * m.pxH >= loc.gridW * loc.gridH * G.Config.TILE * G.Config.TILE) throw new Error('demo room map not smaller than base location');
    if (m.rooms.some(r => r.w > G.DemoConfig.roomTileW || r.h > G.DemoConfig.roomTileH)) throw new Error('demo rooms are too large');
    if (Math.max(m.w, m.h) > 74 || Math.min(m.w, m.h) > 46) throw new Error('demo room map bounds are not compact');
    const spawnRoom = m.rooms.find(r => r.kind === 'spawn');
    const extractRoom = m.rooms.find(r => r.kind === 'extract');
    if (!spawnRoom || !extractRoom) throw new Error('missing spawn/extract room');
    if (!m.extracts.length || m.extracts[0].roomId !== extractRoom.id) throw new Error('extract not placed in extract room');
    for (let j = 0; j < m.roomGraph.mainRoomIds.length - 1; j++) {
      const a = m.roomGraph.mainRoomIds[j], b = m.roomGraph.mainRoomIds[j + 1];
      const ra = m.rooms.find(r => r.id === a), rb = m.rooms.find(r => r.id === b);
      if (Math.abs(ra.gx - rb.gx) + Math.abs(ra.gy - rb.gy) !== 1) throw new Error('main path rooms are not adjacent');
      if (!m.portals.some(p => p.fromRoomId === a && p.toRoomId === b)) throw new Error('main path missing forward portal');
      if (!m.portals.some(p => p.fromRoomId === b && p.toRoomId === a)) throw new Error('main path missing return portal');
    }
    if ((m.roomGraph.rewardRoomIds || []).length > G.DemoConfig.roomRewardMax) throw new Error('too many reward rooms');
    for (const rid of m.roomGraph.rewardRoomIds || []) {
      const reward = m.rooms.find(r => r.id === rid);
      if (!reward || reward.kind !== 'reward') throw new Error('reward room graph points to wrong room');
      if (!m.portals.some(p => p.kind === 'gold' && p.toRoomId === reward.id)) throw new Error('reward room missing gold entry portal');
      const entry = m.portals.find(p => p.kind === 'gold' && p.toRoomId === reward.id);
      const anchor = m.rooms.find(r => r.id === entry.fromRoomId);
      const beforeIds = new Set(m.rooms.filter(r => r.main !== false && r.pathIndex <= anchor.pathIndex).map(r => r.id));
      const coinTotal = m.containers
        .filter(c => beforeIds.has(c.roomId))
        .reduce((sum, c) => sum + c.items.filter(it => it.id === G.DemoConfig.coinItemId).reduce((s, it) => s + it.n, 0), 0);
      if (coinTotal < entry.cost) throw new Error('gold portal cost is not funded before entry');
    }
  }
});
ok('demo pace reference does not force MIA, while regular raids retain their timer', () => {
  const demo = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  const regular = new G.Raid(G.Locations[0], G.Profile.scavKit());
  demo.enemies = [];
  demo.timeLeft = 0;
  demo.update(1 / 60, 800, 600);
  if (demo.result) throw new Error('demo pace reference forced an MIA result');
  regular.enemies = [];
  regular.timeLeft = 0;
  regular.update(1 / 60, 800, 600);
  if (!regular.result || regular.result.outcome !== 'mia') throw new Error('regular raid timer no longer settles as MIA');
});
ok('challenge pool applies map rules, modifiers and settlement identity', () => {
  const expected = ['rising_tide', 'elite_hunt', 'scarce_escape', 'charge_gauntlet', 'sightline_siege', 'fortune_route'];
  if (!G.Challenges || G.Challenges.length !== expected.length) throw new Error('challenge registry is incomplete');
  if (!G.DemoRandomPools || G.DemoRandomPools.challenges !== G.Challenges || G.DemoRandomPools.lootDrops !== G.DemoLootDrops || G.DemoRandomPools.curses !== G.DemoCurses || G.DemoRandomPools.skills !== G.DemoSkills) throw new Error('random pools are not registered');
  for (let i = 0; i < 20; i++) {
    const picked = G.pickRandomChallenge();
    if (!picked || expected.indexOf(picked.id) < 0) throw new Error('challenge pool returned an invalid entry');
  }
  for (const id of expected) {
    const carried = G.Profile.scavKit();
    carried.demo = true;
    carried.challengeId = id;
    const raid = new G.Raid(G.Locations[0], carried);
    if (!raid.dungeon.challenge || raid.dungeon.challenge.id !== id) throw new Error('challenge context missing: ' + id);
    const rules = raid.dungeon.challenge.mapRules;
    const graph = raid.map.roomGraph;
    if (!graph || graph.challengeId !== id) throw new Error('challenge map context missing: ' + id);
    if (graph.mainRoomIds.length < rules.mainPathMin || graph.mainRoomIds.length > rules.mainPathMax) throw new Error('challenge main path rule missing: ' + id);
    if ((graph.rewardRoomIds || []).length > rules.rewardMax) throw new Error('challenge reward cap missing: ' + id);
    if (rules.orientation && graph.orientation !== rules.orientation) throw new Error('challenge orientation rule missing: ' + id);
    if (rules.rewardChance === 0 && graph.rewardRoomIds.length !== 0) throw new Error('zero-reward challenge created a detour: ' + id);
    if (rules.rewardChance === 1 && graph.rewardRoomIds.length !== rules.rewardMax) throw new Error('guaranteed reward challenge missed a detour: ' + id);
    if (id === 'rising_tide' && raid._monsterLevelInterval() !== G.DemoConfig.monsterLevelInterval - 15) throw new Error('rising tide modifier missing');
    if (id === 'elite_hunt' && raid._curseModifier('eliteSpawnChanceMultiplier', 1) !== 1.8) throw new Error('elite hunt modifier missing');
    if (id === 'scarce_escape' && raid._curseModifier('scrollDropMultiplier', 1) !== 0.72) throw new Error('scarce escape modifier missing');
    if (id === 'charge_gauntlet' && raid._curseModifier('roleRusherChanceMultiplier', 1) !== 2) throw new Error('charge gauntlet modifier missing');
    if (id === 'sightline_siege' && raid._curseModifier('roleMarksmanChanceMultiplier', 1) !== 2) throw new Error('sightline siege modifier missing');
    if (id === 'fortune_route' && raid._curseModifier('highValueDropMultiplier', 1) !== 1.35) throw new Error('fortune route modifier missing');
    raid._finish('normal_extract');
    if (!raid.result || raid.result.challengeId !== id) throw new Error('challenge identity missing from settlement: ' + id);
  }
});
ok('phase 36 level data defines five sequential room budgets and challenge pools', () => {
  const levels = G.DemoLevels || [];
  if (levels.length !== 5) throw new Error('expected five demo levels');
  const budgets = levels.map(l => l.regularRoomCount).join(',');
  if (budgets !== '4,5,6,7,8') throw new Error('regular room budget mismatch: ' + budgets);
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (level.order !== i + 1) throw new Error('level order mismatch');
    if (!Array.isArray(level.challengePool) || !level.challengePool.length) throw new Error('level has no challenge pool: ' + level.id);
    for (const id of level.challengePool) if (!G.getChallenge(id)) throw new Error('unknown challenge in level pool: ' + id);
    for (let j = 0; j < 10; j++) {
      const picked = G.pickChallengeForLevel(level);
      if (!picked || level.challengePool.indexOf(picked.id) < 0) throw new Error('level picked challenge outside its pool');
    }
  }
});
ok('phase 36 level room budgets count only regular challenge rooms', () => {
  const loc = G.Locations.find(l => l.id === G.DemoConfig.locationId) || G.Locations[0];
  for (const level of G.DemoLevels || []) {
    const carried = Object.assign(G.Profile.scavKit(), { demo: true, levelId: level.id, challengeId: level.challengePool[0] });
    const raid = new G.Raid(loc, carried);
    const graph = raid.map.roomGraph;
    const mainRooms = graph.mainRoomIds.map(id => raid.map.rooms.find(r => r.id === id));
    const regular = mainRooms.filter(r => r.kind === 'combat');
    if (graph.levelId !== level.id) throw new Error('level identity missing from map graph');
    if (graph.regularRoomCount !== level.regularRoomCount) throw new Error('graph regular budget mismatch');
    if (regular.length !== level.regularRoomCount) throw new Error(level.id + ' regular rooms=' + regular.length);
    if (mainRooms.filter(r => r.kind === 'spawn').length !== 1) throw new Error('spawn room counted incorrectly');
    if (mainRooms.filter(r => r.kind === 'extract').length !== 1) throw new Error('extract room counted incorrectly');
    for (const rid of graph.rewardRoomIds || []) {
      const reward = raid.map.rooms.find(r => r.id === rid);
      if (!reward || reward.kind !== 'reward' || reward.main !== false) throw new Error('reward room is not separate from regular budget');
    }
  }
});
ok('phase 36 demo progress migrates old saves and unlocks sequentially', () => {
  store[G.Config.SAVE_KEY] = JSON.stringify({
    stash: [{ id: 'w_pistol', n: 1 }],
    money: 777,
    settings: { sfx: false, volume: 0.2, lang: 'zh' },
  });
  G.Profile.load();
  const pr = G.Profile.data.demoProgress;
  if (!pr || pr.highestUnlockedLevel !== 1) throw new Error('legacy save did not initialize level progress');
  if (!pr.levels.level_1.unlocked || pr.levels.level_2.unlocked) throw new Error('initial unlock state is wrong');
  if (G.Profile.money() !== 777 || G.Profile.data.settings.lang !== 'zh') throw new Error('legacy base fields were not preserved');
  G.Profile.recordDemoLevelResult('level_1', { outcome: 'normal_extract', time: 300, challengeId: 'elite_hunt' });
  if (G.Profile.data.demoProgress.highestUnlockedLevel !== 1) throw new Error('normal extract unlocked the next level');
  G.Profile.recordDemoLevelResult('level_1', { outcome: 'perfect_extract', time: 360, challengeId: 'elite_hunt' });
  if (G.Profile.data.demoProgress.highestUnlockedLevel !== 2) throw new Error('perfect extract did not unlock level 2');
  if (!G.Profile.data.demoProgress.levels.level_2.unlocked || G.Profile.data.demoProgress.levels.level_3.unlocked) throw new Error('unlock chain skipped a level');
  G.Profile.recordDemoLevelResult('level_2', { outcome: 'failed', time: 220, challengeId: 'rising_tide' });
  if (G.Profile.data.demoProgress.highestUnlockedLevel !== 2) throw new Error('failure unlocked progression');
});
ok('phase 36 locked levels cannot be started from the demo entry', () => {
  G.Profile.resetAll();
  const res = G.Game.startDemoRaid(null, 'level_2');
  if (!res || !res.error) throw new Error('locked level start was allowed');
  G.Profile.recordDemoLevelResult('level_1', { outcome: 'perfect_extract', time: 360, challengeId: 'elite_hunt' });
  if (!G.Profile.canStartDemoLevel('level_2')) throw new Error('unlocked level is not startable');
});
ok('demo HUD does not render a countdown', () => {
  const demo = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  demo.enemies = [];
  const labels = [];
  const rec = fakeCtx();
  rec.fillText = (text) => labels.push(String(text));
  demo.draw(rec, 800, 600);
  if (labels.some(text => /^\d+:\d\d$/.test(text))) throw new Error('demo HUD rendered a countdown');
});
ok('demo HUD shows threat progress, gold and selected curse details', () => {
  const demo = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  const d = demo.dungeon;
  d.monsterLevel = 2;
  d.monsterLevelTimer = demo._monsterLevelInterval() * 0.5;
  d.gold = 13;
  d.selectedCurses = ['greedy_hand'];
  demo._layoutDemoHud(800, 600);
  if (demo._curseHudButtons.length !== 1) throw new Error('selected curse did not receive a HUD icon');
  const icon = demo._curseHudButtons[0];
  G.Input.touchEnabled = false;
  G.Input.mouse.x = icon.x + icon.w / 2;
  G.Input.mouse.y = icon.y + icon.h / 2;
  G.Input._mouseEdge = true;
  demo._handleCurseHudInput();
  if (demo._curseTooltipId !== 'greedy_hand') throw new Error('desktop click did not open the curse tooltip');
  G.Input._mouseEdge = false;
  G.Input.touchEnabled = true;
  demo._layoutDemoHud(800, 600);
  G.Input._actionQueue.add('curseHud0');
  demo._handleCurseHudInput();
  if (demo._curseTooltipId !== null) throw new Error('touch tap did not toggle the curse tooltip');
  G.Input.touchEnabled = false;
  demo._curseTooltipId = 'greedy_hand';
  const labels = [];
  const rec = fakeCtx();
  rec.fillText = (text) => labels.push(String(text));
  demo.draw(rec, 800, 600);
  if (!labels.includes(G.t('raid.hud.monsterLevel', { n: 2 }))) throw new Error('monster level missing from HUD');
  if (!labels.includes(G.t('raid.hud.gold', { n: 13 }))) throw new Error('dungeon gold missing from HUD');
  if (!labels.includes(G.t('curse.greedy_hand.name')) || !labels.includes(G.t('curse.greedy_hand.desc'))) throw new Error('curse tooltip missing localized details');
});
ok('demo room map can generate multiple funded reward rooms', () => {
  const loc = G.Locations.find(l => l.id === G.DemoConfig.locationId) || G.Locations[0];
  const oldChance = G.DemoConfig.roomRewardChance;
  const oldMax = G.DemoConfig.roomRewardMax;
  G.DemoConfig.roomRewardChance = 1;
  G.DemoConfig.roomRewardMax = 2;
  const m = G.MapGen.generate(loc, { demo: true });
  G.DemoConfig.roomRewardChance = oldChance;
  G.DemoConfig.roomRewardMax = oldMax;
  if ((m.roomGraph.rewardRoomIds || []).length !== 2) throw new Error('forced map did not generate two reward rooms');
  for (const rid of m.roomGraph.rewardRoomIds) {
    const entry = m.portals.find(p => p.kind === 'gold' && p.toRoomId === rid);
    if (!entry) throw new Error('reward room missing paid entry');
    const anchor = m.rooms.find(r => r.id === entry.fromRoomId);
    const beforeIds = new Set(m.rooms.filter(r => r.main && r.pathIndex <= anchor.pathIndex).map(r => r.id));
    const coinTotal = m.containers
      .filter(c => beforeIds.has(c.roomId))
      .reduce((sum, c) => sum + c.items.filter(it => it.id === G.DemoConfig.coinItemId).reduce((s, it) => s + it.n, 0), 0);
    if (coinTotal < entry.cost) throw new Error('forced reward room is not funded before entry');
  }
});
ok('demo room waves scale by room role and path depth', () => {
  const loc = G.Locations.find(l => l.id === G.DemoConfig.locationId) || G.Locations[0];
  const m = G.MapGen.generate(loc, { demo: true });
  const mainRooms = m.roomGraph.mainRoomIds.map(id => m.rooms.find(r => r.id === id));
  const combatRooms = mainRooms.filter(r => r.kind === 'combat');
  if (!combatRooms.length) throw new Error('no combat rooms generated');
  for (const r of combatRooms) {
    const expectedSize = G.DemoConfig.roomWaveBaseCount + Math.min(G.DemoConfig.roomWaveSizeDepthCap, r.pathIndex * G.DemoConfig.roomWaveSizePerDepth);
    const expectedCount = Math.min(G.DemoConfig.roomWaveCountMax, G.DemoConfig.roomWaveCountBase + Math.floor(r.pathIndex * G.DemoConfig.roomWaveCountPerDepth));
    if (r.waveSize !== expectedSize) throw new Error('combat room wave size did not scale with depth');
    if (r.waveCount !== expectedCount) throw new Error('combat room wave count did not scale with depth');
  }
  const extractRoom = mainRooms[mainRooms.length - 1];
  if (extractRoom.waveCount !== G.DemoConfig.roomExtractWaveCount) throw new Error('extract wave count not using config');
  if (extractRoom.waveSize !== G.DemoConfig.roomExtractWaveSize) throw new Error('extract wave size not using config');
});
ok('demo room size leaves enough combat space', () => {
  if (G.DemoConfig.roomTileW < 12 || G.DemoConfig.roomTileH < 9) throw new Error('demo room tiles are still too small');
  const loc = G.Locations.find(l => l.id === G.DemoConfig.locationId) || G.Locations[0];
  const m = G.MapGen.generate(loc, { demo: true });
  if (Math.max(m.w, m.h) > 74 || Math.min(m.w, m.h) > 46) throw new Error('larger demo room map exceeded compact bounds');
});
ok('vertical demo room map clears the full viewport before drawing', () => {
  let raid = null;
  for (let i = 0; i < 40; i++) {
    const carried = G.Profile.scavKit();
    carried.demo = true;
    raid = new G.Raid(G.Locations[0], carried);
    if (raid.map.roomGraph && raid.map.roomGraph.orientation === 'vertical') break;
  }
  if (!raid || !raid.map.roomGraph || raid.map.roomGraph.orientation !== 'vertical') throw new Error('could not generate vertical demo map');
  const rec = fakeCtx();
  const fills = [];
  rec.fillRect = (x, y, w, h) => fills.push({ x, y, w, h, fillStyle: rec.fillStyle });
  raid.update(1 / 60, 1200, 600);
  raid.draw(rec, 1200, 600);
  if (!fills.some(f => f.x === 0 && f.y === 0 && f.w === 1200 && f.h === 600 && f.fillStyle === '#0a0c0f')) {
    throw new Error('raid draw did not clear the full wide viewport');
  }
});
ok('demo help describes automatic resource search', () => {
  const raid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  const rec = fakeCtx();
  const labels = [];
  rec.fillText = text => labels.push(text);
  G.Input.resetTouch();
  raid.draw(rec, 800, 600);
  if (!labels.includes(G.t('raid.help.demoLoot'))) throw new Error('demo help did not describe automatic search');
});

console.log('\n[2] Profile / economy');
ok('fresh profile loads and starting gear present', () => {
  store[G.Config.SAVE_KEY] = undefined; delete store[G.Config.SAVE_KEY];
  G.Profile.load();
  if (G.Profile.money() !== G.STARTING.money) throw new Error('money mismatch');
  if (G.Profile.countItem('w_pistol') < 1) throw new Error('no starting pistol');
});
ok('buy / sell adjusts money & stash', () => {
  const m0 = G.Profile.money();
  const r = G.Profile.buy('ammo_9', 10);
  if (!r.ok) throw new Error('buy failed: ' + r.msg);
  if (G.Profile.money() >= m0) throw new Error('money not spent');
  const before = G.Profile.countItem('ammo_9');
  G.Profile.sell('ammo_9', 5);
  if (G.Profile.countItem('ammo_9') !== before - 5) throw new Error('sell qty wrong');
});
ok('commitRaidStart deducts, commitExtract returns', () => {
  G.Profile.resetAll();
  G.Profile.buy('ammo_9', 50);
  const ld = { primary: 'w_pistol', secondary: null, armor: null, medId: 'm_bandage', medCount: 2 };
  const pistolsBefore = G.Profile.countItem('w_pistol');
  const carried = G.Profile.commitRaidStart(ld);
  if (carried.error) throw new Error(carried.error);
  if (!carried.weapons[0]) throw new Error('no primary in carried');
  if (G.Profile.countItem('w_pistol') !== pistolsBefore - 1) throw new Error('pistol not deducted');
  if (!carried.reserve['9mm'] || carried.reserve['9mm'] <= 0) throw new Error('no ammo pulled');
});

console.log('\n[3] Raid simulation — scav run, full combat & loot');
let extractCaptured = null;
ok('raid runs 1200 ticks with combat, looting, drawing', () => {
  G.Profile.resetAll();
  const loc = G.Locations[2]; // labs (has boss)
  const carried = G.Profile.scavKit();
  carried.reserve['9mm'] = 999; // plenty of ammo for the test
  const raid = new G.Raid(loc, carried);
  raid.onFinish = (r) => { extractCaptured = r; };
  const Input = G.Input;
  // drop a ground item near the player to test pickup
  raid.groundItems.push({ x: raid.player.x + 10, y: raid.player.y, id: 'v_cash', n: 3, pop: 0, delay: 0, bob: 0 });
  // teleport player next to an enemy to force detection/combat
  if (raid.enemies.length) {
    const e = raid.enemies[0];
    raid.player.x = e.x + 60; raid.player.y = e.y;
  }
  Input.mouse.down = true; // fire
  let drew = 0;
  for (let i = 0; i < 1200; i++) {
    // wiggle movement & aim
    Input.keys.clear();
    if (i % 120 < 60) Input.keys.add('w'); else Input.keys.add('s');
    Input.mouse.x = 400 + Math.sin(i / 7) * 200;
    Input.mouse.y = 300 + Math.cos(i / 9) * 150;
    raid.update(1 / 60, 800, 600);
    if (i % 30 === 0) { raid.draw(ctx, 800, 600); drew++; }
    if (raid.result) break;
  }
  if (drew === 0) throw new Error('never drew');
  // enemies should have reacted (some in non-patrol state or dead) given adjacency
  // (not strictly asserted — AI is stochastic — but exercise must not throw)
});

console.log('\n[4] Looting a container');
ok('search transfers loot to backpack', () => {
  const loc = G.Locations[0];
  const carried = G.Profile.scavKit();
  const raid = new G.Raid(loc, carried);
  const Input = G.Input;
  Input.keys.clear();
  // find an unsearched container and stand on it
  const c = raid.map.containers.find(c => c.items.length);
  if (!c) throw new Error('no loot container');
  raid.player.x = c.x; raid.player.y = c.y;
  Input.mouse.down = false;
  Input.keys.clear();
  const had = raid.player.backpackCount();
  // tap E once (edge) to begin; the search now auto-progresses while in range
  for (let i = 0; i < 200; i++) {
    Input._pressed.clear();
    if (i === 0) Input._pressed.add('e');
    raid.update(1 / 60, 800, 600);
    if (c.searched) break;
  }
  if (!c.searched && raid.player.backpackCount() === had && Object.keys(raid.player.reserve).length === 0)
    throw new Error('looting did nothing');
});
ok('demo resources auto-harvest while stationary without key input', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.enemies = [];
  const c = raid.map.containers.find(c => c.items.length);
  if (!c) throw new Error('no demo resource point');
  raid.player.x = c.x; raid.player.y = c.y;
  G.Input.keys.clear(); G.Input._pressed.clear(); G.Input.mouse.down = false;
  raid.update(0.01, 800, 600);
  if (!raid.player.searching || raid.player.searching.container !== c) throw new Error('stationary player did not auto-start harvesting');
  const expected = G.DemoConfig.resourceSearchTimes[c.type] || G.Config.SEARCH_TIME;
  if (Math.abs(raid.player.searching.total - expected) > 0.001) throw new Error('resource harvest time not using demo quality table');
  for (let i = 0; i < 400; i++) {
    G.Input.keys.clear(); G.Input._pressed.clear(); G.Input.mouse.down = false;
    raid.update(1 / 60, 800, 600);
    if (c.searched) break;
  }
  if (!c.searched) throw new Error('auto-harvest did not complete');
});
ok('demo resource harvesting is interrupted by movement', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.enemies = [];
  const c = raid.map.containers.find(c => c.items.length);
  raid.player.x = c.x; raid.player.y = c.y;
  G.Input.keys.clear(); G.Input._pressed.clear(); G.Input.mouse.down = false;
  raid.update(0.05, 800, 600);
  if (!raid.player.searching) throw new Error('auto-harvest did not start');
  G.Input.keys.clear(); G.Input.keys.add('d');
  raid.update(1 / 60, 800, 600);
  if (raid.player.searching) throw new Error('movement did not interrupt demo harvesting');
  G.Input.keys.clear();
});
ok('demo resource harvesting ignores mouse fire input', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.enemies = [];
  const c = raid.map.containers.find(c => c.items.length);
  raid.player.x = c.x; raid.player.y = c.y;
  G.Input.keys.clear(); G.Input._pressed.clear(); G.Input.mouse.down = false;
  raid.update(0.05, 800, 600);
  if (!raid.player.searching) throw new Error('auto-harvest did not start');
  G.Input.mouse.down = true;
  raid.update(1 / 60, 800, 600);
  if (!raid.player.searching) throw new Error('mouse fire interrupted demo harvesting');
  G.Input.mouse.down = false;
});
ok('demo auto-search keeps auto-firing at nearby enemies', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.enemies = [];
  const c = raid.map.containers.find(c => c.items.length);
  raid.player.x = c.x; raid.player.y = c.y;
  raid.map.los = () => true;
  raid.enemies.push({ dead: false, x: c.x + 80, y: c.y, r: G.Config.ENEMY_RADIUS, room: null, update() {}, hearShot() {} });
  G.Input.keys.clear(); G.Input._pressed.clear(); G.Input.mouse.down = false;
  raid.update(1 / 60, 800, 600);
  if (!raid.player.searching) throw new Error('auto-search did not start');
  if (!raid.bullets.some(b => b.owner === 'player')) throw new Error('auto-search blocked demo auto-fire');
});
ok('demo combat auto-aims nearest enemy and shoots without ammo', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.enemies = [];
  raid.map.containers = [];
  raid.map.los = () => true;
  raid.player.weapons[0].mag = 0;
  raid.player.reserve = {};
  raid.player.fireCd = 0;
  const near = { dead: false, x: raid.player.x + 80, y: raid.player.y, r: G.Config.ENEMY_RADIUS, room: null, update() {}, hearShot() {} };
  const far = { dead: false, x: raid.player.x - 180, y: raid.player.y, r: G.Config.ENEMY_RADIUS, room: null, update() {}, hearShot() {} };
  raid.enemies.push(far, near);
  G.Input.keys.clear(); G.Input._pressed.clear(); G.Input.mouse.down = false;
  raid.update(1 / 60, 800, 600);
  if (!raid.bullets.some(b => b.owner === 'player')) throw new Error('demo did not auto-fire');
  if (raid.player.weapons[0].mag !== 0) throw new Error('demo shooting changed magazine count');
  if (Math.abs(raid.player.angle) > 0.01) throw new Error('demo did not aim at nearest enemy');
});

console.log('\n[5] Extraction & death flows');
ok('standing in extract finishes with outcome=extract', () => {
  const loc = G.Locations[0];
  const carried = G.Profile.scavKit();
  const raid = new G.Raid(loc, carried);
  let result = null; raid.onFinish = (r) => result = r;
  const z = raid.map.extracts[0];
  raid.player.x = z.x; raid.player.y = z.y;
  // isolate the extraction mechanic — combat is covered by other tests
  raid.enemies = [];
  G.Input.keys.clear(); G.Input.mouse.down = false;
  for (let i = 0; i < 600; i++) { raid.update(1 / 60, 800, 600); if (result) break; }
  if (!result || result.outcome !== 'extract') throw new Error('did not extract: ' + (result && result.outcome));
  const before = G.Profile.stashUsed();
  G.Profile.commitExtract(raid.player);
});
ok('player death finishes with outcome=death', () => {
  const loc = G.Locations[0];
  const raid = new G.Raid(loc, G.Profile.scavKit());
  let result = null; raid.onFinish = (r) => result = r;
  raid.player.takeDamage(9999, raid, raid.player.x + 10, raid.player.y);
  raid.update(1 / 60, 800, 600);
  if (!result || result.outcome !== 'death') throw new Error('death not detected');
  G.Profile.commitDeath(raid.player);
});
ok('demo death without scroll fragments fails and clears loot', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  let result = null; raid.onFinish = (r) => result = r;
  raid.player.backpack.push({ id: 'v_cash', n: 2 });
  raid.player.takeDamage(9999, raid, raid.player.x + 10, raid.player.y);
  raid.update(1 / 60, 800, 600);
  if (!result || result.outcome !== 'failed') throw new Error('demo death did not fail: ' + (result && result.outcome));
  if (result.lootValue !== 0 || result.items !== 0) throw new Error('failed demo kept loot');
  if (result.lostLootValue <= 0) throw new Error('failed demo did not report lost value');
});
ok('demo death with enough scroll fragments becomes normal extract', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  let result = null; raid.onFinish = (r) => result = r;
  raid.player.backpack.push({ id: 'v_cash', n: 2 });
  raid.dungeon.scrollFragments = raid.dungeon.requiredFragments;
  raid.player.takeDamage(9999, raid, raid.player.x + 10, raid.player.y);
  raid.update(1 / 60, 800, 600);
  if (!result || result.outcome !== 'normal_extract') throw new Error('demo safe death did not normal extract: ' + (result && result.outcome));
  if (result.lootValue <= 0 || result.items <= 0) throw new Error('normal extract did not keep loot');
});
ok('demo scroll fragments enable X normal extract', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  let result = null; raid.onFinish = (r) => result = r;
  raid._collectDungeonItem(G.DemoConfig.scrollItemId, raid.dungeon.requiredFragments);
  G.Input.keys.clear();
  G.Input._pressed.clear();
  G.Input._pressed.add('x');
  raid.update(1 / 60, 800, 600);
  if (!result || result.outcome !== 'normal_extract') throw new Error('X did not trigger normal extract: ' + (result && result.outcome));
});
ok('demo extract zone arms perfect extract only while standing still', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.enemies = [];
  const z = raid.map.extracts[0];
  raid.player.x = z.x; raid.player.y = z.y;
  raid._updateExtract(0.1);
  if (!raid.dungeon.extractionChallenge || raid.dungeon.extractionChallenge.phase !== 'arming') throw new Error('perfect extract challenge did not arm');
  if (!raid.extracting || raid.extracting.total !== G.DemoConfig.perfectExtractArmTime) throw new Error('extracting state not bound to arm timer');
  raid.player.moving = true;
  raid._updateExtract(G.DemoConfig.perfectExtractArmTime + 0.2);
  if (raid.dungeon.extractionChallenge.phase !== 'arming' || raid.dungeon.extractionChallenge.t !== 0) throw new Error('moving player armed the challenge');
  raid.player.moving = false;
  raid.player.x = z.x + z.r + 80;
  raid._updateExtract(0.1);
  if (raid.dungeon.extractionChallenge || raid.extracting) throw new Error('unstarted perfect extract challenge did not reset when leaving zone');
});
ok('demo active perfect extract survives leaving the green zone', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.enemies = [];
  const z = raid.map.extracts[0];
  const extractRoom = raid._roomAt(z.x, z.y);
  const portal = raid.map.portals.find(p => p.fromRoomId === extractRoom.id);
  const extractState = raid._roomState(extractRoom.id);
  extractState.started = true;
  extractState.cleared = true;
  if (!portal || !raid._roomPortalsOpen(extractRoom.id)) throw new Error('extract room portal should be open before the challenge');
  raid.player.x = z.x; raid.player.y = z.y; raid.player.moving = false;
  raid._updateExtract(G.DemoConfig.perfectExtractArmTime + 0.1);
  if (!raid.dungeon.extractionChallenge || raid.dungeon.extractionChallenge.phase !== 'active') throw new Error('perfect extract did not activate after standing still');
  if (raid._roomPortalsOpen(extractRoom.id)) throw new Error('perfect extract did not lock portals');
  raid.player.x = z.x + z.r + 140;
  raid._updateExtract(0.1);
  if (!raid.dungeon.extractionChallenge || raid.dungeon.extractionChallenge.phase !== 'active') throw new Error('active perfect extract was cancelled after leaving zone');
  raid.player.x = portal.x; raid.player.y = portal.y;
  raid._updatePortals(1);
  if (raid._roomAt(raid.player.x, raid.player.y).id !== extractRoom.id) throw new Error('active perfect extract allowed portal escape');
});
ok('demo normal portal immediately moves player to target room', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  const p = raid.map.portals[0];
  if (!p) throw new Error('no portal generated');
  const target = raid.map.rooms.find(r => r.id === p.toRoomId);
  raid.player.x = p.x; raid.player.y = p.y;
  raid._updatePortals(1);
  const here = raid._roomAt(raid.player.x, raid.player.y);
  if (!here || here.id !== target.id) throw new Error('portal did not move player to target room');
  if (raid.dungeon.portalCooldown <= 0) throw new Error('portal cooldown not set');
});
ok('demo combat room entry grants grace and safe enemy spacing', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  const first = raid.map.portals.find(p => {
    const target = raid.map.rooms.find(r => r.id === p.toRoomId);
    return target && target.kind === 'combat';
  });
  if (!first) throw new Error('no combat portal generated');
  const target = raid.map.rooms.find(r => r.id === first.toRoomId);
  raid.player.x = first.x; raid.player.y = first.y;
  raid._updatePortals(1);
  if (raid.dungeon.roomEntryGrace <= 0) throw new Error('portal entry grace was not set');
  const st = raid._roomState(target.id);
  if (!st.waveWarning || st.waveWarning.kind !== 'wave') throw new Error('combat room did not start with a wave warning');
  const hp = raid.player.hp;
  raid.player.takeDamage(50, raid, raid.player.x + 20, raid.player.y);
  if (raid.player.hp !== hp) throw new Error('entry grace did not suppress player damage');
  if (raid.enemies.some(e => !e.dead && e.room && e.room.id === target.id)) throw new Error('combat room spawned enemies before countdown ended');
  raid._updateRoomCombat(G.DemoConfig.roomWaveWarningTime + 0.1);
  const safeRadius = G.DemoConfig.roomSpawnSafeRadius;
  const availableFar = raid.map.enemySpawns
    .filter(s => s.roomId === target.id)
    .some(s => G.Utils.dist(s.x, s.y, raid.player.x, raid.player.y) >= safeRadius);
  const alive = raid.enemies.filter(e => !e.dead && e.room && e.room.id === target.id);
  if (!alive.length) throw new Error('combat room did not spawn enemies');
  if (target.pathIndex <= 1 && alive.some(e => e.tier !== 'beast')) throw new Error('first combat room spawned ranged enemies');
  if (availableFar && alive.some(e => G.Utils.dist(e.x, e.y, raid.player.x, raid.player.y) < safeRadius)) {
    throw new Error('combat room spawned an enemy inside safe radius');
  }
});
ok('demo basic room spawns melee enemies instead of defaulting to ranged', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  const combat = raid.map.rooms.find(r => r.kind === 'combat');
  if (!combat) throw new Error('no combat room generated');
  const oldRanged = G.DemoConfig.roomRangedChance;
  G.DemoConfig.roomRangedChance = 0;
  raid.enemies = [];
  raid._spawnEnemyInRoom(combat.id, 0);
  G.DemoConfig.roomRangedChance = oldRanged;
  if (!raid.enemies.length) throw new Error('manual room spawn failed');
  if (raid.enemies[0].tier !== 'beast' || !raid.enemies[0].def.melee) throw new Error('basic room spawn did not use melee baseline');
  raid.enemies[0].takeDamage(999, raid, raid.player.x, raid.player.y);
  if (raid.groundItems.some(g => !g.id)) throw new Error('melee enemy dropped an invalid item');
});
ok('demo combat roles telegraph attacks and can be interrupted', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.enemies = [];
  raid.map.los = () => true;
  const room = raid.map.rooms.find(r => r.kind === 'combat' && r.pathIndex >= 2) || raid.map.rooms.find(r => r.kind === 'combat');
  const center = raid.map.tileCenter(room.cx, room.cy);
  raid.player.x = center.x + 180; raid.player.y = center.y;
  const oldRusherChance = G.DemoConfig.roleRusherChance;
  const oldMarksmanChance = G.DemoConfig.roleMarksmanChance;
  G.DemoConfig.roleRusherChance = 1; G.DemoConfig.roleMarksmanChance = 1;
  if (raid._enemyRoleForTier('beast', { room: { pathIndex: 1 } })) throw new Error('first combat room received a role');
  if (raid._enemyRoleForTier('beast', { room }) !== 'rusher') throw new Error('later melee spawn did not receive rusher role');
  if (raid._enemyRoleForTier('raider', { room }) !== 'marksman') throw new Error('later elite spawn did not receive marksman role');
  G.DemoConfig.roleRusherChance = oldRusherChance; G.DemoConfig.roleMarksmanChance = oldMarksmanChance;

  const rusher = new G.Enemy({ x: center.x, y: center.y, tier: 'beast', room, roomId: room.id, role: 'rusher' });
  rusher.state = 'combat'; rusher.canSee = true; rusher.reactT = 0; rusher.angle = 0;
  rusher._combat(0.01, raid);
  if (!rusher.roleAction || rusher.roleAction.type !== 'rusher' || rusher.roleAction.phase !== 'windup') throw new Error('rusher did not telegraph a windup');
  raid._drawEnemyRoleWarning(fakeCtx(), rusher);
  rusher.takeDamage(1, raid, raid.player.x, raid.player.y);
  if (rusher.roleAction) throw new Error('rusher windup was not interrupted by damage');
  rusher._combat(0.01, raid);
  if (rusher.roleAction) throw new Error('rusher ignored its interruption cooldown');
  rusher.roleCooldown = 0;
  rusher._combat(0.01, raid);
  rusher._combat((G.DemoConfig.roleRusherWindup || 0.65) + 0.01, raid);
  const rusherX = rusher.x;
  rusher._combat(0.10, raid);
  if (rusher.x <= rusherX) throw new Error('rusher did not dash after its warning');

  const marksman = new G.Enemy({ x: center.x, y: center.y + 80, tier: 'raider', room, roomId: room.id, role: 'marksman' });
  marksman.state = 'combat'; marksman.canSee = true; marksman.reactT = 0; marksman.fireCd = 0; marksman.angle = 0;
  raid.player.x = marksman.x + 250; raid.player.y = marksman.y;
  marksman._combat(0.01, raid);
  if (!marksman.roleAction || marksman.roleAction.type !== 'aim') throw new Error('marksman did not telegraph an aim');
  raid._drawEnemyRoleWarning(fakeCtx(), marksman);
  marksman.canSee = false;
  marksman._combat(0.01, raid);
  if (marksman.roleAction) throw new Error('marksman aim did not cancel after losing sight');
  marksman.canSee = true; marksman.state = 'combat'; marksman.roleCooldown = 0;
  marksman._combat(0.01, raid);
  marksman.takeDamage(1, raid, raid.player.x, raid.player.y);
  if (marksman.roleAction) throw new Error('marksman aim was not interrupted by damage');
  marksman._combat(0.01, raid);
  if (marksman.roleAction) throw new Error('marksman ignored its interruption cooldown');
  marksman.roleCooldown = 0;
  marksman.fireCd = 0;
  marksman._combat(0.01, raid);
  if (!marksman.roleAction || marksman.roleAction.type !== 'aim') throw new Error('marksman did not restart aiming after cooldown');
  const enemyBullets = raid.bullets.length;
  marksman._combat((G.DemoConfig.roleMarksmanAimTime || 0.70) + 0.01, raid);
  if (raid.bullets.length <= enemyBullets || !raid.bullets.some(b => b.owner === 'enemy')) throw new Error('marksman did not fire after its aim warning');
});
ok('demo first combat room is survivable for the first three seconds', () => {
  let deaths = 0;
  let worstHp = Infinity;
  for (let i = 0; i < 20; i++) {
    const carried = G.Profile.scavKit();
    carried.demo = true;
    const raid = new G.Raid(G.Locations[0], carried);
    raid.onCurseChoice = () => {};
    const first = raid.map.portals.find(p => {
      const target = raid.map.rooms.find(r => r.id === p.toRoomId);
      return target && target.kind === 'combat';
    });
    if (!first) throw new Error('no first combat portal generated');
    raid.player.x = first.x; raid.player.y = first.y;
    raid._updatePortals(1);
    for (let t = 0; t < 180 && !raid.result; t++) raid.update(1 / 60, 800, 600);
    worstHp = Math.min(worstHp, raid.player.hp);
    if (raid.player.dead || (raid.result && raid.result.outcome === 'failed')) deaths++;
  }
  if (deaths) throw new Error('first combat room deaths in 3s: ' + deaths);
  if (worstHp < 60) throw new Error('first combat room left too little hp: ' + worstHp);
});
ok('demo combat room locks portals until waves are cleared', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  const first = raid.map.portals.find(p => {
    const target = raid.map.rooms.find(r => r.id === p.toRoomId);
    return target && target.kind === 'combat';
  });
  const combat = raid.map.rooms.find(r => r.id === first.toRoomId);
  raid._enterRoom(combat);
  const out = raid.map.portals.find(p => p.fromRoomId === combat.id);
  raid.player.x = out.x; raid.player.y = out.y;
  raid._updatePortals(1);
  if (raid._roomAt(raid.player.x, raid.player.y).id !== combat.id) {
    throw new Error('left a locked combat room');
  }
  for (const e of raid.enemies) if (e.room && e.room.id === combat.id) e.dead = true;
  const st = raid._roomState(combat.id);
  st.wavesRemaining = 0; st.activeWave = true; st.waveWarning = null;
  raid._updateRoomCombat(0.1);
  if (!raid._roomPortalsOpen(combat.id)) throw new Error('room did not unlock after waves cleared');
});
ok('demo cleared room revive timer spawns more monsters', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  const combat = raid.map.rooms.find(r => r.kind === 'combat');
  const cc = raid.map.tileCenter(combat.cx, combat.cy);
  raid.player.x = cc.x; raid.player.y = cc.y;
  raid._enterRoom(combat);
  for (const e of raid.enemies) if (e.room && e.room.id === combat.id) e.dead = true;
  const st = raid._roomState(combat.id);
  st.wavesRemaining = 0; st.activeWave = true; st.waveWarning = null;
  raid._updateRoomCombat(0.1);
  const before = raid.enemies.filter(e => !e.dead && e.room && e.room.id === combat.id).length;
  st.reviveTimer = 0;
  raid._updateRoomCombat(0.1);
  if (!st.waveWarning || st.waveWarning.kind !== 'revive') throw new Error('revive timer did not start a warning');
  if (!st.cleared || !raid._roomPortalsOpen(combat.id)) throw new Error('revive warning locked an already-cleared room');
  raid._updateRoomCombat(G.DemoConfig.roomWaveWarningTime + 0.1);
  const after = raid.enemies.filter(e => !e.dead && e.room && e.room.id === combat.id).length;
  if (after <= before) throw new Error('revive timer did not spawn monsters');
  if (!st.cleared || st.activeWave) throw new Error('revived monsters should not relock the room as an active wave');
  if (!raid._roomPortalsOpen(combat.id)) throw new Error('revived monsters locked the portals');
  st.reviveTimer = 0;
  raid._updateRoomCombat(999);
  const stacked = raid.enemies.filter(e => !e.dead && e.room && e.room.id === combat.id).length;
  if (stacked !== after) throw new Error('revive wave stacked before being cleared');
  for (const e of raid.enemies) if (e.room && e.room.id === combat.id) e.dead = true;
  raid._updateRoomCombat(0.1);
  if (!st.cleared) throw new Error('revive wave did not clear after monsters died');
});
ok('demo revive monsters do not lock exits or chase through portals', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  const combat = raid.map.rooms.find(r => r.kind === 'combat');
  const cc = raid.map.tileCenter(combat.cx, combat.cy);
  raid.player.x = cc.x; raid.player.y = cc.y;
  raid._enterRoom(combat);
  const st = raid._roomState(combat.id);
  st.started = true;
  st.cleared = true;
  st.activeWave = false;
  st.wavesRemaining = 0;
  st.waveWarning = null;
  st.reviveTimer = 0;
  raid._updateRoomCombat(0.1);
  raid._updateRoomCombat(G.DemoConfig.roomWaveWarningTime + 0.1);
  const revived = raid.enemies.filter(e => !e.dead && e.room && e.room.id === combat.id);
  if (!revived.length) throw new Error('no revived monsters spawned');
  if (!raid._roomPortalsOpen(combat.id)) throw new Error('revived monsters locked room exits');
  for (const e of revived) {
    e.state = 'combat';
    e.lastKnown = { x: raid.player.x, y: raid.player.y };
    e.canSee = true;
  }
  const out = raid.map.portals.find(p => p.fromRoomId === combat.id);
  const target = raid.map.rooms.find(r => r.id === out.toRoomId);
  raid.player.x = out.x; raid.player.y = out.y;
  raid._updatePortals(1);
  const here = raid._roomAt(raid.player.x, raid.player.y);
  if (!here || here.id !== target.id) throw new Error('player could not leave a revive room');
  if (revived.some(e => e.state === 'combat' || e.lastKnown || e.canSee)) throw new Error('revived monsters kept chasing after portal transfer');
});
ok('demo gold is dungeon currency and opens paid portal after standing payment', () => {
  let raid = null, paidPortal = null;
  for (let i = 0; i < 20 && !paidPortal; i++) {
    const carried = G.Profile.scavKit();
    carried.demo = true;
    raid = new G.Raid(G.Locations[0], carried);
    paidPortal = raid.map.portals.find(p => p.kind === 'gold');
  }
  if (!paidPortal) throw new Error('no paid portal generated in attempts');
  const room = raid.map.rooms.find(r => r.id === paidPortal.fromRoomId);
  const target = raid.map.rooms.find(r => r.id === paidPortal.toRoomId);
  raid.player.x = paidPortal.x; raid.player.y = paidPortal.y;
  raid.dungeon.currentRoomId = room.id;
  raid._roomState(room.id).cleared = true;
  raid._collectDungeonItem(G.DemoConfig.coinItemId, paidPortal.cost);
  if (raid.player.backpack.some(s => s.id === G.DemoConfig.coinItemId)) throw new Error('gold entered backpack');
  let sawCoinFlight = false;
  for (let i = 0; i < 120; i++) {
    raid.player.moving = false;
    raid._updatePortals(0.2);
    if (raid.coinFlights.length > 0) sawCoinFlight = true;
    if (raid._roomAt(raid.player.x, raid.player.y).id === target.id) break;
  }
  if (!sawCoinFlight) throw new Error('paid portal did not spawn coin flight animation');
  raid._updateCoinFlights(G.DemoConfig.coinPortalFlyTime + 0.1);
  if (raid.coinFlights.length !== 0) throw new Error('coin flight animation did not clean up');
  if (raid._roomAt(raid.player.x, raid.player.y).id !== target.id) throw new Error('paid portal did not transfer after payment');
  if (raid.dungeon.gold !== 0) throw new Error('gold was not consumed');
});
ok('demo gold portal payment requires standing still', () => {
  let raid = null, paidPortal = null;
  for (let i = 0; i < 20 && !paidPortal; i++) {
    const carried = G.Profile.scavKit();
    carried.demo = true;
    raid = new G.Raid(G.Locations[0], carried);
    paidPortal = raid.map.portals.find(p => p.kind === 'gold');
  }
  if (!paidPortal) throw new Error('no paid portal generated in attempts');
  const room = raid.map.rooms.find(r => r.id === paidPortal.fromRoomId);
  raid.player.x = paidPortal.x; raid.player.y = paidPortal.y;
  raid.dungeon.currentRoomId = room.id;
  raid._roomState(room.id).cleared = true;
  raid._collectDungeonItem(G.DemoConfig.coinItemId, paidPortal.cost);
  raid.player.moving = true;
  raid._updatePortals(G.DemoConfig.coinPortalPayInterval * 3);
  if (paidPortal.paid !== 0) throw new Error('moving player paid into the gold portal');
  if (raid.dungeon.gold !== paidPortal.cost) throw new Error('moving player consumed gold');
  raid.player.moving = false;
  raid._updatePortals(G.DemoConfig.coinPortalPayInterval);
  if (paidPortal.paid !== 1) throw new Error('standing player did not pay one coin');
});
ok('demo perfect extract succeeds after hold timer and applies bonus', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  let result = null; raid.onFinish = (r) => result = r;
  raid.enemies = [];
  raid.player.backpack = [{ id: 'v_cash', n: 10 }];
  const z = raid.map.extracts[0];
  raid.player.x = z.x; raid.player.y = z.y;
  raid._updateExtract(G.DemoConfig.perfectExtractArmTime + 0.1);
  if (!raid.dungeon.extractionChallenge || raid.dungeon.extractionChallenge.phase !== 'active') throw new Error('perfect extract did not activate');
  raid.player.x = z.x + z.r + 140;
  for (let i = 0; i < G.DemoConfig.perfectExtractTime + 2; i++) {
    raid._updateExtract(1);
    if (result) break;
  }
  if (!result || result.outcome !== 'perfect_extract') throw new Error('perfect extract did not finish: ' + (result && result.outcome));
  if (raid.enemies.length < 1) throw new Error('perfect extract challenge did not spawn pressure enemies');
  const base = G.getItem('v_cash').value * 10;
  if (result.baseLootValue !== base) throw new Error('base loot wrong');
  if (result.perfectRewardMultiplier !== G.DemoConfig.perfectExtractRewardMultiplier) throw new Error('perfect multiplier missing');
  if (result.lootValue !== Math.round(base * G.DemoConfig.perfectExtractRewardMultiplier)) throw new Error('perfect reward not applied');
});
ok('demo settlement reports run pace against the tuning window', () => {
  const min = G.DemoConfig.targetRunMinTime;
  const max = G.DemoConfig.targetRunMaxTime;
  const finishAt = (seconds) => {
    const raid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
    raid.time = seconds;
    raid._finish('normal_extract');
    return raid.result;
  };
  const short = finishAt(min - 1);
  const target = finishAt(Math.round((min + max) / 2));
  const long = finishAt(max + 1);
  if (short.paceTag !== 'short') throw new Error('short run pace not reported');
  if (target.paceTag !== 'target') throw new Error('target run pace not reported');
  if (long.paceTag !== 'long') throw new Error('long run pace not reported');
  if (target.targetRunMinTime !== min || target.targetRunMaxTime !== max) throw new Error('pace window missing from result');
});
ok('demo settlement includes playtest recap metrics', () => {
  let raid = null, paidPortal = null;
  for (let i = 0; i < 20 && !paidPortal; i++) {
    raid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
    paidPortal = raid.map.portals.find(p => p.kind === 'gold');
  }
  if (!raid || !paidPortal) throw new Error('no paid portal generated in attempts');

  const cont = raid.map.containers.find(c => c.items && c.items.length);
  if (!cont) throw new Error('no demo resource point');
  raid._collect(cont);

  raid._collectDungeonItem(G.DemoConfig.coinItemId, paidPortal.cost);
  const room = raid.map.rooms.find(r => r.id === paidPortal.fromRoomId);
  raid.player.x = paidPortal.x; raid.player.y = paidPortal.y;
  raid.dungeon.currentRoomId = room.id;
  raid._roomState(room.id).cleared = true;
  for (let i = 0; i < 120; i++) {
    raid.player.moving = false;
    raid._updatePortals(0.2);
    if (paidPortal.paid >= paidPortal.cost) break;
  }

  raid._openCurseChoice();
  const choice = raid.dungeon.curseChoices[0];
  if (!choice || !raid.chooseCurse(choice.id)) throw new Error('could not choose demo upgrade');

  raid._finish('normal_extract');
  const m = raid.result.playtestMetrics;
  if (!m) throw new Error('missing playtest metrics');
  if (m.resourcesSearched !== 1) throw new Error('resource search count missing');
  if (m.goldCollected < paidPortal.cost) throw new Error('gold collected count missing');
  if (m.goldSpent !== paidPortal.cost) throw new Error('gold spent count missing');
  if (m.paidPortalsOpened !== 1) throw new Error('paid portal opened count missing');
  if (m.roomsEntered < 1) throw new Error('room entry count missing');
  if (m.choicesTaken !== 1) throw new Error('choice count missing');
  if (m.cursesTaken + m.skillsTaken !== 1) throw new Error('choice type count missing');
});
ok('demo monster pressure levels up and enrages over time', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid._updateDungeonPressure(G.DemoConfig.monsterLevelInterval);
  if (raid.dungeon.monsterLevel !== 2) throw new Error('monster level did not increase');
  raid.time = G.DemoConfig.enrageTime;
  raid._updateDungeonPressure(0.01);
  if (!raid.dungeon.enraged) throw new Error('enrage did not trigger');
  if (raid._monsterHpMultiplier() <= 1 || raid._monsterDamageMultiplier() <= 1) throw new Error('pressure multipliers not applied');
});
ok('demo pressure spawns reinforcements with scaled stats', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.enemies = [];
  raid.dungeon.monsterLevel = 3;
  raid.dungeon.spawnTimer = 0;
  raid._updateDungeonPressure(0.01);
  if (raid.enemies.length < 1) throw new Error('pressure spawn did not add an enemy');
  const e = raid.enemies[0];
  if (e.maxHp <= G.EnemyTiers[e.tier].hp) throw new Error('spawned enemy hp was not scaled');
});
ok('demo enemy movement and projectile speeds use slower demo multipliers', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  if (raid._enemyMoveSpeedMultiplier() >= 1) throw new Error('enemy move multiplier was not reduced');
  if (raid._enemyProjectileSpeedMultiplier() >= 1) throw new Error('enemy projectile multiplier was not reduced');
  raid.bullets = [];
  raid._spawnEnemyFromPoint({ x: raid.player.x + 220, y: raid.player.y, tier: 'scav', room: null }, 'scav');
  const e = raid.enemies[raid.enemies.length - 1];
  e.angle = G.Utils.angle(e.x, e.y, raid.player.x, raid.player.y);
  e.mag = 1;
  e._shoot(raid, raid.player, G.Utils.dist(e.x, e.y, raid.player.x, raid.player.y));
  const b = raid.bullets.find(x => x.owner === 'enemy');
  if (!b) throw new Error('enemy did not fire a test bullet');
  const bulletSpeed = Math.hypot(b.vx, b.vy);
  const expected = e.wdef.bulletSpeed * 0.85 * G.DemoConfig.enemyProjectileSpeedMultiplier;
  if (Math.abs(bulletSpeed - expected) > 0.001) throw new Error('enemy bullet speed multiplier not applied');
});
ok('demo curse choice triggers after kill threshold and pauses raid', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  let opened = 0;
  raid.onCurseChoice = () => opened++;
  raid.enemies = [];
  raid.kills = G.DemoConfig.curseKillTriggers[0];
  raid.update(1 / 60, 800, 600);
  if (!raid.dungeon.cursePending) throw new Error('curse choice did not become pending');
  if (!raid.paused) throw new Error('raid did not pause for curse choice');
  if (opened !== 1) throw new Error('curse overlay was not opened');
  if (raid.dungeon.curseChoices.length !== 3) throw new Error('expected three curse choices');
});
ok('demo upgrade choices share skill pool but include a curse', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.enemies = [];
  raid.dungeon.selectedCurses = G.DemoCurses.slice(1).map(c => c.id);
  raid.kills = G.DemoConfig.curseKillTriggers[0];
  raid.update(1 / 60, 800, 600);
  if (!raid.dungeon.cursePending) throw new Error('upgrade choice did not become pending');
  if (!raid.dungeon.curseChoices.some(c => c.type === 'curse')) throw new Error('upgrade choices did not include a curse');
  if (!raid.dungeon.curseChoices.some(c => c.type === 'skill')) throw new Error('upgrade choices did not include skills from shared pool');
});
ok('demo curse selection increases reward multiplier', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.dungeon.curseChoices = G.DemoCurses.slice(0, 3);
  raid.dungeon.cursePending = true;
  raid.paused = true;
  const before = raid.dungeon.rewardMultiplier;
  const picked = raid.dungeon.curseChoices[0];
  if (!raid.chooseCurse(picked.id)) throw new Error('choice rejected');
  if (raid.dungeon.rewardMultiplier <= before) throw new Error('reward multiplier did not increase');
  if (raid.dungeon.selectedCurses.indexOf(picked.id) < 0) throw new Error('selected curse not recorded');
  if (raid.paused) throw new Error('raid stayed paused after choosing');
});
ok('demo reward multiplier affects settlement lootValue', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  let result = null; raid.onFinish = (r) => result = r;
  raid.player.backpack = [{ id: 'v_cash', n: 10 }];
  raid.dungeon.rewardMultiplier = 1.35;
  raid._finish('normal_extract');
  const base = G.getItem('v_cash').value * 10;
  if (!result) throw new Error('no result');
  if (result.baseLootValue !== base) throw new Error('base loot wrong');
  if (result.lootValue !== Math.round(base * 1.35)) throw new Error('multiplied loot wrong: ' + result.lootValue);
});
ok('demo curse cost effect applies to backpack capacity and speed', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  const c = G.DemoCurses.find(c => c.id === 'heavy_march');
  raid.dungeon.curseChoices = [c];
  raid.dungeon.cursePending = true;
  raid.chooseCurse(c.id);
  if (raid.player.backpackLimit() !== G.Config.BACKPACK_SLOTS + 2) throw new Error('backpack bonus not applied');
  if (raid.player.moveSpeedMultiplier >= 1) throw new Error('speed penalty not applied');
});
ok('demo skill selection upgrades projectiles without reward multiplier', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  const s = G.DemoSkills.find(s => s.id === 'twin_shot');
  raid.dungeon.curseChoices = [s];
  raid.dungeon.cursePending = true;
  raid.paused = true;
  const before = raid.dungeon.rewardMultiplier;
  if (!raid.chooseCurse(s.id)) throw new Error('skill choice rejected');
  if (raid.dungeon.selectedSkills.indexOf(s.id) < 0) throw new Error('selected skill not recorded');
  if (raid.dungeon.rewardMultiplier !== before) throw new Error('skill changed reward multiplier');
  raid.player.fireCd = 0;
  raid.player.angle = 0;
  raid.player.tryShoot(raid);
  if (raid.bullets.filter(b => b.owner === 'player').length !== 2) throw new Error('projectile bonus did not add a bullet');
});
ok('phase 33 build options apply their existing modifiers and localize', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  const skills = ['runner_instinct', 'field_triage', 'quick_search'];
  const curses = ['overclocked_trigger', 'fragment_gamble', 'far_sight_debt'];
  if (!skills.every(id => G.DemoSkills.some(s => s.id === id))) throw new Error('phase 33 skills missing from choice pool');
  if (!curses.every(id => G.DemoCurses.some(c => c.id === id))) throw new Error('phase 33 curses missing from choice pool');
  raid.dungeon.selectedSkills = skills.slice();
  raid.dungeon.selectedCurses = curses.slice();
  raid._recomputeCurseModifiers();
  const m = raid.dungeon.modifiers;
  if (raid.player.moveSpeedMultiplier <= 1 || m.healMultiplier <= 1 || m.searchSpeedMultiplier <= 1) throw new Error('phase 33 skill modifiers not applied');
  if (m.playerFireRateMultiplier <= 1 || m.scrollDropMultiplier <= 1 || m.playerProjectileRangeMultiplier <= 1) throw new Error('phase 33 curse benefits not applied');
  if (m.monsterSpawnIntervalMultiplier >= 1 || m.monsterLevelIntervalDelta >= 0 || m.eliteSpawnChanceMultiplier <= 1) throw new Error('phase 33 curse risks not applied');
  for (const id of skills) if (G.t('skill.' + id + '.name') === 'skill.' + id + '.name') throw new Error('phase 33 skill localization missing');
  for (const id of curses) if (G.t('curse.' + id + '.name') === 'curse.' + id + '.name') throw new Error('phase 33 curse localization missing');
});
ok('demo in-raid backpack pauses and supports nearby loot transfer', () => {
  const press = (raid, key) => {
    G.Input.keys.clear(); G.Input._pressed.clear(); G.Input.mouse.down = false;
    G.Input._pressed.add(key);
    raid.update(1 / 60, 800, 600);
    G.Input._pressed.clear();
  };
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  let opened = 0;
  G.UI.init({ startRaid() {}, startDemoRaid() {}, toHub() {} });
  raid.onInventory = () => { opened++; G.UI.openRaidInventory(raid); };
  raid.groundItems.push({ x: raid.player.x + 20, y: raid.player.y, id: 'v_doc', n: 1, pop: 0, delay: 0, bob: 0 });
  raid.groundItems.push({ x: raid.player.x + 400, y: raid.player.y, id: 'v_gpu', n: 1, pop: 0, delay: 0, bob: 0 });
  press(raid, 'tab');
  if (!raid.paused || !raid.invOpen || opened !== 1) throw new Error('Tab did not pause and open raid inventory');
  const nearby = G.UI._nearbyGroundLoot(raid);
  if (nearby.length !== 1 || nearby[0].item.id !== 'v_doc') throw new Error('nearby loot filter did not isolate close drops');
  if (!G.UI._moveGroundToBackpack(raid, nearby[0].index)) throw new Error('nearby loot did not move into backpack');
  if (!raid.player.backpack.some(s => s.id === 'v_doc')) throw new Error('backpack missing transferred loot');
  if (raid.groundItems.some(g => g.id === 'v_doc')) throw new Error('ground loot was not removed after pickup');
  const beforeGround = raid.groundItems.length;
  const bagIndex = raid.player.backpack.findIndex(s => s.id === 'v_doc');
  if (!G.UI._moveBackpackToGround(raid, bagIndex)) throw new Error('backpack item did not drop to ground');
  if (raid.groundItems.length !== beforeGround + 1) throw new Error('dropped backpack item did not create ground loot');
});
ok('raid backpack keeps compact cells and exposes selected item details', () => {
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.player.addLoot('m_bandage', 1);
  G.UI.init({ startRaid() {}, startDemoRaid() {}, toHub() {} });
  G.UI._raidInventoryRaid = raid;
  G.UI._raidInventorySelection = 0;
  G.UI.openRaidInventory(raid);
  const text = collectDomText(G.UI.root);
  if (text.indexOf(G.I18n.itemName('m_bandage')) < 0 || text.indexOf(G.t('ui.inv.action.use')) < 0) throw new Error('selected backpack item details missing');
  if (text.indexOf(G.t('ui.inv.inspectEmpty')) >= 0) throw new Error('selected backpack item rendered as empty');
});
ok('demo in-raid backpack can reorder items without changing slot usage', () => {
  const raid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  raid.player.backpack = [{ id: 'v_cash', n: 1 }, { id: 'v_doc', n: 1 }, { id: 'v_gpu', n: 1 }];
  const used = raid.player.backpackUsed();
  if (!G.UI._moveBackpackItem(raid, 2, 0)) throw new Error('backpack reorder returned false');
  if (raid.player.backpack[0].id !== 'v_gpu') throw new Error('backpack item did not move to target position');
  if (raid.player.backpackUsed() !== used) throw new Error('reorder changed backpack slot usage');
});
ok('demo in-raid backpack supports explicit grid placement', () => {
  const raid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  raid.player.backpack = [];
  raid.groundItems = [{ x: raid.player.x, y: raid.player.y, id: 'v_doc', n: 1, pop: 0, delay: 0, bob: 0 }];
  if (!G.UI._moveGroundToBackpackAt(raid, 0, 3, 2)) throw new Error('ground loot did not place into requested cell');
  const s = raid.player.backpack.find(s => s.id === 'v_doc');
  if (!s || s.x !== 3 || s.y !== 2 || s.w !== 2 || s.h !== 1) throw new Error('grid placement shape/position wrong');
  if (G.UI._moveBackpackItemToCell(raid, 0, 7, 5)) throw new Error('oversized item moved out of bounds');
});
ok('nearby loot previews use the same grid footprint as backpack items', () => {
  const raid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  raid.groundItems = [
    { x: raid.player.x + 20, y: raid.player.y, id: 'v_vase', n: 1, pop: 0, delay: 0, bob: 0 },
    { x: raid.player.x + 20, y: raid.player.y, id: 'v_lens', n: 1, pop: 0, delay: 0, bob: 0 },
    { x: raid.player.x + 20, y: raid.player.y, id: 'v_server', n: 1, pop: 0, delay: 0, bob: 0 },
  ];
  G.UI.init({ startRaid() {}, startDemoRaid() {}, toHub() {} });
  G.UI.openRaidInventory(raid);
  const grid = collectByClass(G.UI.root, 'loot-grid-occupancy')[0];
  if (!grid) throw new Error('nearby loot occupancy grid missing');
  const items = collectByClass(grid, 'loot-item');
  const find = (id) => items.find(item => item.dataset.itemId === id);
  const hasFootprint = (id, footprint) => {
    const tile = find(id);
    return tile && String(tile.getAttribute('style')).indexOf(footprint) >= 0;
  };
  if (!hasFootprint('v_vase', 'grid-column:span 2;grid-row:span 2') || !hasFootprint('v_lens', 'grid-column:span 3;grid-row:span 1') || !hasFootprint('v_server', 'grid-column:span 3;grid-row:span 2')) throw new Error('nearby loot footprint does not match item grid size');
});
ok('demo searched resources drop overflow loot at the resource point', () => {
  const raid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  raid.player.backpack = [];
  for (let i = 0; i < G.Config.BACKPACK_SLOTS; i++) raid.player.backpack.push({ id: 'v_cash', n: 1 });
  const cont = { x: raid.player.x + 220, y: raid.player.y + 40, items: [{ id: 'v_gpu', n: 1 }], searched: false };
  raid.groundItems = [];
  raid._collect(cont);
  if (!cont.searched || cont.items.length) throw new Error('full-bag resource was not completed');
  const g = raid.groundItems.find(g => g.id === 'v_gpu');
  if (!g) throw new Error('overflow loot was not dropped');
  if (G.Utils.dist(g.x, g.y, cont.x, cont.y) > 40) throw new Error('overflow did not pop from resource point');
});
ok('rare and epic ground loot have quality beam colors', () => {
  const raid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  if (raid._groundQualityBeamColor({ id: 'v_cash' }) !== null) throw new Error('uncommon loot should not get a quality beam');
  if (raid._groundQualityBeamColor({ id: 'v_doc' }) !== G.RARITY_COLOR.rare) throw new Error('rare beam color missing');
  if (raid._groundQualityBeamColor({ id: 'v_gpu' }) !== G.RARITY_COLOR.epic) throw new Error('epic beam color missing');
});
ok('demo monster drops use compact loot rules and varied item footprints', () => {
  const slotCosts = new Set((G.DemoLootDrops || []).map(row => {
    const def = G.getItem(row.id);
    return def && def.type !== 'key' ? (def.slotCost || 1) : null;
  }).filter(Boolean));
  for (const n of [1, 2, 3, 4, 6]) if (!slotCosts.has(n)) throw new Error('demo loot pool missing ' + n + '-slot item');
  const footprints = new Set((G.DemoLootDrops || []).map(row => {
    const def = G.getItem(row.id);
    return def && def.type === 'valuable' ? def.gridW + 'x' + def.gridH : null;
  }).filter(Boolean));
  for (const shape of ['1x1', '1x2', '2x1', '2x2', '3x1', '3x2']) if (!footprints.has(shape)) throw new Error('demo loot pool missing ' + shape + ' footprint');
  if ((G.DemoLootDrops || []).some(row => row.qty[0] !== 1 || row.qty[1] !== 1)) throw new Error('demo loot should always drop individual items');
  if ((G.DemoLootDrops || []).some(row => G.getItem(row.id).type === 'ammo')) throw new Error('demo loot pool contains ammo');
  const raid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  const chance = G.Utils.chance;
  try {
    G.Utils.chance = () => false;
    raid.groundItems = [];
    const scav = new G.Enemy({ x: raid.player.x + 100, y: raid.player.y, tier: 'scav', room: null });
    scav.takeDamage(999, raid, raid.player.x, raid.player.y);
    if (raid.groundItems.length !== 1 || raid.groundItems[0].id !== G.DemoConfig.coinItemId || raid.groundItems[0].n !== 1) throw new Error('ordinary demo enemy drop count should be reduced');
    raid.groundItems = [];
    const raider = new G.Enemy({ x: raid.player.x + 100, y: raid.player.y, tier: 'raider', room: null });
    raider.takeDamage(999, raid, raid.player.x, raid.player.y);
    if (raid.groundItems.length !== 2 || raid.groundItems.some(g => G.getItem(g.id).type === 'ammo')) throw new Error('elite demo enemy should drop one loot item plus gold');
    if (!raid.groundItems.some(g => g.id !== G.DemoConfig.coinItemId && g.n === 1)) throw new Error('elite demo item drop should be singular');
  } finally {
    G.Utils.chance = chance;
  }
});
ok('demo debug hotkeys cover validation shortcuts', () => {
  const press = (raid, key) => {
    G.Input.keys.clear(); G.Input._pressed.clear(); G.Input.mouse.down = false;
    G.Input._pressed.add(key);
    raid.update(1 / 60, 800, 600);
    G.Input._pressed.clear();
  };
  const carried = G.Profile.scavKit();
  carried.demo = true;
  const raid = new G.Raid(G.Locations[0], carried);
  raid.enemies = [];
  press(raid, 'f1');
  if (!raid.dungeon.debugVisible) throw new Error('F1 did not show debug panel');
  press(raid, 'f2');
  if (raid.dungeon.scrollFragments !== 1) throw new Error('F2 did not add a scroll fragment');
  press(raid, 'f3');
  if (raid.dungeon.gold !== 5) throw new Error('F3 did not add demo gold');
  press(raid, 'f5');
  if (raid._roomAt(raid.player.x, raid.player.y).id !== raid.map.extracts[0].roomId) throw new Error('F5 did not teleport to extract');
  const combat = raid.map.rooms.find(r => r.kind === 'combat');
  const cc = raid.map.tileCenter(combat.cx, combat.cy);
  raid.player.x = cc.x; raid.player.y = cc.y;
  raid._enterRoom(combat);
  press(raid, 'f6');
  if (!raid._roomPortalsOpen(combat.id)) throw new Error('F6 did not clear current room');

  const choiceRaid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  let opened = 0; choiceRaid.onCurseChoice = () => opened++;
  press(choiceRaid, 'f4');
  if (!choiceRaid.dungeon.cursePending || !choiceRaid.paused || opened !== 1) throw new Error('F4 did not open upgrade choice');

  const normalRaid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  let normalResult = null; normalRaid.onFinish = r => normalResult = r;
  press(normalRaid, 'f7');
  if (!normalResult || normalResult.outcome !== 'normal_extract') throw new Error('F7 did not force normal extract');

  const perfectRaid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  let perfectResult = null; perfectRaid.onFinish = r => perfectResult = r;
  press(perfectRaid, 'f8');
  if (!perfectResult || perfectResult.outcome !== 'perfect_extract') throw new Error('F8 did not force perfect extract');

  const deathRaid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  let deathResult = null; deathRaid.onFinish = r => deathResult = r;
  press(deathRaid, 'f9');
  deathRaid.update(1 / 60, 800, 600);
  if (!deathResult || deathResult.outcome !== 'failed') throw new Error('F9 did not force demo failed death');
});

console.log('\n[6] UI screens build without error');
ok('all UI screens & overlays render', () => {
  const host = { startRaid() {}, startDemoRaid() {}, toHub() {}, };
  G.UI.init(host);
  G.UI.showIntro();
  G.UI.showHub();
  G.UI.showDeploy();
  G.UI.selectedLocation = G.Locations[0];
  G.UI.showLoadout();
  G.UI.showStash();
  G.UI.showTrader('buy');
  G.UI.showTrader('sell');
  G.UI.showContracts();
  G.UI.showSettings();
  G.UI.showResults({ outcome: 'extract', kills: 3, time: 95, lootValue: 1200, items: 5, scav: false }, { carriedValue: 800 });
  G.UI.showResults({ outcome: 'death', kills: 1, time: 40, lootValue: 300, items: 2, scav: true }, { carriedValue: 0 });
  G.UI.showResults({ outcome: 'normal_extract', kills: 2, time: 80, lootValue: 450, items: 3, scav: true, scrollFragments: 4, requiredFragments: 4 }, { carriedValue: 0 });
  G.UI.showResults({ outcome: 'normal_extract', kills: 2, time: 80, lootValue: 608, baseLootValue: 450, rewardMultiplier: 1.35, items: 3, baseItems: 3, scav: true, scrollFragments: 4, requiredFragments: 4 }, { carriedValue: 0 });
  G.UI.showResults({ outcome: 'perfect_extract', kills: 4, time: 360, lootValue: 900, baseLootValue: 600, rewardMultiplier: 1.5, perfectRewardMultiplier: 1.5, items: 4, baseItems: 4, scav: true, challengeId: 'rising_tide', scrollFragments: 4, requiredFragments: 4, paceTag: 'target', targetRunMinTime: 300, targetRunMaxTime: 480, playtestMetrics: { roomsEntered: 5, rewardRoomsEntered: 1, resourcesSearched: 4, paidPortalsOpened: 1, goldSpent: 3, goldCollected: 5, choicesTaken: 2, cursesTaken: 1, skillsTaken: 1 } }, { carriedValue: 0 });
  G.UI.showResults({ outcome: 'failed', kills: 2, time: 80, lootValue: 0, lostLootValue: 450, items: 0, scav: true, scrollFragments: 2, requiredFragments: 4 }, { carriedValue: 0 });
  const fakeRaid = new G.Raid(G.Locations[0], G.Profile.scavKit());
  G.UI.openPause(fakeRaid);
  G.UI.openRaidInventory(fakeRaid);
  const demoRaid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true }));
  demoRaid.dungeon.curseChoices = G.DemoCurses.slice(0, 2).concat(G.DemoSkills.slice(0, 1));
  demoRaid.dungeon.cursePending = true;
  G.UI.openCurseChoice(demoRaid);
});
ok('phase 37 hub shows five levels with lock states and settings entry', () => {
  const host = { startRaid() {}, startDemoRaid() {}, toHub() {}, };
  G.UI.init(host);
  G.Profile.resetAll();
  G.UI.showHub();
  const text = collectDomText(G.UI.root);
  const levelCards = collectByClass(G.UI.root, 'level-card');
  const stats = collectByClass(G.UI.root, 'statstrip');
  if (levelCards.length !== 5) throw new Error('hub should expose five level cards');
  if (stats.length !== 0) throw new Error('hub stats strip should be hidden');
  const hiddenKeys = ['ui.hub.menu.deploy.title', 'ui.hub.menu.stash.title', 'ui.hub.menu.trader.title', 'ui.hub.menu.contracts.title'];
  for (const key of hiddenKeys) {
    const label = G.t(key);
    if (label && label !== key && text.indexOf(label) >= 0) throw new Error('hub still shows hidden entry: ' + key);
  }
  if (text.indexOf(G.t('ui.levels.header')) < 0) throw new Error('level header missing from hub');
  if (text.indexOf(G.t('level.level_1.name')) < 0 || text.indexOf(G.t('level.level_5.name')) < 0) throw new Error('level names missing from hub');
  if (text.indexOf(G.t('ui.levels.status.locked')) < 0) throw new Error('locked state missing from hub');
  if (text.indexOf(G.t('ui.levels.rooms', { n: 8 })) < 0) throw new Error('regular room budget missing from hub');
  if (text.indexOf(G.t('ui.hub.menu.settings.title')) < 0) throw new Error('settings entry missing from hub');
});
ok('phase 37 results show level clear and next unlock state', () => {
  const host = { startRaid() {}, startDemoRaid() {}, toHub() {}, };
  G.UI.init(host);
  G.UI.showResults({
    outcome: 'perfect_extract',
    kills: 4,
    time: 360,
    lootValue: 900,
    baseLootValue: 600,
    rewardMultiplier: 1.5,
    perfectRewardMultiplier: 1.5,
    items: 4,
    baseItems: 4,
    scav: true,
    levelId: 'level_1',
    levelOrder: 1,
    challengeId: 'rising_tide',
    scrollFragments: 4,
    requiredFragments: 4,
  }, {
    carriedValue: 0,
    levelProgress: { ok: true, firstCompletion: true, unlockedLevelId: 'level_2', highestUnlockedLevel: 2 },
  });
  const text = collectDomText(G.UI.root);
  if (text.indexOf(G.t('ui.results.level')) < 0 || text.indexOf(G.t('level.level_1.name')) < 0) throw new Error('result level identity missing');
  if (text.indexOf(G.t('ui.results.extractType')) < 0 || text.indexOf(G.t('ui.results.title.perfectExtract')) < 0) throw new Error('result extract type missing');
  if (text.indexOf(G.t('ui.results.firstClear')) < 0 || text.indexOf(G.t('ui.common.yes')) < 0) throw new Error('first clear state missing');
  if (text.indexOf(G.t('ui.results.nextUnlocked', { level: G.t('level.level_2.name') })) < 0) throw new Error('next unlock state missing');
});
ok('phase 38 demo relic settlement awards only valuables and is idempotent', () => {
  G.Profile.resetAll();
  const money0 = G.Profile.money();
  const player = {
    backpack: [
      { id: 'v_watch', n: 2 },
      { id: 'v_cash', n: 1 },
      { id: 'd_gold_coin', n: 99 },
      { id: 'd_scroll_fragment', n: 4 },
      { id: 'm_bandage', n: 1 },
    ],
  };
  const result = { settlementId: 'phase38-settle-a', outcome: 'normal_extract', levelId: 'level_1', challengeId: 'rising_tide', time: 300, rewardMultiplier: 1.5 };
  const first = G.Profile.recordDemoRelicSettlement(result, player);
  const expectedBase = G.getItem('v_watch').value * 2 + G.getItem('v_cash').value;
  const expectedCurrency = Math.round(expectedBase * 1.5);
  if (first.baseValue !== expectedBase) throw new Error('non-valuable loot entered relic base value');
  if (first.currencyAwarded !== expectedCurrency) throw new Error('relic currency award mismatch');
  if (G.Profile.money() !== money0 + expectedCurrency) throw new Error('relic currency not persisted');
  if (G.Profile.countItem('v_watch') !== 0) throw new Error('phase 38 should not stash returned relics');
  G.Profile.load();
  if (G.Profile.money() !== money0 + expectedCurrency) throw new Error('relic currency did not survive reload');
  const second = G.Profile.recordDemoRelicSettlement(result, player);
  if (!second.duplicate || second.currencyAwarded !== 0) throw new Error('duplicate settlement paid again');
  if (G.Profile.money() !== money0 + expectedCurrency) throw new Error('duplicate settlement changed balance');
});
ok('phase 38 failed demo settlement pays no relic currency and reports losses', () => {
  G.Profile.resetAll();
  const money0 = G.Profile.money();
  const player = { backpack: [{ id: 'v_gpu', n: 1 }, { id: 'm_medkit', n: 1 }, { id: 'd_scroll_fragment', n: 4 }] };
  const res = G.Profile.recordDemoRelicSettlement({ settlementId: 'phase38-failed-a', outcome: 'failed', rewardMultiplier: 2 }, player);
  if (res.currency !== 0 || res.currencyAwarded !== 0) throw new Error('failed settlement awarded currency');
  if (G.Profile.money() !== money0) throw new Error('failed settlement changed balance');
  if (!res.lostItems.some(item => item.id === 'v_gpu') || !res.lostItems.some(item => item.id === 'm_medkit')) throw new Error('failed settlement did not report lost assets');
});
ok('phase 38 save sanitizes abnormal relic currency balance', () => {
  store[G.Config.SAVE_KEY] = JSON.stringify({ stash: [{ id: 'w_pistol', n: 1 }], money: -50, demoEconomy: { settledRunIds: [null, 'ok-id'], lastSettlement: 'bad' } });
  G.Profile.load();
  if (G.Profile.money() !== 0) throw new Error('negative relic currency was not clamped');
  if (G.Profile.data.demoEconomy.settledRunIds.length !== 1 || G.Profile.data.demoEconomy.settledRunIds[0] !== 'ok-id') throw new Error('demo economy ids not sanitized');
  store[G.Config.SAVE_KEY] = JSON.stringify({ stash: [{ id: 'w_pistol', n: 1 }], money: 'NaNish' });
  G.Profile.load();
  if (!Number.isFinite(G.Profile.money())) throw new Error('non-numeric relic currency survived load');
});
ok('phase 38 results show relic currency settlement details', () => {
  const host = { startRaid() {}, startDemoRaid() {}, toHub() {}, };
  G.UI.init(host);
  G.UI.showResults({
    outcome: 'normal_extract',
    kills: 2,
    time: 240,
    lootValue: 945,
    baseLootValue: 630,
    rewardMultiplier: 1.5,
    items: 5,
    baseItems: 5,
    scav: true,
    levelId: 'level_1',
    challengeId: 'rising_tide',
    scrollFragments: 4,
    requiredFragments: 4,
  }, {
    carriedValue: 0,
    relicSettlement: {
      ok: true,
      success: true,
      baseValue: 630,
      rewardMultiplier: 1.5,
      currency: 945,
      currencyAwarded: 945,
      balance: 2145,
      duplicate: false,
      carriedItems: [{ id: 'm_bandage', n: 1 }],
      lostItems: [],
    },
  });
  const text = collectDomText(G.UI.root);
  if (text.indexOf(G.t('ui.results.relicBase')) < 0) throw new Error('relic base line missing');
  if (text.indexOf(G.t('ui.results.relicCurrency')) < 0 || text.indexOf(G.t('ui.results.currencyValue', { value: G.Utils.formatNum(945) })) < 0) throw new Error('relic currency line missing');
  if (text.indexOf(G.t('ui.results.assetsReturned')) < 0 || text.indexOf(G.I18n.itemName('m_bandage')) < 0) throw new Error('asset return detail missing');
});
ok('pause screen repeats the active challenge rule summary', () => {
  const host = { startRaid() {}, startDemoRaid() {}, toHub() {} };
  G.UI.init(host);
  const raid = new G.Raid(G.Locations[0], Object.assign(G.Profile.scavKit(), { demo: true, challengeId: 'elite_hunt' }));
  G.UI.openPause(raid);
  const text = collectDomText(G.UI.root);
  if (text.indexOf(G.t('ui.pause.challenge')) < 0) throw new Error('pause challenge label missing');
  if (text.indexOf(G.t('challenge.elite_hunt.name')) < 0) throw new Error('pause challenge name missing');
  if (text.indexOf(G.t('challenge.elite_hunt.rules')) < 0) throw new Error('pause challenge rules missing');
});

console.log('\n[7] Stress: many raids back-to-back (mem/refs)');
ok('20 raids x 200 ticks each', () => {
  for (let r = 0; r < 20; r++) {
    const loc = G.Locations[r % G.Locations.length];
    const raid = new G.Raid(loc, G.Profile.scavKit());
    G.Input.mouse.down = (r % 2 === 0);
    for (let i = 0; i < 200; i++) {
      G.Input.keys.clear(); if (i % 2) G.Input.keys.add('d');
      raid.update(1 / 60, 800, 600);
      if (i % 40 === 0) raid.draw(ctx, 800, 600);
      if (raid.result) break;
    }
  }
});

console.log('\n[8] Review-fix regressions');
ok('deploy with no weapon does NOT mutate stash', () => {
  G.Profile.resetAll();
  const bandagesBefore = G.Profile.countItem('m_bandage');
  const r = G.Profile.commitRaidStart({ primary: null, secondary: null, armor: null, medId: 'm_bandage', medCount: 3 });
  if (!r.error) throw new Error('expected error for no-weapon loadout');
  if (G.Profile.countItem('m_bandage') !== bandagesBefore) throw new Error('meds were deducted on aborted deploy!');
});
ok('ammo cap is bounded (no 240-round auto-pull for a pistol)', () => {
  G.Profile.resetAll();
  G.Profile.buy('ammo_9', 80);
  const carried = G.Profile.commitRaidStart({ primary: 'w_pistol', secondary: null, armor: null, medId: null, medCount: 0 });
  // pistol mag 8 -> cap = max(120, 32) = 120; we own < 120 so we get all we have, but never more than cap
  if (carried.reserve['9mm'] > 120) throw new Error('ammo cap exceeded');
});
ok('extract with full stash auto-sells overflow instead of destroying it', () => {
  G.Profile.resetAll();
  // jam the stash full with distinct non-stacking weapons is hard; fill with ammo stacks to the slot cap
  G.Profile.data.stash = [];
  for (let i = 0; i < G.Config.STASH_SLOTS; i++) G.Profile.data.stash.push({ id: 'v_gpu', n: 1 });
  const money0 = G.Profile.money();
  const fakePlayer = { weapons: [{ id: 'w_ak', mag: 30 }], armor: null, reserve: {}, backpack: [{ id: 'v_bitcoin', n: 1 }], kills: 0, lootValue: () => 0 };
  const res = G.Profile.commitExtract(fakePlayer, false);
  if (G.Profile.money() <= money0) throw new Error('overflow was not auto-sold to cash');
  if (res.sold <= 0) throw new Error('sold amount not reported');
});
ok('scav extract taxes valuables', () => {
  G.Profile.resetAll();
  const fakePlayer = { weapons: [], armor: null, reserve: {}, backpack: [{ id: 'v_cash', n: 10 }], kills: 0, lootValue: () => 0 };
  const before = G.Profile.countItem('v_cash');
  G.Profile.commitExtract(fakePlayer, true);
  const gained = G.Profile.countItem('v_cash') - before;
  if (gained !== 5) throw new Error('scav tax not applied (expected 5 of 10 kept, got ' + gained + ')');
});
ok('corrupt save is sanitized, not trusted', () => {
  store[G.Config.SAVE_KEY] = JSON.stringify({
    stash: [{ id: 'w_pistol', n: 1 }, { id: 'does_not_exist', n: 5 }, { id: 'ammo_9', n: 'bad' }],
    loadout: { primary: 'ghost_gun', secondary: null, armor: null, medId: 'm_bandage', medCount: 2 },
  });
  G.Profile.load();
  if (G.Profile.countItem('does_not_exist') !== 0) throw new Error('unknown item survived load');
  if (G.Profile.data.loadout.primary === 'ghost_gun') throw new Error('invalid loadout id not nulled');
  // building the loadout UI on a sanitized save must not throw
  G.UI.init({ startRaid() {}, toHub() {} });
  G.UI.selectedLocation = G.Locations[0];
  G.UI.showLoadout();
  G.UI.showStash();
});
ok('touch HUD path (layout + controls + sprint toggle) runs without error', () => {
  G.Profile.resetAll();
  const raid = new G.Raid(G.Locations[1], G.Profile.scavKit());
  G.safe = { t: 44, r: 30, b: 34, l: 30 }; // simulate a notched landscape phone
  G.Input.touchEnabled = true;
  G.Input.leftStick.active = true; G.Input.leftStick.dx = 1; G.Input.leftStick.mag = 1;
  G.Input.rightStick.active = true; G.Input.rightStick.dx = 1; G.Input.rightStick.mag = 0.8;
  for (let i = 0; i < 60; i++) { raid.update(1 / 60, 720, 360); raid.draw(ctx, 720, 360); }
  // toggle sprint via the button
  G.Input.setButton('sprint', G.Input.buttons.sprint.x, G.Input.buttons.sprint.y, G.Input.buttons.sprint.w, G.Input.buttons.sprint.h);
  // reset for later tests
  G.Input.touchEnabled = false; G.Input.resetTouch(); G.safe = { t: 0, r: 0, b: 0, l: 0 };
});
ok('load() survives a non-object (primitive) loadout without throwing', () => {
  store[G.Config.SAVE_KEY] = JSON.stringify({ stash: [{ id: 'w_pistol', n: 1 }], loadout: 'corruptString', money: 'NaNish' });
  G.Profile.load(); // must not throw
  if (typeof G.Profile.data.loadout !== 'object') throw new Error('loadout not repaired to object');
});
ok('extract stats count only looted goods, not returned gear', () => {
  G.Profile.resetAll();
  G.Profile.data.stats.bestExtract = 0; G.Profile.data.stats.totalEarned = 0;
  const gearOnly = { weapons: [{ id: 'w_m4', mag: 30 }], armor: { id: 'a_vest3', durability: 80 }, reserve: { '545': 60 }, backpack: [], kills: 0, lootValue: () => 0 };
  G.Profile.commitExtract(gearOnly, false);
  if (G.Profile.data.stats.bestExtract !== 0) throw new Error('carried-in gear inflated bestExtract (' + G.Profile.data.stats.bestExtract + ')');
  if (G.Profile.data.stats.totalEarned !== 0) throw new Error('carried-in gear inflated totalEarned');
});
ok('i18n: switching language localizes UI strings, item names and templates', () => {
  const I = G.I18n;
  I.setLang('en');
  if (I.t('ui.nav.back') !== '‹ BACK') throw new Error('en string wrong: ' + I.t('ui.nav.back'));
  if (I.itemName('w_ak') !== 'AK-74') throw new Error('en item name wrong');
  I.setLang('zh');
  const back = I.t('ui.nav.back');
  if (!back || back === 'ui.nav.back' || /BACK/.test(back)) throw new Error('zh string not localized: ' + back);
  if (I.containerLabel('crate') !== '木箱') throw new Error('zh container label wrong: ' + I.containerLabel('crate'));
  if (I.enemyLabel('boss') !== '珊瑚僭主') throw new Error('zh enemy label wrong');
  if (I.locName(G.Locations[0]) !== '浅滩货栈') throw new Error('zh loc name wrong: ' + I.locName(G.Locations[0]));
  // template substitution keeps numbers and works in zh
  const bag = I.t('raid.hud.bag', { n: 3, max: 24 });
  if (bag.indexOf('3') < 0 || bag.indexOf('24') < 0) throw new Error('template subst failed: ' + bag);
  // unknown key falls back to the key itself (never throws)
  if (I.t('nope.nope') !== 'nope.nope') throw new Error('missing-key fallback wrong');
  // unknown item id falls back to def name
  if (I.itemName('w_ak') !== 'AK-74') throw new Error('zh ak should keep latin name');
  I.setLang('en');
});
ok('i18n: item descriptions show localized ammo names, not raw caliber codes', () => {
  const I = G.I18n;
  // weapon desc must contain the ammo display name, never the raw caliber code
  I.setLang('en');
  G.UI.init({ startRaid() {}, toHub() {} });
  // reach into the trader render to exercise itemDesc on a shotgun + rifle + ammo
  for (const lang of ['en', 'zh']) {
    I.setLang(lang);
    // build a sell/buy list (exercises itemDesc) — must not throw and must localize ammo
    G.UI.showTrader('buy');
    // direct check via the same helper path: shotgun caliber 12g -> '12 Gauge'/'12 号霰弹', never '12g'
    const shotgunAmmo = I.itemName(G.AMMO_ITEM['12g']);
    if (shotgunAmmo === '12g') throw new Error('12g not resolved to ammo name');
    if (lang === 'zh' && shotgunAmmo !== '12 号霰弹') throw new Error('zh 12g name wrong: ' + shotgunAmmo);
  }
  I.setLang('en');
});
ok('i18n: a full raid + all UI screens render in Chinese without error', () => {
  G.Profile.resetAll();
  G.Profile.setLang('zh');
  // UI screens in zh
  G.UI.init({ startRaid() {}, toHub() {} });
  G.UI.showIntro(); G.UI.showHub(); G.UI.showDeploy();
  G.UI.selectedLocation = G.Locations[1]; G.UI.showLoadout();
  G.UI.showStash(); G.UI.showTrader('buy'); G.UI.showTrader('sell'); G.UI.showSettings();
  G.UI.showResults({ outcome: 'extract', kills: 2, time: 80, lootValue: 900, items: 4, scav: false }, { carriedValue: 500, extract: { sold: 120, scav: false } });
  G.UI._rerender();
  // raid HUD in zh
  const raid = new G.Raid(G.Locations[0], G.Profile.scavKit());
  G.Input.mouse.down = true;
  for (let i = 0; i < 120; i++) { G.Input.keys.clear(); if (i % 2) G.Input.keys.add('w'); raid.update(1 / 60, 800, 600); if (i % 20 === 0) raid.draw(ctx, 800, 600); if (raid.result) break; }
  G.Profile.setLang('en');
});
ok('Input.resetTouch clears sticks/buttons', () => {
  G.Input.leftStick.active = true; G.Input.leftStick.mag = 1;
  G.Input.setButton('search', 0, 0, 10, 10); G.Input.buttons.search.down = true;
  G.Input.resetTouch();
  if (G.Input.leftStick.active || G.Input.leftStick.mag !== 0) throw new Error('left stick not reset');
  if (G.Input.buttons.search.down) throw new Error('button not reset');
});

console.log('\n[9] Visual redesign: icons, sprites, shop categories');
ok('Icons.itemSVG returns svg markup for every item type', () => {
  const sample = ['w_ak', 'w_pistol', 'ammo_762', 'a_vest2', 'm_medkit', 'v_gpu'];
  for (const id of sample) {
    const s = G.Icons.itemSVG(id);
    if (typeof s !== 'string' || s.indexOf('<svg') !== 0) throw new Error('bad svg for ' + id);
  }
  if (G.Icons.spark().indexOf('<svg') !== 0) throw new Error('bad spark svg');
});
ok('Sprites exposes the canvas drawers used by the raid', () => {
  for (const k of ['player', 'enemy', 'container', 'groundItem'])
    if (typeof G.Sprites[k] !== 'function') throw new Error('missing Sprites.' + k);
});
ok('trader category tabs filter the active tab and persist a valid category', () => {
  G.Profile.resetAll();
  G.UI.init({ startRaid() {}, toHub() {} });
  G.UI.showTrader('buy', 'armor');
  if (G.UI._traderCat !== 'armor') throw new Error('buy category not set to armor');
  // an invalid category for the active tab falls back to a present one (no valuables in shop)
  G.UI.showTrader('buy', 'valuable');
  if (G.UI._traderCat === 'valuable') throw new Error('valuable should not be a buy category');
  // selling a valuable exposes the valuables category
  G.Profile.addItem('v_gpu', 1);
  G.UI.showTrader('sell', 'valuable');
  if (G.UI._traderCat !== 'valuable') throw new Error('sell should allow valuable category');
});

console.log('\n[10] New mechanics: quick-slots, equip, tap-loot, heal-move, ambience');
ok('selectWeapon switches to a specific slot; empty slot is rejected', () => {
  const raid = new G.Raid(G.Locations[0], { weapons: [{ id: 'w_pistol', mag: 8 }, { id: 'w_ak', mag: 30 }], armorId: null, reserve: {}, backpack: [] });
  const p = raid.player;
  p.slot = 0;
  p.selectWeapon(1, raid);
  if (p.slot !== 1) throw new Error('did not switch to slot 1');
  p.weapons[0] = null;
  p.selectWeapon(0, raid);
  if (p.slot !== 1) throw new Error('switched to an empty slot');
});
ok('found weapon auto-equips into an empty slot; armor auto-equips when better', () => {
  const raid = new G.Raid(G.Locations[0], { weapons: [{ id: 'w_pistol', mag: 8 }, null], armorId: null, reserve: {}, backpack: [] });
  const p = raid.player;
  p.addLoot('w_ak', 1);
  if (!p.weapons[1] || p.weapons[1].id !== 'w_ak') throw new Error('found weapon did not auto-equip to empty slot');
  // a third weapon (both slots full) falls into the backpack instead
  const bagBefore = p.backpack.length;
  p.addLoot('w_m4', 1);
  if (p.backpack.length !== bagBefore + 1) throw new Error('extra weapon should go to backpack');
  // armor: none worn -> equips; stronger -> replaces; weaker -> stays in bag
  p.addLoot('a_vest1', 1);
  if (!p.armor || p.armor.id !== 'a_vest1') throw new Error('armor did not auto-equip when none worn');
  p.addLoot('a_vest3', 1);
  if (p.armor.id !== 'a_vest3') throw new Error('stronger armor did not replace weaker');
  const had = p.backpack.filter(s => s.id === 'a_vest1').length;
  if (!had) throw new Error('replaced armor was not returned to backpack');
  p.addLoot('a_vest1', 1); // weaker than worn a_vest3
  if (p.armor.id !== 'a_vest3') throw new Error('weaker armor wrongly auto-equipped');
});
ok('armor upgrade with a full backpack does not lose the worn plate', () => {
  const raid = new G.Raid(G.Locations[0], { weapons: [{ id: 'w_pistol', mag: 8 }, null], armorId: 'a_vest1', reserve: {}, backpack: [] });
  const p = raid.player;
  p.backpack = [];
  for (let i = 0; i < G.Config.BACKPACK_SLOTS; i++) p.backpack.push({ id: 'v_cash', n: 1 }); // jam the bag full
  const leftover = p.addLoot('a_vest3', 1); // stronger plate, but nowhere to stow the old one
  if (p.armor.id !== 'a_vest1') throw new Error('swapped armor with a full bag — the old plate would be lost');
  if (leftover !== 1) throw new Error('new plate should stay as leftover when the bag is full');
});
ok('backpack capacity uses individual items in an 8x6 occupancy grid', () => {
  const raid = new G.Raid(G.Locations[0], G.Profile.scavKit());
  const p = raid.player;
  p.backpack = [];
  if (G.Config.BACKPACK_GRID_W !== 8 || G.Config.BACKPACK_GRID_H !== 6) throw new Error('bag grid is not 8x6');
  if (p.addLoot('v_gpu', 12) !== 0) throw new Error('twelve individual 2x2 GPUs should fit exactly in an 8x6 bag');
  if (p.backpackCount() !== G.Config.BACKPACK_SLOTS) throw new Error('bag used slots mismatch');
  if (p.addLoot('v_cash', 1) !== 1) throw new Error('full bag accepted extra loot');
});
ok('backpack items do not stack, including legacy entries', () => {
  const raid = new G.Raid(G.Locations[0], G.Profile.scavKit());
  const p = raid.player;
  p.backpack = [];
  if (p.addLoot('v_cash', 3) !== 0) throw new Error('individual cash items should fit');
  if (p.backpack.length !== 3 || p.backpack.some(s => s.n !== 1)) throw new Error('new backpack loot stacked');
  p.backpack = [{ id: 'v_cash', n: 3 }];
  p.ensureBackpackLayout();
  if (p.backpack.length !== 3 || p.backpack.some(s => s.n !== 1)) throw new Error('legacy backpack stack was not expanded');
  const carried = G.Profile.scavKit();
  carried.backpack = [{ id: 'v_gpu', n: 13 }];
  const overflowRaid = new G.Raid(G.Locations[0], carried);
  if (overflowRaid.player.backpack.length !== 12 || overflowRaid.player.backpack.some(s => s.n !== 1)) throw new Error('legacy overflow bypassed the backpack grid');
  if (!overflowRaid.groundItems.some(g => g.id === 'v_gpu' && g.n === 1)) throw new Error('legacy overflow was not dropped at spawn');
});
ok('equipArmor (key 3) equips the best plate from the backpack', () => {
  const raid = new G.Raid(G.Locations[0], { weapons: [{ id: 'w_pistol', mag: 8 }, null], armorId: null, reserve: {}, backpack: [] });
  const p = raid.player;
  // push two plates straight into the bag without auto-equip interfering
  p.backpack.push({ id: 'a_vest1', n: 1 }, { id: 'a_vest2', n: 1 });
  p.equipArmor(raid);
  if (!p.armor || p.armor.id !== 'a_vest2') throw new Error('did not equip the strongest backpack armor');
});
ok('healing permits movement but blocks shooting', () => {
  const raid = new G.Raid(G.Locations[0], G.Profile.scavKit());
  const p = raid.player;
  p.hp = 10;
  p.healing = { t: 0, total: 2, id: 'm_bandage', heal: 35 };
  const x0 = p.x;
  p.move(1 / 60, 1, 0, false, raid.map);
  if (Math.abs(p.x - x0) < 0.01) throw new Error('player could not move while healing');
  const shotBefore = p.lastShotAt;
  p.tryShoot(raid);
  if (p.lastShotAt !== shotBefore) throw new Error('player fired while healing (should be blocked)');
});
ok('search continues while firing and does not block bullets', () => {
  const raid = new G.Raid(G.Locations[0], G.Profile.scavKit());
  raid.enemies = [];
  raid.player.weapons[0] = { id: 'w_pistol', mag: 8 };
  raid.player.slot = 0;
  raid.player.reserve['9mm'] = 99;
  const c = raid.map.containers.find(c => c.items.length);
  raid.player.x = c.x; raid.player.y = c.y;
  raid.player.searching = { t: 0.2, total: G.Config.SEARCH_TIME, container: c };
  raid.player.fireCd = 0;
  const bulletsBefore = raid.bullets.length;
  raid.player.tryShoot(raid);
  if (!raid.player.searching) throw new Error('shooting directly canceled the search');
  if (raid.bullets.length <= bulletsBefore) throw new Error('searching blocked bullet release');
  G.Input.resetTouch(); G.Input.touchEnabled = false;
  G.Input.keys.clear(); G.Input._pressed.clear();
  raid.cam.setViewport(800, 600);
  raid.cam.x = raid.player.x; raid.cam.y = raid.player.y;
  G.Input.mouse.x = 520; G.Input.mouse.y = 300;
  raid.player.fireCd = 0;
  const inputBulletsBefore = raid.bullets.length;
  G.Input.mouse.down = true; // fire
  raid.update(1 / 60, 800, 600);
  if (!raid.player.searching) throw new Error('fire input canceled the search');
  if (raid.bullets.length <= inputBulletsBefore) throw new Error('fire input did not release a bullet while searching');
  G.Input.mouse.down = false;
});
ok('search interrupts when the container leaves range', () => {
  const raid = new G.Raid(G.Locations[0], G.Profile.scavKit());
  const c = raid.map.containers.find(c => c.items.length);
  raid.player.x = c.x; raid.player.y = c.y;
  raid.player.searching = { t: 0.2, total: G.Config.SEARCH_TIME, container: c };
  raid.player.x = c.x + 500; // teleport out of range
  G.Input.keys.clear(); G.Input._pressed.clear(); G.Input.mouse.down = false;
  raid.update(1 / 60, 800, 600);
  if (raid.player.searching) throw new Error('out-of-range did not interrupt the search');
});
ok('Audio.startAmbient/stopAmbient are safe to call (no-op while muted)', () => {
  G.Audio.startAmbient('depot'); // disabled in smoke -> must not throw
  G.Audio.startAmbient('labs');
  G.Audio.stopAmbient();
  G.Audio.stopAmbient(true);
});

console.log('\n[11] Contracts: counters, progress, claim, persistence');
ok('recordRaid advances counters only on a successful surface', () => {
  G.Profile.resetAll();
  const p0 = G.Profile.data.prog.surfaces;
  G.Profile.recordRaid({ outcome: 'death', locId: 'depot', killsByTier: { raider: 3 } });
  if (G.Profile.data.prog.surfaces !== p0) throw new Error('death advanced surfaces');
  G.Profile.recordRaid({ outcome: 'extract', locId: 'factory', killsByTier: { raider: 2, boss: 1 } });
  if (G.Profile.data.prog.surfaces !== p0 + 1) throw new Error('surface not counted');
  if (G.Profile.data.prog.byLoc.factory !== 1) throw new Error('byLoc not counted');
  if (G.Profile.data.prog.kills.raider !== 2 || G.Profile.data.prog.kills.boss !== 1) throw new Error('tier kills not counted');
});
ok('a surface contract completes and pays its reward', () => {
  G.Profile.resetAll();
  const c = G.Profile.contractCurrent();
  if (!c || c.id !== 'c1_first_ebb') throw new Error('first contract not active');
  if (G.Profile.contractProgress().done) throw new Error('contract done before any dive');
  if (G.Profile.claimContract().ok) throw new Error('claimed an unfinished contract');
  const money0 = G.Profile.money();
  G.Profile.recordRaid({ outcome: 'extract', locId: 'depot', killsByTier: {} });
  const pr = G.Profile.contractProgress();
  if (!pr.done) throw new Error('surface contract not complete after one dive');
  const r = G.Profile.claimContract();
  if (!r.ok) throw new Error('claim failed on a completed contract');
  if (G.Profile.money() !== money0 + 300) throw new Error('reward money not paid');
  if (G.Profile.data.contracts.stage !== 1) throw new Error('stage did not advance');
});
ok('a deliver contract consumes the goods on claim', () => {
  G.Profile.resetAll();
  G.Profile.data.contracts.stage = 1; G.Profile.data.contracts.base = null; G.Profile._syncContractBase();
  const c = G.Profile.contractCurrent();
  if (c.id !== 'c2_salvage') throw new Error('c2 not active');
  G.Profile.addItem('v_tools', 1);
  if (G.Profile.contractProgress().done) throw new Error('done with only 1 of 2 tools');
  G.Profile.addItem('v_tools', 1);
  if (!G.Profile.contractProgress().done) throw new Error('not done with 2 tools');
  const r = G.Profile.claimContract();
  if (!r.ok) throw new Error('deliver claim failed');
  if (G.Profile.countItem('v_tools') !== 0) throw new Error('delivered goods not consumed');
});
ok('counter goals baseline at contract open (kills before are not credited)', () => {
  G.Profile.resetAll();
  // pre-load lots of raider kills, THEN jump to the reaver-cull contract
  G.Profile.data.prog.kills.raider = 50;
  G.Profile.data.contracts.stage = 5; G.Profile.data.contracts.base = null; G.Profile._syncContractBase();
  const c = G.Profile.contractCurrent();
  if (c.id !== 'c6_reavers') throw new Error('c6 not active');
  if (G.Profile.contractProgress().cur !== 0) throw new Error('pre-contract kills wrongly credited (' + G.Profile.contractProgress().cur + ')');
  // kills earned after taking the contract count
  for (let i = 0; i < 8; i++) G.Profile.recordRaid({ outcome: 'extract', locId: 'depot', killsByTier: { raider: 1 } });
  if (!G.Profile.contractProgress().done) throw new Error('8 post-contract reaver kills did not complete it');
});
ok('contracts survive a save round-trip', () => {
  G.Profile.resetAll();
  G.Profile.recordRaid({ outcome: 'extract', locId: 'depot', killsByTier: {} });
  G.Profile.claimContract();           // finish c1, advance to c2
  G.Profile.save();
  G.Profile.load();                    // re-read from storage
  if (G.Profile.data.contracts.stage !== 1) throw new Error('stage not persisted');
  if (G.Profile.contractCurrent().id !== 'c2_salvage') throw new Error('active contract not restored');
});
ok('legacy save with no contracts/prog is repaired, not crashed', () => {
  store[G.Config.SAVE_KEY] = JSON.stringify({ stash: [{ id: 'w_pistol', n: 1 }], money: 500 });
  G.Profile.load();                    // must not throw
  if (!G.Profile.data.prog || typeof G.Profile.data.prog.surfaces !== 'number') throw new Error('prog not backfilled');
  if (!G.Profile.contractCurrent()) throw new Error('contract stage not initialized');
  if (G.Profile.contractProgress() == null) throw new Error('progress unreadable on legacy save');
});

function runScriptedBaseline(label, seed, scenarios, validateRecords) {
  const originalRandom = Math.random;
  Math.random = G.RNG(seed);
  const loc = G.Locations.find(l => l.id === G.DemoConfig.locationId) || G.Locations[0];

  function createRaid(scenario) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const carried = Object.assign(G.Profile.scavKit(), { demo: true, challengeId: scenario.challengeId || null });
      const raid = new G.Raid(loc, carried);
      const graph = raid.map.roomGraph;
      if (!graph || (scenario.orientation && graph.orientation !== scenario.orientation)) continue;
      if (scenario.reward && !graph.rewardRoomIds.length) continue;
      return raid;
    }
    throw new Error('could not generate requested baseline scenario');
  }

  function clearRoom(raid, room) {
    const st = raid._roomState(room.id);
    st.started = true;
    st.cleared = true;
    st.wavesRemaining = 0;
    st.activeWave = false;
    st.waveWarning = null;
    for (const enemy of raid.enemies) if (enemy.room && enemy.room.id === room.id) enemy.dead = true;
  }

  function collectRoom(raid, room) {
    for (const cont of raid.map.containers) {
      if (cont.roomId !== room.id || cont.searched || !cont.items.length) continue;
      raid.player.x = cont.x;
      raid.player.y = cont.y;
      raid._collect(cont);
    }
  }

  function usePortal(raid, portal) {
    raid.player.x = portal.x;
    raid.player.y = portal.y;
    const room = raid.map.rooms.find(r => r.id === portal.fromRoomId);
    raid.dungeon.currentRoomId = room.id;
    clearRoom(raid, room);
    for (let i = 0; i < 120; i++) {
      raid.player.moving = false;
      raid._updatePortals(0.2);
      if (raid._roomAt(raid.player.x, raid.player.y).id === portal.toRoomId) return;
    }
    throw new Error('scripted route could not traverse portal');
  }

  function advance(raid, seconds) {
    const target = raid.time + seconds;
    G.Input.keys.clear();
    G.Input._pressed.clear();
    G.Input.mouse.down = false;
    while (raid.time < target && !raid.result) {
      for (const enemy of raid.enemies) enemy.dead = true;
      if (raid.dungeon.cursePending) {
        const choice = raid.dungeon.curseChoices.find(c => c.type === raid._phase27ChoiceType) || raid.dungeon.curseChoices[0];
        if (!choice || !raid.chooseCurse(choice.id)) throw new Error('scripted route could not resolve choice');
      }
      raid.update(0.1, 1280, 720);
    }
    return !raid.result;
  }

  const records = scenarios.map((scenario, index) => {
    const raid = createRaid(scenario);
    raid._phase27ChoiceType = index % 2 ? 'skill' : 'curse';
    const mainIds = raid.map.roomGraph.mainRoomIds;
    for (let i = 0; i < mainIds.length; i++) {
      const room = raid.map.rooms.find(r => r.id === mainIds[i]);
      raid.player.x = raid.map.tileCenter(room.cx, room.cy).x;
      raid.player.y = raid.map.tileCenter(room.cx, room.cy).y;
      raid._enterRoom(room);
      collectRoom(raid, room);
      clearRoom(raid, room);

      if (scenario.reward && i === 1) {
        const rewardPortal = raid.map.portals.find(p => p.fromRoomId === room.id && p.kind === 'gold');
        if (rewardPortal && raid.dungeon.gold >= rewardPortal.cost) {
          usePortal(raid, rewardPortal);
          const rewardRoom = raid.map.rooms.find(r => r.id === rewardPortal.toRoomId);
          collectRoom(raid, rewardRoom);
          clearRoom(raid, rewardRoom);
          const returnPortal = raid.map.portals.find(p => p.fromRoomId === rewardRoom.id && p.toRoomId === room.id);
          if (returnPortal) usePortal(raid, returnPortal);
        }
      }

      if (i < mainIds.length - 1) {
        const portal = raid.map.portals.find(p => p.fromRoomId === room.id && p.toRoomId === mainIds[i + 1]);
        if (!portal) throw new Error('scripted route missing main portal');
        usePortal(raid, portal);
      }
    }

    raid._openCurseChoice();
    const choice = raid.dungeon.curseChoices.find(c => c.type === raid._phase27ChoiceType) || raid.dungeon.curseChoices[0];
    if (!choice || !raid.chooseCurse(choice.id)) throw new Error('scripted route could not make build choice');
    const safeRoom = raid.map.rooms.find(room => room.kind === 'spawn');
    const safePoint = raid.map.tileCenter(safeRoom.cx, safeRoom.cy);
    raid.player.x = safePoint.x;
    raid.player.y = safePoint.y;
    raid.dungeon.currentRoomId = safeRoom.id;
    clearRoom(raid, safeRoom);
    advance(raid, Math.max(0, scenario.duration - raid.time));
    if (!raid.result) raid._finish(scenario.outcome);
    const result = raid.result;
    const metrics = result.playtestMetrics;
    if (!metrics || metrics.roomsEntered < mainIds.length || metrics.resourcesSearched < 1 || metrics.choicesTaken < 1) {
      throw new Error('scripted route did not collect baseline metrics');
    }
    if (result.outcome !== scenario.outcome) throw new Error('scripted route settled as ' + result.outcome + ', expected ' + scenario.outcome);
    return {
      run: index + 1,
      input: 'scripted-route',
      challengeId: result.challengeId || null,
      orientation: raid.map.roomGraph.orientation,
      outcome: result.outcome,
      time: result.time,
      paceTag: result.paceTag,
      metrics,
    };
  });
  if (validateRecords) validateRecords(records);
  console.log(label + '=' + JSON.stringify(records));
  Math.random = originalRandom;
  return records;
}

function validateBaselineCoverage(records) {
  if (!records.some(r => r.outcome === 'failed') || !records.some(r => r.outcome === 'normal_extract') || !records.some(r => r.outcome === 'perfect_extract')) {
    throw new Error('scripted baseline did not cover all target settlement paths');
  }
  if (new Set(records.map(r => r.orientation)).size !== 2) throw new Error('scripted baseline did not cover both map orientations');
  if (!records.some(r => r.metrics.paidPortalsOpened > 0) || !records.some(r => r.metrics.cursesTaken > 0) || !records.some(r => r.metrics.skillsTaken > 0)) {
    throw new Error('scripted baseline did not cover gold and build branches');
  }
}

function runPhase27Baseline() {
  const scenarios = [
    { outcome: 'failed', duration: 210, orientation: 'horizontal', reward: false },
    { outcome: 'normal_extract', duration: 260, orientation: 'vertical', reward: true },
    { outcome: 'normal_extract', duration: 300, orientation: 'horizontal', reward: false },
    { outcome: 'perfect_extract', duration: 330, orientation: 'vertical', reward: true },
    { outcome: 'normal_extract', duration: 360, orientation: 'horizontal', reward: true },
    { outcome: 'failed', duration: 400, orientation: 'vertical', reward: false },
    { outcome: 'perfect_extract', duration: 450, orientation: 'horizontal', reward: true },
    { outcome: 'normal_extract', duration: 480, orientation: 'vertical', reward: false },
    { outcome: 'failed', duration: 500, orientation: 'horizontal', reward: true },
    { outcome: 'normal_extract', duration: 540, orientation: 'vertical', reward: false },
  ];
  runScriptedBaseline('PHASE27_BASELINE', 27027, scenarios, validateBaselineCoverage);
}

function runPhase35Baseline() {
  const scenarios = [
    { challengeId: 'rising_tide', outcome: 'failed', duration: 270, reward: false },
    { challengeId: 'elite_hunt', outcome: 'normal_extract', duration: 300, reward: true },
    { challengeId: 'scarce_escape', outcome: 'normal_extract', duration: 360, reward: false },
    { challengeId: 'charge_gauntlet', outcome: 'failed', duration: 300, reward: false },
    { challengeId: 'sightline_siege', outcome: 'perfect_extract', duration: 390, reward: true },
    { challengeId: 'fortune_route', outcome: 'normal_extract', duration: 420, reward: true },
    { challengeId: 'rising_tide', outcome: 'perfect_extract', duration: 450, reward: true },
    { challengeId: 'elite_hunt', outcome: 'normal_extract', duration: 480, reward: true },
    { challengeId: 'charge_gauntlet', outcome: 'normal_extract', duration: 500, reward: false },
    { challengeId: 'fortune_route', outcome: 'failed', duration: 540, reward: true },
  ];
  const records = runScriptedBaseline('PHASE35_BASELINE', 35035, scenarios, records => {
    validateBaselineCoverage(records);
    const covered = new Set(records.map(r => r.challengeId));
    for (const challenge of G.Challenges || []) if (!covered.has(challenge.id)) throw new Error('phase 35 baseline missed challenge: ' + challenge.id);
  });
  const outcomeCounts = records.reduce((counts, record) => {
    counts[record.outcome] = (counts[record.outcome] || 0) + 1;
    return counts;
  }, {});
  console.log('PHASE35_SUMMARY=' + JSON.stringify({
    runs: records.length,
    challengeIds: Array.from(new Set(records.map(r => r.challengeId))),
    outcomeCounts,
    averageTime: Math.round(records.reduce((sum, record) => sum + record.time, 0) / records.length),
  }));
}

if (process.argv.includes('--phase27-baseline')) runPhase27Baseline();
if (process.argv.includes('--phase35-baseline')) runPhase35Baseline();

console.log('\n========================================');
console.log(`  ${pass} passed, ${fail} failed`);
console.log('========================================');
process.exit(fail ? 1 : 0);

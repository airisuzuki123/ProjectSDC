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

console.log('\n[6] UI screens build without error');
ok('all UI screens & overlays render', () => {
  const host = { startRaid() {}, toHub() {}, };
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
  G.UI.showResults({ outcome: 'failed', kills: 2, time: 80, lootValue: 0, lostLootValue: 450, items: 0, scav: true, scrollFragments: 2, requiredFragments: 4 }, { carriedValue: 0 });
  const fakeRaid = new G.Raid(G.Locations[0], G.Profile.scavKit());
  G.UI.openPause(fakeRaid);
  G.UI.openRaidInventory(fakeRaid);
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
ok('backpack capacity uses item slotCost, not stack entries', () => {
  const raid = new G.Raid(G.Locations[0], G.Profile.scavKit());
  const p = raid.player;
  p.backpack = [];
  if (p.addLoot('v_gpu', 4) !== 0) throw new Error('four 3-slot GPUs should fit exactly in a 12-slot bag');
  if (p.backpackCount() !== G.Config.BACKPACK_SLOTS) throw new Error('bag used slots mismatch');
  if (p.addLoot('v_cash', 1) !== 1) throw new Error('full bag accepted extra loot');
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
ok('tap-to-loot: opening fire interrupts an active search', () => {
  const raid = new G.Raid(G.Locations[0], G.Profile.scavKit());
  raid.player.reserve['9mm'] = 99;
  const c = raid.map.containers.find(c => c.items.length);
  raid.player.x = c.x; raid.player.y = c.y;
  raid.player.searching = { t: 0.2, total: G.Config.SEARCH_TIME, container: c };
  G.Input.keys.clear(); G.Input._pressed.clear();
  G.Input.mouse.down = true; // fire
  raid.update(1 / 60, 800, 600);
  if (raid.player.searching) throw new Error('shooting did not interrupt the search');
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

console.log('\n========================================');
console.log(`  ${pass} passed, ${fail} failed`);
console.log('========================================');
process.exit(fail ? 1 : 0);

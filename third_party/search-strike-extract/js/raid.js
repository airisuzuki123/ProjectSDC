/* =========================================================================
 * raid.js — In-raid controller. Owns the map, player, enemies, bullets,
 * loot, particles, camera. Handles input, simulation, rendering and the HUD.
 * Calls host callbacks (onPause / onInventory / onFinish) for DOM overlays.
 * ========================================================================= */
(function () {
  'use strict';
  const G = window.G;
  const U = G.Utils;
  const C = G.Config;
  const Input = G.Input;
  // constant key→action map, hoisted out of the per-frame path.
  // Quick-slots 1·2 select weapons, 3 equips armor, 4 heals; E/Space tap to loot.
  const KEY_ACTIONS = {
    r: 'reload', h: 'heal', q: 'swap', tab: 'inv', escape: 'pause',
    '1': 'slot0', '2': 'slot1', '3': 'slot2', '4': 'slot3',
    e: 'interact', ' ': 'interact', x: 'normalExtract',
    f1: 'debugToggle', f2: 'debugScroll', f3: 'debugGold', f4: 'debugChoice',
    f5: 'debugExtract', f6: 'debugClearRoom', f7: 'debugNormalExtract',
    f8: 'debugPerfectExtract', f9: 'debugDeath',
  };

  function demoMapRules(level, challenge) {
    const rules = Object.assign({}, challenge && challenge.mapRules);
    if (level) {
      rules.regularRoomCount = level.regularRoomCount;
      rules.mainPathMin = level.regularRoomCount + 2;
      rules.mainPathMax = level.regularRoomCount + 2;
    }
    return rules;
  }

  function Raid(location, carried) {
    this.location = location;
    this.scav = !!carried.scav;
    this.demo = !!carried.demo;
    this.level = this.demo && carried.levelId && G.getDemoLevel ? G.getDemoLevel(carried.levelId) : null;
    this.challenge = this.demo && carried.challengeId && G.getChallenge ? G.getChallenge(carried.challengeId) : null;
    this.map = G.MapGen.generate(location, {
      demo: this.demo,
      levelId: this.level && this.level.id,
      challengeId: this.challenge && this.challenge.id,
      mapRules: demoMapRules(this.level, this.challenge),
    });
    this.cam = new G.Camera();
    this.particles = new G.Particles();
    this.bullets = [];
    this.enemies = [];
    this.groundItems = [];
    this.toasts = [];
    this.floats = [];
    this.coinFlights = [];
    this.time = 0;
    this.timeLeft = C.RAID_TIME;
    this.kills = 0;
    this.killsByTier = { scav: 0, raider: 0, boss: 0 };   // fed to contract counters on extract
    this.paused = false;
    this.result = null;
    this.extracting = null;       // {zone, t, total, phase}
    this.invOpen = false;
    this.dungeon = this.demo ? {
      scrollFragments: 0,
      requiredFragments: (G.DemoConfig && G.DemoConfig.requiredFragments) || 4,
      monsterLevel: 1,
      monsterLevelTimer: 0,
      spawnTimer: (G.DemoConfig && G.DemoConfig.monsterSpawnInterval) || 20,
      enraged: false,
      eliteSpawned: false,
      rewardMultiplier: 1,
      selectedCurses: [],
      selectedSkills: [],
      level: this.level,
      challenge: this.challenge,
      curseChoices: [],
      cursePending: false,
      curseTriggers: 0,
      modifiers: defaultCurseModifiers(),
      extractionChallenge: null,
      currentRoomId: null,
      roomStates: {},
      gold: 0,
      portalPayment: null,
      portalCooldown: 0,
      playtest: {
        resourcesSearched: 0,
        goldCollected: 0,
        goldSpent: 0,
        paidPortalsOpened: 0,
        roomsEntered: 0,
        rewardRoomsEntered: 0,
        choicesTaken: 0,
        cursesTaken: 0,
        skillsTaken: 0,
      },
    } : null;
    this.visited = new Uint8Array(this.map.w * this.map.h);
    this._footT = 0;
    this.sprintOn = false;        // touch sprint toggle
    this._nearestCont = null;
    this._actionRowY = null;      // set by _layoutButtons on touch; read by panel/quickbar geometry
    this._curseHudButtons = [];
    this._curseTooltipId = null;

    // callbacks (wired by host)
    this.onPause = function () {};
    this.onInventory = function () {};
    this.onFinish = function () {};
    this.onCurseChoice = function () {};

    this._buildPlayer(carried);
    if (this.dungeon) this._recomputeCurseModifiers();
    this._spawnEnemies();
    this._buildCaches();
    this.cam.x = this.player.x; this.cam.y = this.player.y;
  }

  Raid.prototype = {
    _buildPlayer(carried) {
      const sp = this.map.playerSpawn;
      const p = new G.Player(sp.x, sp.y);
      p.weapons = carried.weapons.map(w => w ? { id: w.id, mag: w.mag } : null);
      p.slot = p.weapons[0] ? 0 : (p.weapons[1] ? 1 : 0);
      p.armor = carried.armorId ? { id: carried.armorId, durability: G.getItem(carried.armorId).durability } : null;
      p.reserve = Object.assign({}, carried.reserve);
      p.backpack = (carried.backpack || []).map(s => ({ id: s.id, n: s.n, x: s.x, y: s.y, w: s.w, h: s.h }));
      const overflow = p.ensureBackpackLayout();
      for (const item of overflow) this._dropGroundItem(sp.x, sp.y, item.id, item.n, { delay: 0.1, scatter: 24 });
      // top off the equipped magazine from reserve
      for (const w of p.weapons) {
        if (!w) continue;
        const def = G.getItem(w.id);
        const need = def.mag - w.mag;
        const cal = def.ammoType;
        if (need > 0 && p.reserve[cal]) {
          const take = Math.min(need, p.reserve[cal]); w.mag += take; p.reserve[cal] -= take;
        }
      }
      this.player = p;
    },

    _spawnEnemies() {
      if (this.demo && this.dungeon && this.map.roomGraph) {
        const room = this._roomAt(this.player.x, this.player.y);
        if (room) this._enterRoom(room);
        return;
      }
      for (const s of this.map.enemySpawns) this._spawnEnemyFromPoint(s);
    },

    _spawnEnemyFromPoint(spawn, tierOverride) {
      const tier = tierOverride || spawn.tier;
      const s = Object.assign({}, spawn, {
        tier,
        role: spawn.role || this._enemyRoleForTier(tier, spawn),
        hpMultiplier: this._monsterHpMultiplier(),
        damageMultiplier: this._monsterDamageMultiplier(),
      });
      this.enemies.push(new G.Enemy(s));
    },

    _enemyRoleForTier(tier, spawn) {
      if (!this.demo) return null;
      if (spawn && spawn.room && spawn.room.pathIndex < 2) return null;
      const cfg = G.DemoConfig || {};
      if (tier === 'beast' && U.chance(U.clamp((cfg.roleRusherChance || 0) * this._curseModifier('roleRusherChanceMultiplier', 1), 0, 1))) return 'rusher';
      if (tier === 'raider' && U.chance(U.clamp((cfg.roleMarksmanChance || 0) * this._curseModifier('roleMarksmanChanceMultiplier', 1), 0, 1))) return 'marksman';
      return null;
    },

    // Pre-render the static world (floor/walls/grid) and prepare the incremental
    // fog-of-war minimap texture — both are blitted each frame instead of redrawn.
    _buildCaches() {
      const map = this.map;
      try {
        this._world = document.createElement('canvas');
        this._world.width = map.pxW; this._world.height = map.pxH;
        this._renderWorldCache(this._world.getContext('2d'));
      } catch (e) { this._world = null; }
      try {
        this._mini = document.createElement('canvas');
        this._mini.width = map.w; this._mini.height = map.h;
        this._miniCtx = this._mini.getContext('2d');
      } catch (e) { this._mini = null; }
    },

    _renderWorldCache(ctx) {
      const map = this.map, T = map.tile, base = map.color;
      for (let ty = 0; ty < map.h; ty++) {
        for (let tx = 0; tx < map.w; tx++) {
          const i = ty * map.w + tx, px = tx * T, py = ty * T;
          if (map.grid[i] === 1) {
            ctx.fillStyle = '#15171b'; ctx.fillRect(px, py, T, T);
            ctx.fillStyle = '#23262d'; ctx.fillRect(px, py, T, 4);
            ctx.fillStyle = '#0e0f12'; ctx.fillRect(px, py + T - 3, T, 3);
          } else {
            ctx.fillStyle = shadeColor(base, map.shade[i]);
            ctx.fillRect(px, py, T, T);
          }
        }
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let tx = 0; tx <= map.w; tx++) { ctx.moveTo(tx * T, 0); ctx.lineTo(tx * T, map.pxH); }
      for (let ty = 0; ty <= map.h; ty++) { ctx.moveTo(0, ty * T); ctx.lineTo(map.pxW, ty * T); }
      ctx.stroke();
    },

    /* ----------------------------- Update ----------------------------- */
    update(dt, w, h) {
      this.cam.setViewport(w, h);
      this.screenW = w; this.screenH = h;
      Input.screenW = w; Input.screenH = h;
      if (this.result) return;
      this._layoutButtons(w, h);
      this._layoutDemoHud(w, h);
      Input.update();
      if (this.paused) return;

      dt = Math.min(dt, 0.05);
      this.time += dt;
      if (!this.demo) this.timeLeft -= dt;
      if (this.dungeon && this.dungeon.roomEntryGrace > 0) this.dungeon.roomEntryGrace = Math.max(0, this.dungeon.roomEntryGrace - dt);
      this._updateDungeonCurses();
      this._updateDungeonPressure(dt);

      this._nearestCont = this._nearestContainer();
      this._handleInput(dt);
      if (this.paused) return;
      this.player.updateActions(dt, this);

      for (const e of this.enemies) e.update(dt, this);
      this._updateBullets(dt);
      this._updateGround(dt);
      this._updateRoomCombat(dt);
      this._updatePortals(dt);
      this._updateExtract(dt);
      this.particles.update(dt);
      this._reveal();
      this._updateFloats(dt);
      this._updateCoinFlights(dt);
      this._updateToasts(dt);

      this.cam.follow(this.player.x, this.player.y, dt, { w: this.map.pxW, h: this.map.pxH });
      // aim & shoot last, against the now-settled camera, so shots match the
      // crosshair. Skip on the frame a menu just opened so it can't fire a stray shot.
      if (!this.paused) this._aimAndFire(dt);

      // win / lose conditions
      if (this.player.dead) this._finish('death');
      else if (!this.demo && this.timeLeft <= 0) this._finish('mia');
    },

    _handleInput(dt) {
      const p = this.player, map = this.map;
      // discrete actions from keys + buttons
      Input.queueKeyActions(KEY_ACTIONS);
      if (this._handleDemoDebugActions()) return;
      this._handleCurseHudInput();
      if (!Input.touchEnabled && Input.mousePressed() && this._desktopInvButton && pointInRect(Input.mouse.x, Input.mouse.y, this._desktopInvButton)) {
        this.paused = true; this.invOpen = true; Input.resetTouch(); this.onInventory(); return;
      }
      if (Input.consumeAction('reload') && !this.demo) p.reload();
      if (Input.consumeAction('heal')) p.useMed(this);
      if (Input.consumeAction('swap')) p.swapWeapon(this);
      if (Input.consumeAction('sprint')) this.sprintOn = !this.sprintOn;
      // quick-slots: 1 primary, 2 secondary, 3 armor, 4 heal
      if (Input.consumeAction('slot0')) p.selectWeapon(0, this);
      if (Input.consumeAction('slot1')) p.selectWeapon(1, this);
      if (Input.consumeAction('slot2')) p.equipArmor(this);
      if (Input.consumeAction('slot3')) p.useMed(this);
      if (Input.consumeAction('inv')) { this.paused = true; this.invOpen = true; Input.resetTouch(); this.onInventory(); return; }
      if (Input.consumeAction('pause')) { this.paused = true; Input.resetTouch(); this.onPause(); return; }
      if (Input.consumeAction('normalExtract')) {
        if (this.demo && this._canNormalExtract()) this._finish('normal_extract');
        else if (this.demo) this.toast(G.t('raid.toast.scrollNotReady', this._scrollParams()));
      }

      const mv = Input.moveVec();
      const wantMove = Math.hypot(mv.x, mv.y) > 0.05;
      const sprint = Input.touchEnabled ? this.sprintOn : Input.isDown('shift');
      const cont = this._nearestCont;

      // interact: a single TAP of E / Space (or the SEARCH button) starts looting
      // the nearest container; tapping again cancels it. Drain both sources.
      const tapInteract = Input.consumeAction('interact');
      const tapSearch = Input.consumeAction('search');
      if (!this.demo && (tapInteract || tapSearch)) {
        if (p.searching) {
          p.searching = null;
        } else if (cont && !cont.searched && cont.items.length) {
          p.searching = { t: 0, total: C.SEARCH_TIME / this._curseModifier('searchSpeedMultiplier', 1), container: cont };
          G.Audio.play('click', { vol: 0.4 });
        } else if (cont) {
          this.toast(G.t('raid.toast.alreadyLooted'));
        }
      }

      // movement is always allowed now (healing slows you; searching range-cancels)
      if (wantMove) {
        p.move(dt, mv.x, mv.y, sprint, map);
        if (p.moving) { this._footT -= dt; if (this._footT <= 0) { G.Audio.play('footstep', { vol: sprint ? 0.5 : 0.3 }); this._footT = sprint ? 0.28 : 0.4; } }
      } else {
        p.moving = false;
      }
      this._updateAutoHarvest(dt, wantMove);

      // advance the active search; interrupt when the container leaves range
      if (p.searching) {
        const c = p.searching.container;
        if (c.searched || !c.items.length) {
          p.searching = null;
        } else if (this.demo && (wantMove || p.moving)) {
          p.searching = null;
          this.toast(G.t('raid.toast.searchInterrupted'));
        } else if (U.dist(p.x, p.y, c.x, c.y) > C.LOOT_PICK_RADIUS + 16) {
          p.searching = null;
          this.toast(G.t('raid.toast.searchMoved'));
        } else {
          p.searching.t += dt;
          if (U.chance(dt * 7)) G.Audio.play('search', { vol: 0.4 });
          if (p.searching.t >= p.searching.total) { this._collect(c); p.searching = null; }
        }
      }

    },

    _handleDemoDebugActions() {
      if (!this.demo || !this.dungeon) return false;
      const d = this.dungeon;
      if (Input.consumeAction('debugToggle')) {
        d.debugVisible = !d.debugVisible;
        this.toast(G.t(d.debugVisible ? 'raid.debug.visible' : 'raid.debug.hidden'));
        return false;
      }
      if (Input.consumeAction('debugScroll')) {
        this._collectDungeonItem((G.DemoConfig && G.DemoConfig.scrollItemId) || 'd_scroll_fragment', 1);
        return false;
      }
      if (Input.consumeAction('debugGold')) {
        this._collectDungeonItem((G.DemoConfig && G.DemoConfig.coinItemId) || 'd_gold_coin', 5);
        return false;
      }
      if (Input.consumeAction('debugChoice')) {
        if (!d.cursePending) this._openCurseChoice();
        return true;
      }
      if (Input.consumeAction('debugExtract')) {
        this._debugTeleportExtract();
        return false;
      }
      if (Input.consumeAction('debugClearRoom')) {
        this._debugClearCurrentRoom();
        return false;
      }
      if (Input.consumeAction('debugNormalExtract')) {
        d.scrollFragments = d.requiredFragments;
        this._finish('normal_extract');
        return true;
      }
      if (Input.consumeAction('debugPerfectExtract')) {
        this._finish('perfect_extract');
        return true;
      }
      if (Input.consumeAction('debugDeath')) {
        this.player.takeDamage(99999, this, this.player.x + 12, this.player.y);
        return false;
      }
      return false;
    },

    _debugTeleportExtract() {
      const z = this.map.extracts && this.map.extracts[0];
      if (!z) return false;
      this.player.x = z.x; this.player.y = z.y;
      this.player.cancelActions();
      const room = z.roomId && this.map.rooms ? this.map.rooms.find(r => r.id === z.roomId) : this._roomAt(z.x, z.y);
      if (room) {
        this.dungeon.currentRoomId = room.id;
        this._enterRoom(room);
      }
      this.cam.x = this.player.x; this.cam.y = this.player.y;
      this.toast(G.t('raid.debug.teleportExtract'));
      return true;
    },

    _debugClearCurrentRoom() {
      const room = this._roomAt(this.player.x, this.player.y);
      if (!room) return false;
      for (const e of this.enemies) if (!e.dead && e.room && e.room.id === room.id) e.dead = true;
      const st = this._roomState(room.id);
      st.wavesRemaining = 0;
      st.activeWave = false;
      st.cleared = true;
      st.waveWarning = null;
      st.reviveTimer = ((G.DemoConfig || {}).roomReviveInterval) || 16;
      this.toast(G.t('raid.debug.roomCleared'));
      return true;
    },

    _updateAutoHarvest(dt, wantMove) {
      if (!this.demo) return;
      const p = this.player;
      if (p.searching || wantMove || p.moving || p.healing || p.reloading) return;
      const cont = this._nearestCont;
      if (!cont || cont.searched || !cont.items.length) return;
      p.searching = { t: 0, total: this._resourceSearchTime(cont), container: cont };
      G.Audio.play('click', { vol: 0.35 });
    },

    _resourceSearchTime(cont) {
      const cfg = G.DemoConfig || {};
      const times = cfg.resourceSearchTimes || {};
      const base = times[cont.type] || C.SEARCH_TIME;
      return base / this._curseModifier('searchSpeedMultiplier', 1);
    },

    // Aim + fire, run after cam.follow() so the shot uses the SAME camera state
    // the crosshair is drawn with — bullets track the reticle instead of drifting
    // off it when the camera is moving or shaking.
    _aimAndFire(dt) {
      const p = this.player;
      if (this.demo) {
        const target = this._nearestDemoTarget();
        if (target) {
          p.aimAt(U.angle(p.x, p.y, target.x, target.y));
          const before = p.lastShotAt;
          p.tryShoot(this);
          if (p.lastShotAt !== before) this._alertEnemies(p.x, p.y);
        }
        return;
      }
      const aim = Input.aimDir();
      let ang = p.angle;
      if (aim.mode === 'dir') ang = Math.atan2(aim.dy, aim.dx);
      else { const wpt = this.cam.screenToWorld(Input.mouse.x, Input.mouse.y); ang = U.angle(p.x, p.y, wpt.x, wpt.y); }
      p.aimAt(ang);
      const before = p.lastShotAt;
      if (Input.firing()) p.tryShoot(this);
      if (p.lastShotAt !== before) this._alertEnemies(p.x, p.y);
    },

    _nearestDemoTarget() {
      const p = this.player;
      const wdef = p.weaponDef();
      const maxRange = wdef ? wdef.range : 520;
      const maxD2 = maxRange * maxRange;
      const currentRoomId = this.dungeon && this.dungeon.currentRoomId;
      let best = null, bestD2 = Infinity;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (currentRoomId && e.room && e.room.id !== currentRoomId) continue;
        const dx = e.x - p.x, dy = e.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 > maxD2 || d2 >= bestD2) continue;
        if (this.map.los && !this.map.los(p.x, p.y, e.x, e.y)) continue;
        best = e; bestD2 = d2;
      }
      return best;
    },

    _collect(cont) {
      const taken = [];
      let full = false;
      for (let i = cont.items.length - 1; i >= 0; i--) {
        const it = cont.items[i];
        const special = this._collectDungeonItem(it.id, it.n);
        const leftover = special ? special.leftover : this.player.addLoot(it.id, it.n);
        const got = special ? special.got : it.n - leftover;
        if (got > 0) taken.push({ id: it.id, n: got });
        if (leftover > 0) {
          this._dropGroundItem(cont.x, cont.y, it.id, leftover, { delay: 0.1, scatter: 24 });
          full = true;
        }
        cont.items.splice(i, 1);
      }
      cont.searched = true;
      if (this.demo && this.dungeon && this.dungeon.playtest) this.dungeon.playtest.resourcesSearched++;
      if (taken.length) {
        G.Audio.play('pickup', { vol: 0.7 });
        const names = taken.map(t => G.I18n.itemName(t.id) + (t.n > 1 ? ' ' + G.t('ui.item.qty', { n: t.n }) : '')).join(', ');
        this.toast(G.t('raid.toast.looted', { items: names }));
      }
      // any weapon/armor that auto-equipped on pickup announces itself
      this._flushEquipMsgs();
      if (full) this.toast(G.t('raid.toast.bagFull'));
    },

    _dropGroundItem(x, y, id, n, opts) {
      opts = opts || {};
      const scatter = opts.scatter == null ? 18 : opts.scatter;
      this.groundItems.push({
        x: x + U.rand(-scatter, scatter),
        y: y + U.rand(-scatter, scatter),
        id,
        n,
        pop: opts.pop == null ? 0.3 : opts.pop,
        delay: opts.delay == null ? 0 : opts.delay,
        bob: Math.random() * 6,
      });
    },

    _nearestContainer() {
      const p = this.player; let best = null;
      const r = C.LOOT_PICK_RADIUS + 16; let bd = r * r;
      for (const c of this.map.containers) {
        if (c.searched) continue;
        const dx = p.x - c.x, dy = p.y - c.y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = c; }
      }
      return best;
    },

    _alertEnemies(x, y) { for (const e of this.enemies) e.hearShot(x, y); },
    onEnemyShot(x, y) { for (const e of this.enemies) e.hearShot(x, y); },

    _updateBullets(dt) {
      const map = this.map, b = this.bullets;
      for (let i = b.length - 1; i >= 0; i--) {
        const bu = b[i];
        const wallHit = G.updateBullet(bu, dt, map);
        if (wallHit) {
          this.particles.burst(bu.x, bu.y, 3, { color: '#cfcfcf', life: 0.18, spdMax: 90, size: 2 });
          b.splice(i, 1); continue;
        }
        let hit = false;
        if (bu.owner === 'player') {
          for (const e of this.enemies) {
            if (e.dead) continue;
            if (segCircle(bu.px, bu.py, bu.x, bu.y, e.x, e.y, e.r + C.BULLET_RADIUS)) {
              e.takeDamage(bu.damage, this, bu.px, bu.py); hit = true; break;
            }
          }
        } else {
          const p = this.player;
          if (!p.dead && segCircle(bu.px, bu.py, bu.x, bu.y, p.x, p.y, p.r + C.BULLET_RADIUS)) {
            p.takeDamage(bu.damage, this, bu.px, bu.py); hit = true;
          }
        }
        if (hit) b.splice(i, 1);
      }
    },

    _updateGround(dt) {
      const p = this.player;
      for (let i = this.groundItems.length - 1; i >= 0; i--) {
        const g = this.groundItems[i];
        g.pop = Math.max(0, (g.pop || 0) - dt);
        if (g.delay > 0) { g.delay -= dt; continue; }
        if (U.dist(p.x, p.y, g.x, g.y) < C.LOOT_PICK_RADIUS) {
          const special = this._collectDungeonItem(g.id, g.n);
          const leftover = special ? special.leftover : p.addLoot(g.id, g.n);
          const got = special ? special.got : g.n - leftover;
          if (got > 0) {
            G.Audio.play('pickup', { vol: 0.6 });
            const d = G.getItem(g.id);
            const nm = G.I18n.itemName(g.id);
            const txt = d.type === 'ammo' ? G.t('raid.float.pickupAmmo', { n: g.n, ammo: nm }) : G.t('raid.float.pickup', { name: nm });
            this.floatText(g.x, g.y - 10, txt, G.RARITY_COLOR[d.rarity] || '#fff');
          }
          this._flushEquipMsgs();
          g.n = leftover;
          if (g.n <= 0) this.groundItems.splice(i, 1);
          else if (got > 0) this.toast(G.t('raid.toast.bagFull'));
        }
      }
    },

    _collectDungeonItem(id, n) {
      if (!this.demo || !this.dungeon) return null;
      const cfg = G.DemoConfig || {};
      if (id === (cfg.coinItemId || 'd_gold_coin')) {
        const got = Math.max(0, n);
        this.dungeon.gold += got;
        if (this.dungeon.playtest) this.dungeon.playtest.goldCollected += got;
        if (got > 0) this.toast(G.t('raid.toast.goldPicked', { n: got, total: this.dungeon.gold }));
        return { got, leftover: 0 };
      }
      if (id !== cfg.scrollItemId) return null;
      const before = this.dungeon.scrollFragments;
      const max = this.dungeon.requiredFragments;
      const got = Math.max(0, Math.min(n, max - before));
      this.dungeon.scrollFragments = Math.min(max, before + got);
      if (got > 0) {
        this.toast(G.t(this._canNormalExtract() ? 'raid.toast.scrollReady' : 'raid.toast.scrollFragment', this._scrollParams()));
      }
      return { got, leftover: 0 };
    },

    _canNormalExtract() {
      return !!(this.demo && this.dungeon && this.dungeon.scrollFragments >= this.dungeon.requiredFragments);
    },

    _scrollParams() {
      const d = this.dungeon || { scrollFragments: 0, requiredFragments: 0 };
      return { n: d.scrollFragments, total: d.requiredFragments };
    },

    _updateDungeonCurses() {
      if (!this.demo || !this.dungeon || this.dungeon.cursePending) return;
      const cfg = G.DemoConfig || {};
      const d = this.dungeon;
      const max = cfg.curseMaxChoices || 2;
      if (d.curseTriggers >= max) return;
      const killTriggers = cfg.curseKillTriggers || [3, 8];
      const timeTriggers = cfg.curseTimeTriggers || [90, 180];
      const idx = d.curseTriggers;
      const killReady = killTriggers[idx] != null && this.kills >= killTriggers[idx];
      const timeReady = timeTriggers[idx] != null && this.time >= timeTriggers[idx];
      if (killReady || timeReady) this._openCurseChoice();
    },

    _openCurseChoice() {
      this.dungeon.selectedSkills = this.dungeon.selectedSkills || [];
      this.dungeon.selectedCurses = this.dungeon.selectedCurses || [];
      const randomPools = G.DemoRandomPools || {};
      const curses = (randomPools.curses || G.DemoCurses || [])
        .map(c => Object.assign({ type: 'curse' }, c))
        .filter(c => this.dungeon.selectedCurses.indexOf(c.id) < 0);
      const skills = (randomPools.skills || G.DemoSkills || [])
        .map(s => Object.assign({ type: 'skill', rewardBonus: 0 }, s))
        .filter(s => this.dungeon.selectedSkills.indexOf(s.id) < 0);
      const choices = [];
      if (curses.length) {
        const i = U.randInt(0, curses.length - 1);
        choices.push(curses.splice(i, 1)[0]);
      }
      const pool = curses.concat(skills);
      while (pool.length && choices.length < 3) {
        const i = U.randInt(0, pool.length - 1);
        choices.push(pool.splice(i, 1)[0]);
      }
      if (!choices.length) return;
      this.dungeon.curseChoices = choices;
      this.dungeon.cursePending = true;
      this.paused = true;
      Input.resetTouch();
      this.onCurseChoice(this);
    },

    chooseCurse(id) {
      if (!this.demo || !this.dungeon || !this.dungeon.cursePending) return false;
      const pick = this.dungeon.curseChoices.find(c => c.id === id);
      if (!pick) return false;
      if (pick.type === 'skill') this.dungeon.selectedSkills.push(pick.id);
      else this.dungeon.selectedCurses.push(pick.id);
      if (this.dungeon.playtest) {
        this.dungeon.playtest.choicesTaken++;
        if (pick.type === 'skill') this.dungeon.playtest.skillsTaken++;
        else this.dungeon.playtest.cursesTaken++;
      }
      this.dungeon.rewardMultiplier = round2(this.dungeon.rewardMultiplier * (1 + (pick.rewardBonus || 0)));
      this.dungeon.curseTriggers++;
      this.dungeon.curseChoices = [];
      this.dungeon.cursePending = false;
      this._recomputeCurseModifiers();
      const ns = pick.type === 'skill' ? 'skill.' : 'curse.';
      this.toast(G.t('raid.toast.curseChosen', { name: G.t(ns + pick.id + '.name'), mul: this.dungeon.rewardMultiplier.toFixed(2) }));
      Input.resetTouch();
      this.paused = false;
      return true;
    },

    _recomputeCurseModifiers() {
      const d = this.dungeon;
      if (!d) return;
      const m = defaultCurseModifiers();
      const selected = (d.selectedCurses || []).map(id => ({ id, pool: G.DemoCurses || [] }))
        .concat((d.selectedSkills || []).map(id => ({ id, pool: G.DemoSkills || [] })));
      const effectSets = selected.map(entry => {
        const source = entry.pool.find(x => x.id === entry.id);
        return source && source.effects;
      });
      if (d.challenge && d.challenge.modifiers) effectSets.push(d.challenge.modifiers);
      for (const e of effectSets) {
        if (!e) continue;
        m.searchSpeedMultiplier *= e.searchSpeedMultiplier || 1;
        m.monsterSpawnIntervalMultiplier *= e.monsterSpawnIntervalMultiplier || 1;
        m.scrollDropMultiplier *= e.scrollDropMultiplier || 1;
        m.healMultiplier *= e.healMultiplier || 1;
        m.backpackSlotsBonus += e.backpackSlotsBonus || 0;
        m.playerSpeedMultiplier *= e.playerSpeedMultiplier || 1;
        m.highValueDropMultiplier *= e.highValueDropMultiplier || 1;
        m.monsterLevelIntervalDelta += e.monsterLevelIntervalDelta || 0;
        m.playerDamageMultiplier *= e.playerDamageMultiplier || 1;
        m.playerProjectileBonus += e.playerProjectileBonus || 0;
        m.playerFireRateMultiplier *= e.playerFireRateMultiplier || 1;
        m.playerProjectileRangeMultiplier *= e.playerProjectileRangeMultiplier || 1;
        m.playerTakenDamageMultiplier *= e.playerTakenDamageMultiplier || 1;
        m.eliteDropMultiplier *= e.eliteDropMultiplier || 1;
        m.eliteSpawnChanceMultiplier *= e.eliteSpawnChanceMultiplier || 1;
        m.roleRusherChanceMultiplier *= e.roleRusherChanceMultiplier || 1;
        m.roleMarksmanChanceMultiplier *= e.roleMarksmanChanceMultiplier || 1;
      }
      d.modifiers = m;
      this.player.backpackSlotBonus = m.backpackSlotsBonus;
      this.player.moveSpeedMultiplier = m.playerSpeedMultiplier;
    },

    _curseModifier(name, fallback) {
      const m = this.dungeon && this.dungeon.modifiers;
      return m && m[name] != null ? m[name] : fallback;
    },

    _updateDungeonPressure(dt) {
      if (!this.demo || !this.dungeon) return;
      const cfg = G.DemoConfig || {};
      const d = this.dungeon;
      const interval = this._monsterLevelInterval();
      const maxLevel = cfg.monsterLevelMax || 6;
      d.monsterLevelTimer += dt;
      while (d.monsterLevelTimer >= interval && d.monsterLevel < maxLevel) {
        d.monsterLevelTimer -= interval;
        d.monsterLevel++;
        this.toast(G.t('raid.toast.monsterLevel', { n: d.monsterLevel }));
      }

      if (!d.enraged && this.time >= (cfg.enrageTime || 300)) {
        d.enraged = true;
        this.toast(G.t('raid.toast.enraged'));
      }

      if (!d.eliteSpawned && d.monsterLevel >= (cfg.eliteLevel || 3)) {
        this._spawnPressureEnemy('raider');
        d.eliteSpawned = true;
        this.toast(G.t('raid.toast.eliteSpawned'));
      }

      d.spawnTimer -= dt;
      while (d.spawnTimer <= 0) {
        this._spawnPressureEnemy();
        d.spawnTimer += this._monsterSpawnInterval();
      }
    },

    _spawnPressureEnemy(tierOverride) {
      if (!this.map.enemySpawns || !this.map.enemySpawns.length) return false;
      const cfg = G.DemoConfig || {};
      const alive = this.enemies.filter(e => !e.dead).length;
      if (alive >= (cfg.monsterSpawnMaxAlive || 18)) return false;
      let spawns = this.map.enemySpawns;
      if (this.demo && this.dungeon && this.dungeon.currentRoomId) {
        const sameRoom = spawns.filter(s => s.roomId === this.dungeon.currentRoomId);
        if (sameRoom.length) spawns = sameRoom;
      }
      let src = U.choice(spawns);
      if (this.demo && this.dungeon && this.dungeon.currentRoomId) {
        const room = this.map.rooms.find(r => r.id === this.dungeon.currentRoomId);
        const safeRadius = (G.DemoConfig && G.DemoConfig.roomSpawnSafeRadius) || 118;
        const far = spawns.filter(s => U.dist(s.x, s.y, this.player.x, this.player.y) >= safeRadius);
        if (far.length) src = U.choice(far);
        else src = this._fallbackRoomSpawn(room, safeRadius) || src;
      }
      let tier = tierOverride || 'beast';
      if (!tierOverride) {
        const level = this.dungeon ? this.dungeon.monsterLevel : 1;
        const baseEliteChance = (this.dungeon && this.dungeon.enraged) ? 0.32 : (level >= 4 ? 0.2 : level >= 3 ? 0.1 : 0);
        const eliteChance = U.clamp(baseEliteChance * this._curseModifier('eliteSpawnChanceMultiplier', 1), 0, 0.95);
        if (U.chance(eliteChance)) tier = 'raider';
        else tier = U.chance(cfg.monsterRangedChance == null ? 0.16 : cfg.monsterRangedChance) ? 'scav' : 'beast';
      }
      this._spawnEnemyFromPoint(src, tier);
      return true;
    },

    _monsterHpMultiplier() {
      if (!this.demo || !this.dungeon) return 1;
      const cfg = G.DemoConfig || {};
      const levelBonus = Math.max(0, this.dungeon.monsterLevel - 1) * (cfg.monsterHpPerLevel || 0);
      const enrageBonus = this.dungeon.enraged ? (cfg.enrageHpBonus || 0) : 0;
      return 1 + levelBonus + enrageBonus;
    },

    _monsterDamageMultiplier() {
      if (!this.demo || !this.dungeon) return 1;
      const cfg = G.DemoConfig || {};
      const levelBonus = Math.max(0, this.dungeon.monsterLevel - 1) * (cfg.monsterDamagePerLevel || 0);
      const enrageBonus = this.dungeon.enraged ? (cfg.enrageDamageBonus || 0) : 0;
      return 1 + levelBonus + enrageBonus;
    },

    _monsterSpawnInterval() {
      const cfg = G.DemoConfig || {};
      const base = cfg.monsterSpawnInterval || 20;
      const min = cfg.monsterSpawnMinInterval || 9;
      const level = this.dungeon ? this.dungeon.monsterLevel : 1;
      let interval = base * Math.pow(1 - (cfg.monsterSpawnLevelReduction || 0), Math.max(0, level - 1));
      if (this.dungeon && this.dungeon.enraged) interval *= (cfg.enrageSpawnIntervalMultiplier || 1);
      interval *= this._curseModifier('monsterSpawnIntervalMultiplier', 1);
      return Math.max(min, interval);
    },

    _monsterLevelInterval() {
      const cfg = G.DemoConfig || {};
      const base = cfg.monsterLevelInterval || 45;
      return Math.max(10, base + this._curseModifier('monsterLevelIntervalDelta', 0));
    },

    _playerDamageMultiplier() { return this._curseModifier('playerDamageMultiplier', 1); },
    _playerProjectileBonus() { return Math.max(0, Math.round(this._curseModifier('playerProjectileBonus', 0))); },
    _playerFireRateMultiplier() { return this._curseModifier('playerFireRateMultiplier', 1); },
    _playerProjectileRangeMultiplier() { return this._curseModifier('playerProjectileRangeMultiplier', 1); },
    _playerTakenDamageMultiplier() { return this._curseModifier('playerTakenDamageMultiplier', 1); },
    _healMultiplier() { return this._curseModifier('healMultiplier', 1); },
    _enemyMoveSpeedMultiplier() { return this.demo && G.DemoConfig ? (G.DemoConfig.enemyMoveSpeedMultiplier || 1) : 1; },
    _enemyProjectileSpeedMultiplier() { return this.demo && G.DemoConfig ? (G.DemoConfig.enemyProjectileSpeedMultiplier || 1) : 1; },

    // Drain any auto-equip notifications queued by Player.addLoot during a pickup.
    _flushEquipMsgs() {
      const m = this.player._equipMsgs;
      if (m && m.length) {
        for (const nm of m) this.toast(G.t('toast.equipped', { name: nm }));
        this.player._equipMsgs = null;
      }
    },

    _updateExtract(dt) {
      if (this.demo && this.dungeon) return this._updatePerfectExtract(dt);
      const p = this.player;
      let inZone = null;
      for (const z of this.map.extracts) {
        if (U.dist(p.x, p.y, z.x, z.y) < z.r) { inZone = z; break; }
      }
      if (inZone) {
        if (!this.extracting || this.extracting.zone !== inZone) this.extracting = { zone: inZone, t: 0 };
        this.extracting.t += dt;
        if (this.extracting.t >= C.EXTRACT_TIME) { G.Audio.play('extract', { vol: 0.9 }); this._finish('extract'); }
      } else if (this.extracting) {
        this.extracting = null;
      }
    },

    _updatePortals(dt) {
      if (!this.demo || !this.dungeon || !this.map.portals || !this.map.portals.length) return;
      const d = this.dungeon;
      d.portalCooldown = Math.max(0, (d.portalCooldown || 0) - dt);
      const room = this._roomAt(this.player.x, this.player.y);
      if (room) d.currentRoomId = room.id;
      if (!room || d.portalCooldown > 0) { d.portalPayment = null; return; }
      let nearLockedOrPaying = false;
      for (const p of this.map.portals) {
        if (p.fromRoomId !== room.id) continue;
        if (U.dist(this.player.x, this.player.y, p.x, p.y) >= p.r) continue;
        if (!this._roomPortalsOpen(room.id)) {
          nearLockedOrPaying = true;
          d.portalPayment = null;
          this.toast(G.t('raid.toast.roomLocked'));
          return;
        }
        if (p.kind === 'gold' && p.paid < p.cost) {
          nearLockedOrPaying = true;
          this._updateGoldPortalPayment(p, dt);
          if (p.paid < p.cost) return;
        }
        const target = this.map.rooms.find(r => r.id === p.toRoomId);
        if (!target) return;
        const fromRoomId = room.id;
        const c = this.map.tileCenter(target.cx, target.cy);
        this.player.x = c.x; this.player.y = c.y;
        this.player.cancelActions();
        d.currentRoomId = target.id;
        d.portalCooldown = 0.55;
        d.roomEntryGrace = (G.DemoConfig && G.DemoConfig.roomEntryGraceTime) || 1.35;
        if (!d.extractionChallenge || d.extractionChallenge.phase !== 'active') {
          this.extracting = null;
          if (d.extractionChallenge) d.extractionChallenge = null;
        }
        this.cam.x = this.player.x; this.cam.y = this.player.y;
        this._pacifyRoomEnemies(fromRoomId);
        this._enterRoom(target);
        this.toast(G.t('raid.toast.portalEntered'));
        return;
      }
      if (!nearLockedOrPaying) d.portalPayment = null;
    },

    _enterRoom(room) {
      if (!this.demo || !this.dungeon || !room) return;
      const d = this.dungeon;
      d.currentRoomId = room.id;
      const st = this._roomState(room.id);
      if (!st.started) {
        st.started = true;
        if (d.playtest) {
          d.playtest.roomsEntered++;
          if (room.kind === 'reward') d.playtest.rewardRoomsEntered++;
        }
        if (st.wavesRemaining > 0) this._startRoomWarning(room.id, 'wave');
        else st.cleared = true;
      }
    },

    _roomState(roomId) {
      const d = this.dungeon;
      if (!d.roomStates[roomId]) {
        const room = this.map.rooms.find(r => r.id === roomId) || {};
        const cfg = G.DemoConfig || {};
        d.roomStates[roomId] = {
          started: false,
          cleared: room.kind === 'spawn',
          wavesRemaining: room.waveCount || 0,
          activeWave: false,
          waveWarning: null,
          reviveTimer: cfg.roomReviveInterval || 16,
        };
      }
      return d.roomStates[roomId];
    },

    _updateRoomCombat(dt) {
      if (!this.demo || !this.dungeon || !this.map.roomGraph) return;
      const room = this._roomAt(this.player.x, this.player.y);
      if (!room) return;
      if (room.id !== this.dungeon.currentRoomId) this._enterRoom(room);
      const st = this._roomState(room.id);
      if (!st.started) this._enterRoom(room);
      if (st.waveWarning) {
        st.waveWarning.t -= dt;
        if (st.waveWarning.t <= 0) {
          const kind = st.waveWarning.kind;
          st.waveWarning = null;
          if (kind === 'revive') this._spawnRoomRevive(room.id);
          else this._spawnRoomWave(room.id);
        }
        return;
      }
      const alive = this._aliveEnemiesInRoom(room.id);
      if (st.activeWave && alive <= 0) {
        st.activeWave = false;
        if (st.wavesRemaining > 0) this._startRoomWarning(room.id, 'wave');
        else {
          st.cleared = true;
          st.reviveTimer = ((G.DemoConfig || {}).roomReviveInterval) || 16;
          this.toast(G.t('raid.toast.roomCleared'));
        }
      } else if (st.cleared) {
        if (alive > 0) return;
        st.reviveTimer -= dt;
        if (st.reviveTimer <= 0) {
          if (this._canSpawnRoomRevive(room.id)) this._startRoomWarning(room.id, 'revive');
          else st.reviveTimer += ((G.DemoConfig || {}).roomReviveInterval) || 16;
        }
      }
    },

    _startRoomWarning(roomId, kind) {
      const st = this._roomState(roomId);
      const cfg = G.DemoConfig || {};
      st.waveWarning = { kind: kind || 'wave', t: cfg.roomWaveWarningTime || 5, total: cfg.roomWaveWarningTime || 5 };
      if (kind !== 'revive') st.cleared = false;
      return st.waveWarning;
    },

    _spawnRoomWave(roomId) {
      const st = this._roomState(roomId);
      const room = this.map.rooms.find(r => r.id === roomId);
      if (!room || st.wavesRemaining <= 0) return false;
      const count = room.waveSize || 3;
      const eliteChance = room.kind === 'reward' ? 0.18 : room.kind === 'extract' ? 0.14 : room.pathIndex >= 2 ? 0.08 : 0;
      for (let i = 0; i < count; i++) this._spawnEnemyInRoom(roomId, eliteChance);
      st.wavesRemaining--;
      st.activeWave = true;
      return true;
    },

    _spawnRoomRevive(roomId) {
      const room = this.map.rooms.find(r => r.id === roomId);
      if (!room || room.kind === 'spawn') return false;
      const cfg = G.DemoConfig || {};
      const alive = this._aliveEnemiesInRoom(roomId);
      const maxAlive = cfg.roomReviveMaxAlive || 6;
      if (alive >= maxAlive) return false;
      const desired = Math.max(cfg.roomReviveMinCount || 2, Math.ceil((room.waveSize || 4) * (cfg.roomReviveBatchRatio || 0.5)));
      const count = Math.min(maxAlive - alive, desired);
      if (count <= 0) return false;
      const eliteChance = room.kind === 'reward' ? 0.14 : 0.04;
      for (let i = 0; i < count; i++) this._spawnEnemyInRoom(roomId, eliteChance, { revive: true });
      const st = this._roomState(roomId);
      st.cleared = true;
      st.activeWave = false;
      st.reviveTimer = cfg.roomReviveInterval || 16;
      this.toast(G.t('raid.toast.roomRevive'));
      return true;
    },

    _canSpawnRoomRevive(roomId) {
      const room = this.map.rooms.find(r => r.id === roomId);
      if (!room || room.kind === 'spawn') return false;
      const cfg = G.DemoConfig || {};
      const alive = this._aliveEnemiesInRoom(roomId);
      const maxAlive = cfg.roomReviveMaxAlive || 6;
      if (alive >= maxAlive) return false;
      const desired = Math.max(cfg.roomReviveMinCount || 2, Math.ceil((room.waveSize || 4) * (cfg.roomReviveBatchRatio || 0.5)));
      return Math.min(maxAlive - alive, desired) > 0;
    },

    _spawnEnemyInRoom(roomId, eliteChance, opts) {
      const spawns = (this.map.enemySpawns || []).filter(s => s.roomId === roomId);
      if (!spawns.length) return false;
      const room = this.map.rooms.find(r => r.id === roomId);
      const safeRadius = (G.DemoConfig && G.DemoConfig.roomSpawnSafeRadius) || 118;
      const far = spawns.filter(s => U.dist(s.x, s.y, this.player.x, this.player.y) >= safeRadius);
      const pool = far.length ? far : spawns.slice().sort((a, b) =>
        U.dist(b.x, b.y, this.player.x, this.player.y) - U.dist(a.x, a.y, this.player.x, this.player.y));
      const src = far.length ? U.choice(pool) : (this._fallbackRoomSpawn(room, safeRadius) || pool[0]);
      const rangedChance = this._roomRangedChance(room, opts);
      const elite = U.chance(U.clamp((eliteChance || 0) * this._curseModifier('eliteSpawnChanceMultiplier', 1), 0, 0.95));
      const tier = elite ? 'raider' : (U.chance(rangedChance) ? 'scav' : 'beast');
      this._spawnEnemyFromPoint(src, tier);
      return true;
    },

    _fallbackRoomSpawn(room, safeRadius) {
      if (!room) return null;
      for (let tries = 0; tries < 32; tries++) {
        const tx = U.randInt(room.x + 1, room.x + room.w - 2);
        const ty = U.randInt(room.y + 1, room.y + room.h - 2);
        const c = this.map.tileCenter(tx, ty);
        if (this.map.solidAtPx(c.x, c.y)) continue;
        if (U.dist(c.x, c.y, this.player.x, this.player.y) < safeRadius) continue;
        return { x: c.x, y: c.y, tier: 'beast', room, roomId: room.id };
      }
      return null;
    },

    _roomRangedChance(room, opts) {
      const cfg = G.DemoConfig || {};
      if (opts && opts.revive) return cfg.roomReviveRangedChance == null ? 0.12 : cfg.roomReviveRangedChance;
      if (room && room.kind === 'reward') return cfg.roomRewardRangedChance == null ? 0.28 : cfg.roomRewardRangedChance;
      if (room && room.kind === 'extract') return cfg.roomExtractRangedChance == null ? 0.24 : cfg.roomExtractRangedChance;
      if (room && room.pathIndex <= 1) return cfg.roomEarlyRangedChance == null ? 0 : cfg.roomEarlyRangedChance;
      return cfg.roomRangedChance == null ? 0.16 : cfg.roomRangedChance;
    },

    _enemyFireSuppressed() {
      return !!(this.demo && this.dungeon && this.dungeon.roomEntryGrace > 0);
    },

    _playerDamageSuppressed() {
      return !!(this.demo && this.dungeon && this.dungeon.roomEntryGrace > 0);
    },

    _aliveEnemiesInRoom(roomId) {
      return this.enemies.filter(e => !e.dead && e.room && e.room.id === roomId).length;
    },

    _pacifyRoomEnemies(roomId) {
      for (const e of this.enemies) {
        if (e.dead || !e.room || e.room.id !== roomId) continue;
        e.state = 'patrol';
        e.stateT = 0;
        e.lastKnown = null;
        e.path = null;
        e.canSee = false;
        e.reactT = e.def && e.def.reactTime ? e.def.reactTime : 0;
      }
    },

    _perfectExtractActive() {
      const ch = this.demo && this.dungeon && this.dungeon.extractionChallenge;
      return !!(ch && ch.phase === 'active');
    },

    _roomPortalsOpen(roomId) {
      const st = this._roomState(roomId);
      return !!st.cleared && !this._perfectExtractActive();
    },

    _updateGoldPortalPayment(portal, dt) {
      const d = this.dungeon;
      const cfg = G.DemoConfig || {};
      if (!d.portalPayment || d.portalPayment.portalId !== portal.id) d.portalPayment = { portalId: portal.id, t: 0 };
      if (this.player.moving) { d.portalPayment.t = 0; return; }
      if ((d.gold || 0) <= 0) {
        this.toast(G.t('raid.toast.goldNeeded', { n: portal.cost - portal.paid }));
        return;
      }
      d.portalPayment.t += dt;
      const interval = cfg.coinPortalPayInterval || 0.18;
      while (d.portalPayment.t >= interval && portal.paid < portal.cost && d.gold > 0) {
        d.portalPayment.t -= interval;
        d.gold--;
        if (d.playtest) d.playtest.goldSpent++;
        portal.paid++;
        this.spawnCoinFlight(this.player.x, this.player.y - 10, portal.x, portal.y - 6);
        this.floatText(portal.x, portal.y - 18, portal.paid + '/' + portal.cost, '#f0c44a');
      }
      if (portal.paid >= portal.cost) {
        if (d.playtest && !portal.playtestOpened) {
          d.playtest.paidPortalsOpened++;
          portal.playtestOpened = true;
        }
        this.toast(G.t('raid.toast.goldPortalOpen'));
      }
    },

    _roomAt(x, y) {
      const t = this.map.worldToTile(x, y);
      for (const r of this.map.rooms || []) {
        if (t.tx >= r.x && t.tx < r.x + r.w && t.ty >= r.y && t.ty < r.y + r.h) return r;
      }
      return null;
    },

    _updatePerfectExtract(dt) {
      const p = this.player;
      const cfg = G.DemoConfig || {};
      const d = this.dungeon;
      const room = this._roomAt(p.x, p.y);
      if (room) d.currentRoomId = room.id;
      let inZone = null;
      for (const z of this.map.extracts) {
        if (U.dist(p.x, p.y, z.x, z.y) < z.r) { inZone = z; break; }
      }
      let ch = d.extractionChallenge;
      if (!ch || (ch.phase !== 'active' && ch.zone !== inZone)) {
        if (!inZone) {
          d.extractionChallenge = null;
          if (this.extracting && this.extracting.phase === 'arming') this.extracting = null;
          return;
        }
        ch = d.extractionChallenge = {
          zone: inZone,
          t: 0,
          total: cfg.perfectExtractArmTime || 2,
          phase: 'arming',
          spawnTimer: 0,
        };
      }
      this.extracting = ch;
      if (ch.phase === 'arming') {
        if (!inZone || p.moving) {
          ch.t = 0;
          this.extracting = ch;
          return;
        }
        ch.t += dt;
        if (ch.t < ch.total) return;
        dt = ch.t - ch.total;
        ch.phase = 'active';
        ch.t = 0;
        ch.total = cfg.perfectExtractTime || 30;
        ch.spawnTimer = 0;
        this.toast(G.t('raid.toast.perfectExtractStarted', { n: Math.round(ch.total) }));
      }
      ch.t += dt;
      ch.spawnTimer -= dt;
      while (ch.spawnTimer <= 0) {
        this._spawnPressureEnemy();
        ch.spawnTimer += cfg.perfectExtractSpawnInterval || 4;
      }
      if (ch.t >= ch.total) {
        G.Audio.play('extract', { vol: 0.9 });
        this._finish('perfect_extract');
      }
    },

    _extractDuration() {
      return this.extracting && this.extracting.total ? this.extracting.total : C.EXTRACT_TIME;
    },

    _perfectExtractRewardMultiplier() {
      if (!this.demo) return 1;
      const cfg = G.DemoConfig || {};
      return cfg.perfectExtractRewardMultiplier || 1;
    },
    _demoPaceCheck(seconds) {
      if (!this.demo) return null;
      const cfg = G.DemoConfig || {};
      const min = cfg.targetRunMinTime || 300;
      const max = cfg.targetRunMaxTime || 480;
      const time = Math.max(0, Math.round(seconds || 0));
      const tag = time < min ? 'short' : time > max ? 'long' : 'target';
      return { paceTag: tag, targetRunMinTime: min, targetRunMaxTime: max };
    },
    _demoClock(seconds) {
      const t = Math.max(0, Math.round(seconds || 0));
      const m = Math.floor(t / 60);
      const s = t % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    },
    _demoPlaytestMetrics() {
      if (!this.demo || !this.dungeon || !this.dungeon.playtest) return null;
      const p = this.dungeon.playtest;
      return {
        resourcesSearched: p.resourcesSearched || 0,
        goldCollected: p.goldCollected || 0,
        goldSpent: p.goldSpent || 0,
        paidPortalsOpened: p.paidPortalsOpened || 0,
        roomsEntered: p.roomsEntered || 0,
        rewardRoomsEntered: p.rewardRoomsEntered || 0,
        choicesTaken: p.choicesTaken || 0,
        cursesTaken: p.cursesTaken || 0,
        skillsTaken: p.skillsTaken || 0,
      };
    },

    _reveal() {
      const p = this.player, map = this.map, R = 7;
      const ct = map.worldToTile(p.x, p.y);
      const mctx = this._miniCtx;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const tx = ct.tx + dx, ty = ct.ty + dy;
          if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
          const i = ty * map.w + tx;
          if (this.visited[i]) continue;
          this.visited[i] = 1;
          if (mctx) { mctx.fillStyle = map.grid[i] === 1 ? '#2a2d34' : '#4a5448'; mctx.fillRect(tx, ty, 1, 1); }
        }
      }
    },

    /* ---------------------------- Events ------------------------------- */
    onEnemyKilled(e) {
      this.kills++; this.player.kills++;
      this.killsByTier[e.tier] = (this.killsByTier[e.tier] || 0) + 1;
      this.floatText(e.x, e.y - 20, G.t('raid.float.eliminated'), '#ff5a5a');
      const scatter = () => U.rand(-14, 14);
      const drop = (id, n) => this.groundItems.push({ x: e.x + scatter(), y: e.y + scatter(), id, n, pop: 0.3, delay: 0.25, bob: Math.random() * 6 });
      if (this.demo && this.dungeon) {
        const cfg = G.DemoConfig || {};
        const elite = e.tier === 'raider' || e.tier === 'boss';
        const goldRange = elite ? (cfg.eliteGoldDrop || [1, 2]) : (cfg.normalGoldDrop || [1, 1]);
        drop(cfg.coinItemId || 'd_gold_coin', U.randInt(goldRange[0], goldRange[1]));
        const table = (G.DemoRandomPools && G.DemoRandomPools.lootDrops) || G.DemoLootDrops || [];
        const rolls = elite ? (cfg.eliteLootRolls || 1) : (U.chance(cfg.normalLootDropChance == null ? 0.65 : cfg.normalLootDropChance) ? 1 : 0);
        for (let i = 0; i < rolls && table.length; i++) {
          const pick = this._weightedDungeonDrop(table);
          drop(pick.id, U.randInt(pick.qty[0], pick.qty[1]));
        }
        return;
      }
      // weapon drop
      if (e.weaponId && U.chance(0.5)) drop(e.weaponId, 1);
      // armor drop
      if (e.armorId && U.chance(0.4)) drop(e.armorId, 1);
      // some ammo of its caliber
      const weaponDef = e.weaponId && G.getItem(e.weaponId);
      const cal = weaponDef && weaponDef.ammoType;
      if (cal && G.AMMO_ITEM[cal] && U.chance(0.7)) drop(G.AMMO_ITEM[cal], U.randInt(8, 24));
      // tier drop table
      const tier = e.def;
      let rolls = U.randInt(tier.dropRolls[0], tier.dropRolls[1]);
      if ((e.tier === 'raider' || e.tier === 'boss') && U.chance(Math.max(0, this._curseModifier('eliteDropMultiplier', 1) - 1))) rolls++;
      for (let i = 0; i < rolls; i++) {
        const pick = this._weightedDungeonDrop(tier.drops);
        drop(pick.id, U.randInt(pick.qty[0], pick.qty[1]));
      }
    },

    _weightedDungeonDrop(table) {
      if (!this.demo || !this.dungeon) return U.weighted(table);
      const scrollMul = this._curseModifier('scrollDropMultiplier', 1);
      const highMul = this._curseModifier('highValueDropMultiplier', 1);
      if (scrollMul === 1 && highMul === 1) return U.weighted(table);
      const cfg = G.DemoConfig || {};
      const weighted = table.map(row => {
        const def = G.getItem(row.id);
        let w = row.w;
        if (row.id === cfg.scrollItemId) w *= scrollMul;
        if (def && def.type === 'valuable' && (def.rarity === 'rare' || def.rarity === 'epic')) w *= highMul;
        return Object.assign({}, row, { w });
      });
      return U.weighted(weighted);
    },

    /* ----------------------------- Finish ------------------------------ */
    _finish(outcome) {
      if (this.result) return;
      if (this.demo && outcome === 'death') outcome = this._canNormalExtract() ? 'normal_extract' : 'failed';
      if (outcome === 'death') G.Audio.play('death', { vol: 0.9 });
      if (outcome === 'failed') G.Audio.play('death', { vol: 0.9 });
      const failed = outcome === 'failed';
      const baseLootValue = this.player.lootValue();
      const baseItems = this.player.backpack.reduce((a, s) => a + s.n, 0);
      const curseRewardMultiplier = this.dungeon ? this.dungeon.rewardMultiplier : 1;
      const perfectRewardMultiplier = outcome === 'perfect_extract' ? this._perfectExtractRewardMultiplier() : 1;
      const rewardMultiplier = round2(curseRewardMultiplier * perfectRewardMultiplier);
      const finalLootValue = Math.round(baseLootValue * rewardMultiplier);
      const pace = this._demoPaceCheck(Math.round(this.time));
      const playtestMetrics = this._demoPlaytestMetrics();
      this.result = {
        settlementId: U.uuid(),
        outcome, kills: this.kills,
        lootValue: failed ? 0 : finalLootValue,
        baseLootValue,
        baseItems,
        rewardMultiplier,
        curseRewardMultiplier,
        perfectRewardMultiplier,
        lostLootValue: failed ? baseLootValue : 0,
        items: failed ? 0 : baseItems,
        time: Math.round(this.time), scav: this.scav,
        locId: this.location && this.location.id,   // for contract counters
        levelId: this.dungeon && this.dungeon.level ? this.dungeon.level.id : undefined,
        levelOrder: this.dungeon && this.dungeon.level ? this.dungeon.level.order : undefined,
        challengeId: this.dungeon && this.dungeon.challenge ? this.dungeon.challenge.id : undefined,
        killsByTier: this.killsByTier,
        scrollFragments: this.dungeon ? this.dungeon.scrollFragments : undefined,
        requiredFragments: this.dungeon ? this.dungeon.requiredFragments : undefined,
      };
      if (pace) Object.assign(this.result, pace);
      if (playtestMetrics) this.result.playtestMetrics = playtestMetrics;
      this.onFinish(this.result);
    },
    abandon() { this._finish('abandoned'); },

    /* ------------------------- Toasts / floats ------------------------- */
    toast(msg) { this.toasts.push({ msg, t: 2.6 }); if (this.toasts.length > 5) this.toasts.shift(); },
    _updateToasts(dt) { for (let i = this.toasts.length - 1; i >= 0; i--) { this.toasts[i].t -= dt; if (this.toasts[i].t <= 0) this.toasts.splice(i, 1); } },
    floatText(x, y, text, color) { this.floats.push({ x, y, text, color, t: 1.1, vy: -26 }); },
    _updateFloats(dt) { for (let i = this.floats.length - 1; i >= 0; i--) { const f = this.floats[i]; f.t -= dt; f.y += f.vy * dt; if (f.t <= 0) this.floats.splice(i, 1); } },

    /* --------------------------- Button layout ------------------------- */
    // Action buttons live in a bottom-CENTRE row (between the two floating sticks,
    // out of the aim thumb's bottom-right territory). All geometry respects the
    // notch / home-indicator safe-area insets.
    _layoutButtons(w, h) {
      if (!Input.touchEnabled) {
        Input.clearButtons();
        const S = G.safe;
        this._desktopInvButton = { x: w - S.r - 124, y: S.t + 54, w: 110, h: 28 };
        return;
      }
      this._desktopInvButton = null;
      const S = G.safe;
      const pad = 12;
      const names = ['sprint', 'search', 'reload', 'heal', 'swap'];
      // size the row to fit the available width between safe insets
      const avail = w - S.l - S.r - pad * 2;
      const gap = 8;
      let s = Math.min(66, Math.max(42, h * 0.1));
      if (names.length * s + (names.length - 1) * gap > avail) s = Math.max(36, (avail - (names.length - 1) * gap) / names.length);
      const total = names.length * s + (names.length - 1) * gap;
      const startX = S.l + (w - S.l - S.r - total) / 2;
      const rowY = h - S.b - pad - s;
      names.forEach((n, i) => Input.setButton(n, startX + i * (s + gap), rowY, s, s));
      // top corners
      const bagW = s * 1.0, bagH = s * 0.6;
      Input.setButton('inv', w - S.r - pad - bagW, S.t + pad, bagW, bagH);
      Input.setButton('pause', S.l + pad, S.t + pad, s * 0.8, s * 0.55);
      this._btnSize = s;
      this._actionRowY = rowY;
      this._invBottom = S.t + pad + bagH;
    },

    _layoutDemoHud(w, h) {
      this._curseHudButtons = [];
      if (!this.demo || !this.dungeon) return;
      const ids = this.dungeon.selectedCurses || [];
      const S = G.safe;
      const size = Input.touchEnabled ? 34 : 30;
      const gap = 6;
      const total = ids.length * size + Math.max(0, ids.length - 1) * gap;
      const x = Math.round((w - total) / 2);
      const y = 50 + S.t;
      for (let i = 0; i < ids.length; i++) {
        const rect = { id: ids[i], x: x + i * (size + gap), y, w: size, h: size };
        this._curseHudButtons.push(rect);
        if (Input.touchEnabled) Input.setButton('curseHud' + i, rect.x, rect.y, rect.w, rect.h);
      }
    },

    _handleCurseHudInput() {
      if (!this.demo || !this.dungeon || !this._curseHudButtons.length) return;
      let hit = null;
      if (Input.touchEnabled) {
        for (let i = 0; i < this._curseHudButtons.length; i++) {
          if (Input.consumeAction('curseHud' + i)) { hit = this._curseHudButtons[i]; break; }
        }
      } else if (Input.mousePressed()) {
        hit = this._curseHudButtons.find(b => pointInRect(Input.mouse.x, Input.mouse.y, b));
        if (!hit) this._curseTooltipId = null;
      }
      if (hit) this._curseTooltipId = this._curseTooltipId === hit.id ? null : hit.id;
    },

    /* ----------------------------- Render ------------------------------ */
    draw(ctx, w, h) {
      this._layoutDemoHud(w, h);
      ctx.fillStyle = '#0a0c0f';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      this.cam.apply(ctx);
      this._drawWorld(ctx);
      this._drawGround(ctx);
      this._drawAttackRange(ctx);
      this._drawCoinFlights(ctx);
      this._drawPortals(ctx);
      this._drawExtracts(ctx);
      this._drawEnemies(ctx);
      this._drawPlayer(ctx);
      this._drawBullets(ctx);
      this.particles.draw(ctx);
      this._drawFloats(ctx);
      ctx.restore();

      this._drawHUD(ctx, w, h);
    },

    _drawWorld(ctx) {
      const map = this.map, T = map.tile, cam = this.cam;
      const hw = this.screenW / (2 * cam.zoom), hh = this.screenH / (2 * cam.zoom);
      // static world: one blit from the pre-rendered cache (browser clips to view)
      if (this._world) {
        ctx.drawImage(this._world, 0, 0);
      } else {
        // fallback: per-frame tile draw (cache unavailable)
        const minX = Math.max(0, Math.floor((cam.x - hw) / T) - 1);
        const maxX = Math.min(map.w - 1, Math.ceil((cam.x + hw) / T) + 1);
        const minY = Math.max(0, Math.floor((cam.y - hh) / T) - 1);
        const maxY = Math.min(map.h - 1, Math.ceil((cam.y + hh) / T) + 1);
        for (let ty = minY; ty <= maxY; ty++) {
          for (let tx = minX; tx <= maxX; tx++) {
            const i = ty * map.w + tx, px = tx * T, py = ty * T;
            if (map.grid[i] === 1) {
              ctx.fillStyle = '#15171b'; ctx.fillRect(px, py, T, T);
              ctx.fillStyle = '#23262d'; ctx.fillRect(px, py, T, 4);
              ctx.fillStyle = '#0e0f12'; ctx.fillRect(px, py + T - 3, T, 3);
            } else { ctx.fillStyle = shadeColor(map.color, map.shade[i]); ctx.fillRect(px, py, T, T); }
          }
        }
      }

      // containers (dynamic — searched state changes)
      for (const c of this.map.containers) {
        if (c.x < cam.x - hw - T || c.x > cam.x + hw + T || c.y < cam.y - hh - T || c.y > cam.y + hh + T) continue;
        G.Sprites.container(ctx, c);
        if (this.demo && !c.searched && c.items.length) this._drawResourceHint(ctx, c);
      }
    },

    _drawResourceHint(ctx, c) {
      const bob = Math.sin(this.time * 3.2 + c.x * 0.02) * 3;
      const x = c.x, y = c.y - 30 + bob;
      ctx.save();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#ffe28a';
      ctx.fillStyle = 'rgba(20,14,4,0.72)';
      ctx.beginPath(); ctx.arc(x - 2, y - 2, 7, 0, U.TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + 12, y + 12); ctx.stroke();
      ctx.fillStyle = '#fff2b8';
      ctx.beginPath(); ctx.arc(x - 4, y - 4, 2.2, 0, U.TAU); ctx.fill();
      ctx.restore();
    },

    _drawBagIcon(ctx, x, y, s, color) {
      ctx.save();
      ctx.strokeStyle = color || '#e8e8e8';
      ctx.lineWidth = Math.max(1.5, s * 0.12);
      ctx.lineJoin = 'round';
      ctx.strokeRect(x - s * 0.42, y - s * 0.18, s * 0.84, s * 0.58);
      ctx.beginPath();
      ctx.arc(x, y - s * 0.18, s * 0.22, Math.PI, 0);
      ctx.stroke();
      ctx.restore();
    },

    _groundQualityBeamColor(g) {
      const d = G.getItem(g.id);
      if (!d || (d.rarity !== 'rare' && d.rarity !== 'epic')) return null;
      return G.RARITY_COLOR[d.rarity] || null;
    },

    _drawGround(ctx) {
      for (const g of this.groundItems) {
        if (g.delay > 0) continue;
        const d = G.getItem(g.id);
        const bob = Math.sin(this.time * 4 + (g.bob || 0)) * 2;
        const s = 17 + (g.pop > 0 ? g.pop * 20 : 0);
        const beam = this._groundQualityBeamColor(g);
        if (beam) {
          const grad = ctx.createLinearGradient(g.x, g.y - 92, g.x, g.y + 8);
          grad.addColorStop(0, beam + '00');
          grad.addColorStop(0.45, beam + '66');
          grad.addColorStop(1, beam + '18');
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(g.x - 9, g.y + 7);
          ctx.lineTo(g.x - 4, g.y - 92);
          ctx.lineTo(g.x + 4, g.y - 92);
          ctx.lineTo(g.x + 9, g.y + 7);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          ctx.shadowColor = beam; ctx.shadowBlur = 10;
        }
        G.Sprites.groundItem(ctx, d, g.x, g.y + bob, s);
        ctx.shadowBlur = 0;
      }
    },

    spawnCoinFlight(x0, y0, x1, y1) {
      const cfg = G.DemoConfig || {};
      this.coinFlights.push({
        x0, y0, x1, y1,
        t: 0,
        total: cfg.coinPortalFlyTime || 0.42,
        wobble: Math.random() * U.TAU,
      });
    },

    _updateCoinFlights(dt) {
      for (let i = this.coinFlights.length - 1; i >= 0; i--) {
        const c = this.coinFlights[i];
        c.t += dt;
        if (c.t >= c.total) this.coinFlights.splice(i, 1);
      }
    },

    _drawCoinFlights(ctx) {
      if (!this.coinFlights.length) return;
      ctx.save();
      for (const c of this.coinFlights) {
        const u = U.clamp(c.t / c.total, 0, 1);
        const ease = 1 - Math.pow(1 - u, 3);
        const arc = Math.sin(u * Math.PI) * 22;
        const wob = Math.sin(c.wobble + u * Math.PI * 3) * 4 * (1 - u);
        const x = c.x0 + (c.x1 - c.x0) * ease + wob;
        const y = c.y0 + (c.y1 - c.y0) * ease - arc;
        const tx = c.x0 + (x - c.x0) * 0.72;
        const ty = c.y0 + (y - c.y0) * 0.72;
        ctx.globalAlpha = 0.35 + 0.65 * (1 - u * 0.35);
        ctx.strokeStyle = 'rgba(240,196,74,0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = '#f0c44a';
        ctx.beginPath(); ctx.arc(x, y, 5, 0, U.TAU); ctx.fill();
        ctx.strokeStyle = '#fff0a8';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 5.5, 0, U.TAU); ctx.stroke();
        ctx.fillStyle = '#7a5400';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', x, y + 0.5);
      }
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
    },

    // Dashed ring at the equipped weapon's effective range — shows how far your
    // shots reach. Faint so it never competes with the action.
    _drawAttackRange(ctx) {
      const p = this.player;
      const wdef = p.weaponDef();
      if (!wdef || !wdef.range) return;
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.setLineDash([7, 9]);
      ctx.lineDashOffset = -this.time * 22;
      ctx.strokeStyle = 'rgba(255,225,140,0.13)';
      ctx.beginPath(); ctx.arc(p.x, p.y, wdef.range, 0, U.TAU); ctx.stroke();
      // a brighter forward arc centred on the aim so the reach reads at a glance
      ctx.strokeStyle = 'rgba(255,210,90,0.30)';
      ctx.beginPath(); ctx.arc(p.x, p.y, wdef.range, p.angle - 0.5, p.angle + 0.5); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    },

    _drawPortals(ctx) {
      if (!this.map.portals || !this.map.portals.length) return;
      const current = this.demo && this.dungeon ? this.dungeon.currentRoomId : null;
      for (const p of this.map.portals) {
        const visible = !current || p.fromRoomId === current;
        const roomOpen = !current || p.fromRoomId !== current || this._roomPortalsOpen(current);
        const paid = !p.cost || p.paid >= p.cost;
        const goldDoor = p.kind === 'gold';
        const col = !roomOpen ? '#ff7b5a' : goldDoor && !paid ? '#f0c44a' : '#66c7ff';
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 4 + p.x * 0.01);
        ctx.save();
        ctx.globalAlpha = visible ? 1 : 0.18;
        ctx.fillStyle = !roomOpen ? 'rgba(255,90,70,0.18)' : goldDoor && !paid ? 'rgba(240,196,74,0.18)' : 'rgba(86,180,255,' + (0.16 + pulse * 0.10).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 10 + pulse * 3, 0, U.TAU); ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -this.time * 26;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 6, 0, U.TAU); ctx.stroke();
        ctx.setLineDash([]);
        this._drawPortalRequirement(ctx, p, { roomOpen, paid, goldDoor, col });
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
      }
    },

    _drawPortalRequirement(ctx, p, state) {
      const col = state.col;
      const icon = !state.roomOpen ? 'X' : state.goldDoor && !state.paid ? '$' : '>';
      ctx.fillStyle = col;
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, p.x, p.y);

      const y = p.y - p.r - 20;
      if (state.goldDoor && !state.paid) {
        const text = p.paid + '/' + p.cost;
        ctx.font = 'bold 10px monospace';
        const bw = Math.max(46, ctx.measureText(text).width + 26);
        ctx.fillStyle = 'rgba(20,14,4,0.82)';
        ctx.strokeStyle = 'rgba(240,196,74,0.75)';
        ctx.lineWidth = 1.5;
        ctx.fillRect(p.x - bw / 2, y - 10, bw, 20);
        ctx.strokeRect(p.x - bw / 2, y - 10, bw, 20);
        ctx.fillStyle = '#f0c44a';
        ctx.beginPath(); ctx.arc(p.x - bw / 2 + 12, y, 5, 0, U.TAU); ctx.fill();
        ctx.fillStyle = '#5a3a00';
        ctx.font = 'bold 7px monospace';
        ctx.fillText('$', p.x - bw / 2 + 12, y + 0.5);
        ctx.fillStyle = '#ffe9a0';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(text, p.x + 8, y);
        return;
      }

      ctx.font = 'bold 10px monospace';
      const label = !state.roomOpen ? G.t('raid.portal.locked') : G.t('raid.portal.normal');
      ctx.fillText(label, p.x, y);
    },

    _drawExtracts(ctx) {
      for (const z of this.map.extracts) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
        const active = this.extracting && this.extracting.zone === z;
        ctx.save();
        ctx.globalAlpha = 0.25 + pulse * 0.2;
        ctx.fillStyle = active ? '#5ad06a' : '#3aa14a';
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, U.TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = active ? '#9affb0' : '#5ad06a';
        ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -this.time * 30;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, U.TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#cffcd6'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
        ctx.fillText('▲ ' + G.I18n.extractName(z.name), z.x, z.y - z.r - 8);
        ctx.restore();
      }
    },

    _drawEnemies(ctx) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        // vision hint when in combat
        if (e.state === 'combat' || e.state === 'alert') {
          ctx.fillStyle = e.state === 'combat' ? 'rgba(214,60,60,0.10)' : 'rgba(214,180,60,0.07)';
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.arc(e.x, e.y, 150, e.angle - C.VISION_FOV, e.angle + C.VISION_FOV);
          ctx.closePath(); ctx.fill();
        }
        // creature body (procedural). Sprites owns the per-tier visual scale;
        // ask it where the sprite's top is so overlays clear ears/horns/plates.
        this._drawEnemyRoleWarning(ctx, e);
        G.Sprites.enemy(ctx, e);
        const top = G.Sprites.enemyTop(e);
        // hp bar if hurt
        if (e.hp < e.maxHp) {
          const wb = 28;
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(e.x - wb / 2, top, wb, 4);
          ctx.fillStyle = '#d63b3b'; ctx.fillRect(e.x - wb / 2, top, wb * (e.hp / e.maxHp), 4);
        }
        // state icon
        if (e.state === 'alert' || e.state === 'search') {
          ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
          ctx.fillText('?', e.x, top - 6);
        } else if (e.state === 'combat') {
          ctx.fillStyle = '#ff5a5a'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
          ctx.fillText('!', e.x, top - 6);
        }
      }
    },

    _drawPlayer(ctx) {
      const p = this.player;
      // Clawd — top-down mascot body
      let armorFrac = 1;
      if (p.armor && p.armor.durability > 0) { const ad = G.getItem(p.armor.id); armorFrac = ad ? p.armor.durability / ad.durability : 1; }
      G.Sprites.player(ctx, p.x, p.y, p.r, p.angle, {
        hurt: p.hurtFlash,
        armor: !!(p.armor && p.armor.durability > 0),
        armorFrac,
        glow: !!this.extracting,
      });
      this._drawPlayerHealthBar(ctx, p);
      // search/heal/reload progress ring (drawn on top so it stays readable)
      const act = p.searching || p.healing || p.reloading;
      if (act) {
        const frac = act.t / act.total;
        ctx.strokeStyle = p.healing ? '#5ad06a' : p.searching ? '#ffd24a' : '#5aa0ff';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 13, -Math.PI / 2, -Math.PI / 2 + U.TAU * frac); ctx.stroke();
      }
    },

    _drawEnemyRoleWarning(ctx, e) {
      const action = e.roleAction;
      if (!action) return;
      ctx.save();
      if (action.type === 'rusher' && action.phase === 'windup') {
        const frac = U.clamp(action.t / action.total, 0, 1);
        ctx.strokeStyle = '#ffb35a';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -this.time * 28;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 9 + frac * 12, 0, U.TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,120,70,0.20)';
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.arc(e.x, e.y, 92, action.angle - 0.17, action.angle + 0.17); ctx.closePath(); ctx.fill();
      } else if (action.type === 'aim') {
        const frac = U.clamp(action.t / action.total, 0, 1);
        ctx.globalAlpha = 0.30 + frac * 0.60;
        ctx.strokeStyle = '#ff5a5a';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -this.time * 36;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(action.tx, action.ty); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(action.tx, action.ty, 10 + frac * 8, 0, U.TAU); ctx.stroke();
      }
      ctx.restore();
    },

    _drawPlayerHealthBar(ctx, p) {
      if (!p || !p.maxHp) return;
      const frac = U.clamp(p.hp / p.maxHp, 0, 1);
      const bw = 38, bh = 5;
      const x = p.x - bw / 2;
      const y = p.y - p.r - 24;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(x - 1, y - 1, bw + 2, bh + 2);
      ctx.fillStyle = frac > 0.5 ? '#3fbf5a' : frac > 0.25 ? '#d6a23b' : '#d63b3b';
      ctx.fillRect(x, y, bw * frac, bh);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1, y - 1, bw + 2, bh + 2);
      ctx.restore();
    },

    _drawBullets(ctx) {
      if (!this.bullets.length) return;
      // group by color so shadow/stroke state is set at most once per color
      const byColor = this._bulletGroups || (this._bulletGroups = new Map());
      byColor.clear();
      for (const b of this.bullets) { let a = byColor.get(b.color); if (!a) byColor.set(b.color, a = []); a.push(b); }
      ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      byColor.forEach((arr, color) => {
        ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 6;
        ctx.beginPath();
        for (const b of arr) {
          const tx = b.x - b.vx * 0.012, ty = b.y - b.vy * 0.012;
          ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      });
      ctx.shadowBlur = 0; ctx.lineCap = 'butt';
    },

    _drawFloats(ctx) {
      ctx.textAlign = 'center';
      for (const f of this.floats) {
        ctx.globalAlpha = U.clamp(f.t, 0, 1);
        ctx.font = 'bold 13px monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(f.text, f.x + 1, f.y + 1);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
    },

    _demoMinimapGeom(w) {
      const S = G.safe;
      const size = Input.touchEnabled ? 104 : 150;
      return {
        size,
        x: w - size - 14 - S.r,
        y: Input.touchEnabled ? (this._invBottom || 60) + 12 : S.t + 14,
      };
    },

    _drawDemoThreatHud(ctx, w) {
      if (!this.demo || !this.dungeon) return;
      const d = this.dungeon;
      const cfg = G.DemoConfig || {};
      const S = G.safe;
      const maxLevel = cfg.monsterLevelMax || 6;
      const interval = this._monsterLevelInterval();
      const capped = d.monsterLevel >= maxLevel;
      const progress = capped ? 1 : U.clamp(d.monsterLevelTimer / interval, 0, 1);
      const bw = Math.min(300, Math.max(220, w * 0.32));
      const bh = 8;
      const x = Math.round((w - bw) / 2);
      const y = 14 + S.t;
      const accent = d.enraged ? '#ff6d5f' : '#c36a55';
      const fill = d.enraged ? '#e45847' : '#d2a55a';
      const remain = Math.max(0, Math.ceil(interval - d.monsterLevelTimer));

      ctx.save();
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = 'bold 11px monospace'; ctx.fillStyle = accent;
      ctx.fillText(G.t('raid.hud.monsterLevel', { n: d.monsterLevel }), x, y + 10);
      ctx.textAlign = 'right'; ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillText(capped ? G.t('raid.hud.threatMax') : G.t('raid.hud.threatNext', { n: d.monsterLevel + 1, s: remain }), x + bw, y + 10);
      ctx.fillStyle = 'rgba(0,0,0,0.58)'; ctx.fillRect(x, y + 16, bw, bh);
      ctx.fillStyle = fill; ctx.fillRect(x, y + 16, bw * progress, bh);
      ctx.strokeStyle = d.enraged ? '#ffb09e' : 'rgba(255,235,180,0.8)'; ctx.lineWidth = 1;
      ctx.strokeRect(x, y + 16, bw, bh);
      ctx.restore();
    },

    _drawCurseIcon(ctx, id, x, y, size, active) {
      const palette = {
        greedy_hand: '#d4b45a', blood_tax: '#c85a5a', heavy_march: '#8b98b0',
        frenzy_guide: '#b46bdb', glass_edge: '#79c8d8', elite_gift: '#e0a958',
      };
      const col = palette[id] || '#d8d8d8';
      const cx = x + size / 2, cy = y + size / 2;
      ctx.save();
      ctx.fillStyle = active ? 'rgba(38,32,24,0.96)' : 'rgba(12,14,18,0.82)';
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = active ? '#fff0b0' : col; ctx.lineWidth = active ? 2 : 1.5;
      ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 2;
      if (id === 'greedy_hand') {
        for (let i = -1; i <= 1; i++) ctx.fillRect(cx + i * 5 - 1.5, cy - 8, 3, 12);
        ctx.fillRect(cx - 7, cy + 2, 14, 5);
      } else if (id === 'blood_tax') {
        ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.quadraticCurveTo(cx - 9, cy + 1, cx, cy + 9); ctx.quadraticCurveTo(cx + 9, cy + 1, cx, cy - 10); ctx.fill();
      } else if (id === 'heavy_march') {
        ctx.fillRect(cx - 7, cy - 5, 9, 10); ctx.fillRect(cx - 8, cy + 4, 16, 5);
      } else if (id === 'frenzy_guide') {
        for (let i = 0; i < 3; i++) { const yy = cy - 7 + i * 7; ctx.beginPath(); ctx.moveTo(cx - 9, yy); ctx.lineTo(cx - 2, yy - 3); ctx.lineTo(cx + 8, yy + 2); ctx.stroke(); }
      } else if (id === 'glass_edge') {
        ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx + 9, cy); ctx.lineTo(cx, cy + 10); ctx.lineTo(cx - 9, cy); ctx.closePath(); ctx.stroke();
      } else if (id === 'elite_gift') {
        ctx.beginPath(); ctx.moveTo(cx - 9, cy + 7); ctx.lineTo(cx - 8, cy - 6); ctx.lineTo(cx - 2, cy); ctx.lineTo(cx + 2, cy - 8); ctx.lineTo(cx + 8, cy - 6); ctx.lineTo(cx + 9, cy + 7); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    },

    _drawDemoCurses(ctx, w) {
      if (!this.demo || !this.dungeon || !this._curseHudButtons.length) return;
      const hover = !Input.touchEnabled && this._curseHudButtons.find(b => pointInRect(Input.mouse.x, Input.mouse.y, b));
      const tooltipId = (hover && hover.id) || this._curseTooltipId;
      for (const b of this._curseHudButtons) this._drawCurseIcon(ctx, b.id, b.x, b.y, b.w, b.id === tooltipId);
      if (!tooltipId) return;
      const curse = (G.DemoCurses || []).find(c => c.id === tooltipId);
      const anchor = this._curseHudButtons.find(b => b.id === tooltipId);
      if (!curse || !anchor) return;
      const title = G.t('curse.' + tooltipId + '.name');
      const desc = G.t('curse.' + tooltipId + '.desc');
      const reward = G.t('ui.curse.reward', { pct: Math.round((curse.rewardBonus || 0) * 100) });
      const bw = Math.min(330, w - 28);
      const lines = wrapHudText(ctx, desc, bw - 22);
      const bh = 42 + lines.length * 14;
      const x = Math.round((w - bw) / 2);
      const y = anchor.y + anchor.h + 8;
      ctx.save();
      ctx.fillStyle = 'rgba(8,10,14,0.94)'; ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = '#d4b45a'; ctx.lineWidth = 1; ctx.strokeRect(x, y, bw, bh);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#ffe1a8'; ctx.fillText(title, x + 11, y + 16);
      ctx.font = '10px monospace'; ctx.fillStyle = '#d7dde4';
      lines.forEach((line, i) => ctx.fillText(line, x + 11, y + 31 + i * 14));
      ctx.fillStyle = '#8fe0a0'; ctx.fillText(reward, x + 11, y + bh - 9);
      ctx.restore();
    },

    /* ------------------------------ HUD -------------------------------- */
    _drawHUD(ctx, w, h) {
      const p = this.player;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

      // low-hp vignette
      const hpFrac = p.hp / p.maxHp;
      if (hpFrac < 0.4) {
        const a = (0.4 - hpFrac) / 0.4 * 0.5 * (0.7 + 0.3 * Math.sin(this.time * 6));
        const grd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
        grd.addColorStop(0, 'rgba(180,0,0,0)'); grd.addColorStop(1, 'rgba(180,0,0,' + a.toFixed(3) + ')');
        ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
      }

      const S = G.safe;
      // ---- top bars (HP / armor / stamina) ----
      const bx = 14 + S.l, bw = Math.min(240, w * 0.32);
      let by = 14 + S.t;
      // HP
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx, by, bw, 16);
      ctx.fillStyle = hpFrac > 0.5 ? '#3fbf5a' : hpFrac > 0.25 ? '#d6a23b' : '#d63b3b';
      ctx.fillRect(bx, by, bw * hpFrac, 16);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, 16);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px monospace';
      ctx.fillText(G.t('raid.hud.hp', { n: Math.ceil(p.hp) }), bx + 6, by + 12);
      by += 20;
      // armor
      if (p.armor) {
        const ad = G.getItem(p.armor.id); const af = p.armor.durability / ad.durability;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx, by, bw, 10);
        ctx.fillStyle = '#5a9fd6'; ctx.fillRect(bx, by, bw * af, 10);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.strokeRect(bx, by, bw, 10);
        ctx.fillStyle = '#cfe6ff'; ctx.font = '9px monospace'; ctx.fillText(G.t('raid.hud.armor'), bx + 5, by + 8);
        by += 14;
      }
      // stamina
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx, by, bw, 6);
      ctx.fillStyle = '#d8d24a'; ctx.fillRect(bx, by, bw * (p.stamina / C.STAMINA_MAX), 6);
      by += 14;

      this._drawDemoThreatHud(ctx, w);
      this._drawDemoCurses(ctx, w);

      // Regular raids retain their deadline. Demo pacing is a settlement reference,
      // so it neither forces an MIA result nor displays a countdown during play.
      if (!this.demo) {
        const mm = Math.floor(Math.max(0, this.timeLeft) / 60), ss = Math.floor(Math.max(0, this.timeLeft) % 60);
        const tstr = mm + ':' + (ss < 10 ? '0' : '') + ss;
        ctx.textAlign = 'center'; ctx.font = 'bold 22px monospace';
        ctx.fillStyle = this.timeLeft < 30 ? '#ff5a5a' : 'rgba(255,255,255,0.9)';
        ctx.fillText(tstr, w / 2, 30 + S.t);
        ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(G.I18n.locName(this.location).toUpperCase(), w / 2, 44 + S.t);
      }

      // ---- top right: kills / value (stacked below the BAG button on touch) ----
      ctx.textAlign = 'right'; ctx.font = 'bold 13px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const rightX = w - 14 - S.r;
      const mini = this.demo ? this._demoMinimapGeom(w) : null;
      const topY = this.demo ? mini.y + mini.size + 18 : (Input.touchEnabled ? (this._invBottom || 60) + 16 : 18 + S.t);
      ctx.fillText('☠ ' + this.kills, rightX, topY);
      ctx.fillStyle = '#f0c44a';
      ctx.fillText('₵ ' + U.formatNum(p.lootValue()), rightX, topY + 18);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '11px monospace';
      ctx.fillText(G.t('raid.hud.bag', { n: p.backpackCount(), max: p.backpackLimit ? p.backpackLimit() : C.BACKPACK_SLOTS }), rightX, topY + 34);
      if (!Input.touchEnabled && this._desktopInvButton) {
        const b = this._desktopInvButton;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = '#e8e8e8';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        this._drawBagIcon(ctx, b.x + 17, b.y + 15, 14, '#e8e8e8');
        ctx.fillText('BAG [Tab]', b.x + 62, b.y + 18);
        ctx.textAlign = 'right';
      }
      if (this.demo && this.dungeon) {
        ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#f0c44a';
        ctx.fillText(G.t('raid.hud.gold', { n: this.dungeon.gold || 0 }), rightX, topY + 52);
        ctx.font = '11px monospace'; ctx.fillStyle = this._canNormalExtract() ? '#8fd6ff' : 'rgba(255,255,255,0.68)';
        ctx.fillText(G.t('raid.hud.scrolls', this._scrollParams()), rightX, topY + 68);
        ctx.fillStyle = '#f0c44a';
        ctx.fillText(G.t('raid.hud.rewardMultiplier', { mul: this.dungeon.rewardMultiplier.toFixed(2) }), rightX, topY + 84);
      }

      // ---- weapon panel + carried-item quick bar (bottom center-left) ----
      this._drawWeaponPanel(ctx, w, h);
      this._drawQuickbar(ctx, w, h);

      // ---- minimap (top right under stats / or top-left on mobile) ----
      this._drawMinimap(ctx, w, h);

      // ---- context prompt ----
      const cont = this._nearestCont;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = 'bold 13px monospace';
      const roomWarning = this._currentRoomWarning();
      if (roomWarning) {
        const n = Math.max(1, Math.ceil(roomWarning.t));
        const text = G.t(roomWarning.kind === 'revive' ? 'raid.hud.reviveCountdown' : 'raid.hud.waveCountdown', { n });
        ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(w / 2 - 150, h * 0.34, 300, 44);
        ctx.strokeStyle = roomWarning.kind === 'revive' ? '#f0c44a' : '#ff7b5a';
        ctx.strokeRect(w / 2 - 150, h * 0.34, 300, 44);
        ctx.fillStyle = roomWarning.kind === 'revive' ? '#ffe08a' : '#ffb0a0';
        ctx.font = 'bold 17px monospace';
        ctx.fillText(text, w / 2, h * 0.34 + 28);
      }
      if (this.extracting) {
        const total = this._extractDuration();
        const frac = this.extracting.t / total;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(w / 2 - 110, h * 0.7, 220, 30);
        ctx.fillStyle = '#3aa14a'; ctx.fillRect(w / 2 - 110, h * 0.7, 220 * frac, 30);
        ctx.strokeStyle = '#9affb0'; ctx.strokeRect(w / 2 - 110, h * 0.7, 220, 30);
        const prompt = this.demo && this.dungeon && this.dungeon.extractionChallenge
          ? (this.extracting.phase === 'arming'
            ? G.t('raid.prompt.perfectExtractArming', { n: Math.ceil(Math.max(0, total - this.extracting.t)) })
            : G.t('raid.prompt.perfectExtracting', { n: Math.ceil(Math.max(0, total - this.extracting.t)) }))
          : G.t('raid.prompt.extracting');
        ctx.fillStyle = '#fff'; ctx.fillText(prompt, w / 2, h * 0.7 + 20);
      } else if (p.searching) {
        // in-progress search bar
        const frac = p.searching.t / p.searching.total;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(w / 2 - 110, h * 0.78, 220, 26);
        ctx.fillStyle = '#ffd24a'; ctx.fillRect(w / 2 - 110, h * 0.78, 220 * frac, 26);
        ctx.strokeStyle = '#ffe9a8'; ctx.strokeRect(w / 2 - 110, h * 0.78, 220, 26);
        ctx.fillStyle = '#1a1206'; ctx.fillText(G.t('raid.prompt.searching'), w / 2, h * 0.78 + 18);
      } else if (cont && !cont.searched && cont.items.length) {
        const label = G.I18n.containerLabel(cont.type);
        const key = Input.touchEnabled ? G.t('raid.prompt.tapKey.touch') : G.t('raid.prompt.tapKey.desktop');
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(w / 2 - 130, h * 0.78, 260, 26);
        ctx.fillStyle = '#ffd24a';
        ctx.fillText(G.t('raid.prompt.loot', { key: key, label: label }), w / 2, h * 0.78 + 18);
      } else if (this.demo && this._canNormalExtract()) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(w / 2 - 150, h * 0.78, 300, 26);
        ctx.fillStyle = '#8fd6ff';
        ctx.fillText(G.t('raid.prompt.normalExtract'), w / 2, h * 0.78 + 18);
      }

      // ---- extract direction arrow ----
      this._drawExtractArrow(ctx, w, h);

      if (this.demo && this.dungeon && this.dungeon.debugVisible) {
        this._drawDemoDebugPanel(ctx, w, h);
      }

      // ---- toasts ----
      ctx.textAlign = 'center'; ctx.font = '12px monospace';
      for (let i = 0; i < this.toasts.length; i++) {
        const t = this.toasts[i];
        ctx.globalAlpha = U.clamp(t.t, 0, 1);
        const ty = h * 0.6 - i * 20;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        const tw = ctx.measureText(t.msg).width + 16;
        ctx.fillRect(w / 2 - tw / 2, ty - 13, tw, 18);
        ctx.fillStyle = '#e8e8e8';
        ctx.fillText(t.msg, w / 2, ty);
      }
      ctx.globalAlpha = 1;

      // ---- controls help (auto-fades early in the raid) ----
      this._drawHelp(ctx, w, h);

      // ---- mobile controls ----
      if (Input.touchEnabled) this._drawTouchControls(ctx, w, h);

      // crosshair (desktop) — a crisp reticle (four gapped ticks + thin ring +
      // dot) tinted by attack range: green within the weapon's reach, amber
      // beyond. A dark backing keeps it readable over any tile.
      if (!Input.touchEnabled) {
        const m = Input.mouse;
        const wdef = p.weaponDef();
        const wpt = this.cam.screenToWorld(m.x, m.y);
        const inRange = wdef ? U.dist(p.x, p.y, wpt.x, wpt.y) <= wdef.range : true;
        const col = !wdef ? 'rgba(236,240,245,0.95)' : inRange ? 'rgba(120,230,150,0.95)' : 'rgba(255,150,90,0.95)';
        ctx.save();
        ctx.lineCap = 'round';
        reticlePath(ctx, m.x, m.y, 4, 8, 11);
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3.5; ctx.stroke();
        reticlePath(ctx, m.x, m.y, 4, 8, 11);
        ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(m.x, m.y, 1.6, 0, U.TAU); ctx.fill();
        ctx.restore();
      }
    },

    _currentRoomWarning() {
      if (!this.demo || !this.dungeon) return null;
      const room = this._roomAt(this.player.x, this.player.y);
      if (!room) return null;
      const st = this._roomState(room.id);
      return st.waveWarning || null;
    },

    _drawDemoDebugPanel(ctx, w, h) {
      const S = G.safe;
      const x = 14 + S.l;
      // Keep the diagnostic overlay above the bottom-left quick-slot and weapon HUD.
      const y = Math.max(14 + S.t, h - 216 - S.b);
      const bw = Math.min(390, w - 28 - S.l - S.r), bh = 96;
      const cfg = G.DemoConfig || {};
      const minM = Math.round((cfg.targetRunMinTime || 300) / 60);
      const maxM = Math.round((cfg.targetRunMaxTime || 480) / 60);
      const pace = this._demoPaceCheck(this.time);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.68)';
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = 'rgba(240,196,74,0.35)';
      ctx.strokeRect(x, y, bw, bh);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#f0c44a';
      ctx.fillText(G.t('raid.debug.title'), x + 10, y + 17);
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.fillText(G.t('raid.debug.line1'), x + 10, y + 36);
      ctx.fillText(G.t('raid.debug.line2'), x + 10, y + 52);
      ctx.fillText(G.t('raid.debug.line3'), x + 10, y + 68);
      ctx.fillStyle = pace && pace.paceTag === 'target' ? '#9affb0' : '#ffe08a';
      ctx.fillText(G.t('raid.debug.pace', { time: this._demoClock(this.time), min: minM, max: maxM }), x + 10, y + 86);
      ctx.restore();
    },

    // Shared geometry for the bottom-left weapon panel — the quick-slot bar
    // stacks directly above it using the same x/width.
    _panelGeom(w, h) {
      const S = G.safe;
      const panelW = Math.min(220, w * 0.5), panelH = 44;
      const panelX = 14 + S.l;
      // sit above the bottom-centre action row on touch so they never overlap
      const panelY = (Input.touchEnabled && this._actionRowY ? this._actionRowY - panelH - 8 : h - 58 - S.b);
      return { panelX, panelY, panelW, panelH };
    },

    // Four quick-slot tiles (1 primary · 2 secondary · 3 armor · 4 heal) — the
    // carried-item bar. Desktop drives it with number keys; touch uses SWAP/HEAL
    // and the BAG (tap armor to equip). Returns the tile rects.
    _quickbarGeom(w, h) {
      const g = this._panelGeom(w, h);
      const qh = 30, gap = 4;
      const tw = (g.panelW - gap * 3) / 4;
      const qy = g.panelY - qh - 6;
      const rects = [];
      for (let i = 0; i < 4; i++) rects.push({ x: g.panelX + i * (tw + gap), y: qy, w: tw, h: qh });
      return rects;
    },

    _drawQuickbar(ctx, w, h) {
      const p = this.player;
      const r = this._quickbarGeom(w, h);
      // representative med (smallest icon) + total med count for slot 4
      let medId = null, medN = 0;
      for (const s of p.backpack) { if (G.getItem(s.id).type === 'med') { medN += s.n; if (!medId) medId = s.id; } }
      const armorId = (p.armor && p.armor.durability > 0) ? p.armor.id : null;
      const slots = [
        { id: p.weapons[0] ? p.weapons[0].id : null, key: '1', active: p.slot === 0, cat: 'raid.quick.cat.primary' },
        { id: p.weapons[1] ? p.weapons[1].id : null, key: '2', active: p.slot === 1, cat: 'raid.quick.cat.secondary' },
        { id: armorId, key: '3', cat: 'raid.quick.cat.armor' },
        { id: medId, n: medN, key: '4', cat: 'raid.quick.cat.heal' },
      ];
      for (let i = 0; i < 4; i++) {
        const s = slots[i], b = r[i];
        ctx.fillStyle = s.active ? 'rgba(38,52,48,0.85)' : 'rgba(0,0,0,0.5)';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = s.active ? '#39e0c0' : 'rgba(255,255,255,0.18)';
        ctx.lineWidth = s.active ? 2 : 1; ctx.strokeRect(b.x, b.y, b.w, b.h);
        if (s.id) {
          const def = G.getItem(s.id);
          const ic = Math.min(b.h * 0.78, b.w * 0.6);
          G.Sprites.groundItem(ctx, def, b.x + b.w * 0.5, b.y + b.h * 0.5 + 1, ic);
          if (s.n > 1) {
            ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
            ctx.fillText('x' + s.n, b.x + b.w - 3, b.y + b.h - 3);
          }
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '8px monospace';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(G.t(s.cat), b.x + b.w / 2, b.y + b.h / 2 + 2);
          ctx.textBaseline = 'alphabetic';
        }
        // key number badge (top-left)
        ctx.fillStyle = s.active ? '#39e0c0' : 'rgba(255,255,255,0.55)';
        ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(s.key, b.x + 3, b.y + 10);
      }
    },

    _drawWeaponPanel(ctx, w, h) {
      const p = this.player;
      const wdef = p.weaponDef();
      const g = this._panelGeom(w, h);
      const panelX = g.panelX, panelY = g.panelY, panelW = g.panelW, panelH = g.panelH;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(panelX, panelY, panelW, panelH);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.strokeRect(panelX, panelY, panelW, panelH);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      if (wdef) {
        const w0 = p.weapons[p.slot];
        ctx.fillStyle = G.RARITY_COLOR[wdef.rarity] || '#fff'; ctx.font = 'bold 13px monospace';
        ctx.fillText(G.I18n.itemName(w0.id), panelX + 10, panelY + 18);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 18px monospace';
        if (this.demo) {
          ctx.fillText(G.t('raid.weapon.demoAuto'), panelX + 10, panelY + 38);
        } else {
          const reserve = p.reserve[wdef.ammoType] || 0;
          ctx.fillText(w0.mag + ' / ' + reserve, panelX + 10, panelY + 38);
        }
        // reload progress
        if (p.reloading) {
          const frac = p.reloading.t / p.reloading.total;
          ctx.fillStyle = '#5aa0ff'; ctx.fillRect(panelX, panelY + panelH - 3, panelW * frac, 3);
        }
        // slot indicator
        ctx.textAlign = 'right'; ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('[' + (p.slot + 1) + ']', panelX + panelW - 8, panelY + 16);
      } else {
        ctx.fillStyle = '#999'; ctx.font = '13px monospace';
        ctx.fillText(G.t('raid.weapon.unarmed'), panelX + 10, panelY + 26);
      }
    },

    _drawMinimap(ctx, w, h) {
      const map = this.map;
      const S = G.safe;
      const geom = this.demo ? this._demoMinimapGeom(w) : null;
      const size = geom ? geom.size : (Input.touchEnabled ? 104 : 150);
      const mx = geom ? geom.x : w - size - 14 - S.r;
      const my = geom ? geom.y : (Input.touchEnabled ? (this._invBottom || 60) + 56 : 64 + S.t);
      const sc = size / Math.max(map.pxW, map.pxH);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(mx - 2, my - 2, size + 4, size + 4);
      // explored tiles (cached fog texture, scaled up; nearest-neighbour)
      if (this._mini) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this._mini, mx, my, map.pxW * sc, map.pxH * sc);
        ctx.imageSmoothingEnabled = true;
      }
      // extracts
      for (const z of map.extracts) {
        ctx.fillStyle = '#5ad06a';
        ctx.fillRect(mx + z.x * sc - 2, my + z.y * sc - 2, 4, 4);
      }
      // enemies (only if alert/combat — represents "known" threats)
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (e.state === 'combat' || e.state === 'alert') {
          ctx.fillStyle = '#ff5a5a';
          ctx.fillRect(mx + e.x * sc - 1.5, my + e.y * sc - 1.5, 3, 3);
        }
      }
      // player
      const p = this.player;
      ctx.fillStyle = '#39e0c0';
      ctx.beginPath();
      const pmx = mx + p.x * sc, pmy = my + p.y * sc;
      ctx.moveTo(pmx + Math.cos(p.angle) * 5, pmy + Math.sin(p.angle) * 5);
      ctx.lineTo(pmx + Math.cos(p.angle + 2.5) * 4, pmy + Math.sin(p.angle + 2.5) * 4);
      ctx.lineTo(pmx + Math.cos(p.angle - 2.5) * 4, pmy + Math.sin(p.angle - 2.5) * 4);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.strokeRect(mx, my, size, size);
      ctx.restore();
    },

    _drawExtractArrow(ctx, w, h) {
      const p = this.player;
      let best = null, bd = Infinity;
      for (const z of this.map.extracts) { const d = U.dist2(p.x, p.y, z.x, z.y); if (d < bd) { bd = d; best = z; } }
      if (!best) return;
      const ang = U.angle(p.x, p.y, best.x, best.y);
      const cx = w / 2, cy = h / 2, rad = Math.min(w, h) * 0.34;
      const ax = cx + Math.cos(ang) * rad, ay = cy + Math.sin(ang) * rad;
      ctx.save();
      ctx.translate(ax, ay); ctx.rotate(ang);
      ctx.fillStyle = 'rgba(90,208,106,0.5)';
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
    },

    // Brief operating instructions shown at the top of the screen for the first
    // few seconds of a raid (fades out over the last 2s). Desktop and touch get
    // their own line sets. Helps a new player read the controls without leaving.
    _drawHelp(ctx, w, h) {
      const T = C.HELP_TIME;
      if (this.time >= T) return;
      const fade = this.time > T - 2 ? (T - this.time) / 2 : 1;
      const touch = Input.touchEnabled;
      const lootKey = this.demo ? 'raid.help.demoLoot' : (touch ? 'raid.help.touch.loot' : 'raid.help.loot');
      const lines = touch
        ? [G.t('raid.help.touch.move'), G.t('raid.help.touch.aim'), G.t(lootKey), G.t('raid.help.touch.items'), G.t('raid.help.extract')]
        : [G.t('raid.help.move'), G.t('raid.help.aim'), G.t(lootKey), G.t('raid.help.items'), G.t('raid.help.extract')];
      const title = G.t('raid.help.title');
      ctx.save();
      ctx.globalAlpha = U.clamp(fade, 0, 1);
      ctx.font = '12px monospace';
      let maxw = ctx.measureText(title).width;
      for (const l of lines) maxw = Math.max(maxw, ctx.measureText(l).width);
      const pad = 12, lh = 18;
      const bw = maxw + pad * 2;
      const bh = pad * 2 + 18 + lines.length * lh;
      const bx = w / 2 - bw / 2;
      const by = G.safe.t + (this.demo ? 118 : 54);
      ctx.fillStyle = 'rgba(8,10,14,0.82)'; ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = 'rgba(255,225,140,0.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffe1a8'; ctx.font = 'bold 13px monospace';
      ctx.fillText(title, w / 2, by + pad + 11);
      ctx.fillStyle = '#d7dde4'; ctx.font = '12px monospace';
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], w / 2, by + pad + 18 + 12 + i * lh);
      ctx.restore();
    },

    _drawTouchControls(ctx, w, h) {
      const S = G.safe;
      // faint hint rings show where each thumb belongs when its stick is idle
      const hint = (active, hx, hy, label) => {
        if (active) return;
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(hx, hy, 46, 0, U.TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.font = '10px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, hx, hy); ctx.textBaseline = 'alphabetic';
      };
      const hy = h - S.b - 130;
      hint(Input.leftStick.active, S.l + w * 0.14, hy, G.t('raid.touch.move'));
      hint(Input.rightStick.active, w - S.r - w * 0.14, hy, G.t('raid.touch.aimFire'));
      // sticks
      const drawStick = (s, color) => {
        if (!s.active) return;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(s.ox, s.oy, 70, 0, U.TAU); ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(s.ox + s.dx * s.mag * 70, s.oy + s.dy * s.mag * 70, 28, 0, U.TAU); ctx.fill();
      };
      drawStick(Input.leftStick, 'rgba(57,224,192,0.4)');
      drawStick(Input.rightStick, 'rgba(255,90,90,0.4)');
      // buttons
      const btn = (name, label, col, active) => {
        const b = Input.buttons[name]; if (!b || b.x === undefined) return;
        const lit = b.down || (active && active());
        ctx.fillStyle = lit ? (col || 'rgba(255,255,255,0.35)') : 'rgba(0,0,0,0.4)';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = lit ? '#fff' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5; ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2);
        ctx.textBaseline = 'alphabetic';
      };
      btn('sprint', G.t('raid.btn.sprint'), 'rgba(216,210,74,0.6)', () => this.sprintOn);
      btn('search', G.t('raid.btn.search'), 'rgba(255,210,74,0.5)');
      btn('reload', G.t('raid.btn.reload'), 'rgba(90,160,255,0.5)');
      btn('heal', G.t('raid.btn.heal'), 'rgba(90,208,106,0.5)');
      btn('swap', G.t('raid.btn.swap'), 'rgba(200,200,200,0.4)');
      btn('inv', G.t('raid.btn.bag'), 'rgba(255,255,255,0.3)');
      const ib = Input.buttons.inv;
      if (ib && ib.x !== undefined) this._drawBagIcon(ctx, ib.x + ib.w / 2, ib.y + ib.h * 0.34, Math.min(18, ib.h * 0.6), '#fff');
      btn('pause', '❚❚', 'rgba(255,255,255,0.3)');
    },
  };

  // crosshair reticle path: four gapped ticks (N/E/S/W) + a thin ring, built so
  // it can be stroked twice (dark backing, then colour) without re-listing points.
  function reticlePath(ctx, x, y, gap, len, rad) {
    ctx.beginPath();
    ctx.moveTo(x - gap - len, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + len, y);
    ctx.moveTo(x, y - gap - len); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + len);
    ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, Math.PI * 2);
  }

  // segment vs circle test
  function segCircle(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((cx - x1) * dx + (cy - y1) * dy) / len2;
    t = U.clamp(t, 0, 1);
    const px = x1 + dx * t, py = y1 + dy * t;
    const ddx = cx - px, ddy = cy - py;
    return ddx * ddx + ddy * ddy <= r * r;
  }

  function pointInRect(x, y, r) {
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  function wrapHudText(ctx, text, maxWidth) {
    const lines = [];
    let line = '';
    for (const ch of String(text || '')) {
      const next = line + ch;
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = ch; }
      else line = next;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  // tint a hex color by a small shade index (floor variation)
  const _shadeCache = {};
  function shadeColor(hex, idx) {
    const key = hex + '_' + idx;
    if (_shadeCache[key]) return _shadeCache[key];
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const add = (idx - 1.5) * 7;
    r = U.clamp(r + add + 18, 0, 255); g = U.clamp(g + add + 18, 0, 255); b = U.clamp(b + add + 18, 0, 255);
    const out = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
    _shadeCache[key] = out;
    return out;
  }

  function defaultCurseModifiers() {
    return {
      searchSpeedMultiplier: 1,
      monsterSpawnIntervalMultiplier: 1,
      scrollDropMultiplier: 1,
      healMultiplier: 1,
      backpackSlotsBonus: 0,
      playerSpeedMultiplier: 1,
      highValueDropMultiplier: 1,
      monsterLevelIntervalDelta: 0,
      playerDamageMultiplier: 1,
      playerProjectileBonus: 0,
      playerFireRateMultiplier: 1,
      playerProjectileRangeMultiplier: 1,
      playerTakenDamageMultiplier: 1,
        eliteDropMultiplier: 1,
        eliteSpawnChanceMultiplier: 1,
        roleRusherChanceMultiplier: 1,
        roleMarksmanChanceMultiplier: 1,
    };
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  G.Raid = Raid;

})();

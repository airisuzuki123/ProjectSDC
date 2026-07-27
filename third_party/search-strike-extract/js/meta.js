/* =========================================================================
 * meta.js — Persistence, player profile, stash, economy, loadout.
 * The risk/reward core: gear is removed from stash on raid start, returned on
 * extract, lost on death.
 * ========================================================================= */
(function () {
  'use strict';
  const G = window.G;
  const C = G.Config;
  const U = G.Utils;

  // caliber -> ammo item id
  const AMMO_ITEM = {};
  for (const id in G.Items) {
    const it = G.Items[id];
    if (it.type === 'ammo') AMMO_ITEM[it.ammoType] = id;
  }
  G.AMMO_ITEM = AMMO_ITEM;

  const Save = {
    write(data) {
      try { localStorage.setItem(C.SAVE_KEY, JSON.stringify(data)); return true; }
      catch (e) { return false; }
    },
    read() {
      try { const s = localStorage.getItem(C.SAVE_KEY); return s ? JSON.parse(s) : null; }
      catch (e) { return null; }
    },
    clear() { try { localStorage.removeItem(C.SAVE_KEY); } catch (e) { } },
  };
  G.Save = Save;

  const Profile = {
    data: null,

    fresh() {
      return {
        money: G.STARTING.money,
        stash: G.STARTING.stash.map(s => ({ id: s.id, n: s.n })),
        loadout: { primary: 'w_pistol', secondary: null, armor: null, medId: 'm_bandage', medCount: 3 },
        stats: { raids: 0, survived: 0, died: 0, kills: 0, bestExtract: 0, totalEarned: 0 },
        settings: { sfx: true, volume: 0.6, lang: (G.I18n ? G.I18n.detectDefault() : 'en') },
        // lifetime counters fed by recordRaid(), read by the contract checker
        prog: { surfaces: 0, kills: { scav: 0, raider: 0, boss: 0 }, byLoc: {} },
        // the Conch's questline: stage = index of the active contract; base =
        // the relevant counter snapshotted when that contract opened (so
        // counter-goals measure progress *since* you took the favor).
        contracts: { stage: 0, base: null },
        demoProgress: this._freshDemoProgress(),
        demoEconomy: this._freshDemoEconomy(),
        seenIntro: false,
        version: 1,
      };
    },

    _freshDemoProgress() {
      const progress = {
        highestUnlockedLevel: 1,
        levels: {},
        history: [],
        version: 1,
      };
      for (const level of G.DemoLevels || []) {
        progress.levels[level.id] = {
          unlocked: level.order === 1,
          completed: false,
          normalExtracts: 0,
          perfectExtracts: 0,
          failures: 0,
          abandons: 0,
          attempts: 0,
          bestPerfectTime: null,
        };
      }
      return progress;
    },

    _freshDemoEconomy() {
      return {
        settledRunIds: [],
        assetSettledRunIds: [],
        lastSettlement: null,
        version: 1,
      };
    },

    load() {
      const d = Save.read();
      const valid = d && Array.isArray(d.stash);
      this.data = valid ? d : this.fresh();
      // backfill any missing fields
      const f = this.fresh();
      for (const k in f) if (this.data[k] === undefined) this.data[k] = f[k];
      if (!this.data.stats) this.data.stats = f.stats;
      if (!this.data.settings) this.data.settings = f.settings;
      if (!Number.isFinite(this.data.money)) this.data.money = f.money;
      else this.data.money = Math.max(0, Math.floor(this.data.money));
      // sanitize stash: drop entries with unknown ids or bad counts (corrupt/legacy saves)
      this.data.stash = (Array.isArray(this.data.stash) ? this.data.stash : [])
        .filter(s => s && G.getItem(s.id) && Number.isFinite(s.n) && s.n > 0)
        .map(s => ({ id: s.id, n: s.n | 0 }));
      // sanitize loadout: must be a plain object, then null out any dead item ids
      const ld = (this.data.loadout && typeof this.data.loadout === 'object' && !Array.isArray(this.data.loadout))
        ? this.data.loadout : (this.data.loadout = f.loadout);
      ['primary', 'secondary', 'armor', 'medId'].forEach(k => { if (ld[k] && !G.getItem(ld[k])) ld[k] = (k === 'medId' ? null : null); });
      if (typeof ld.medCount !== 'number') ld.medCount = f.loadout.medCount;
      if (this.data.settings) {
        G.Audio.setEnabled(this.data.settings.sfx !== false);
        G.Audio.setVolume(this.data.settings.volume ?? 0.6);
        if (G.I18n) G.I18n.setLang(this.data.settings.lang || G.I18n.detectDefault());
      }
      // contracts / progress: repair shape on corrupt or legacy saves, then make
      // sure the active contract has a baseline snapshot to measure against.
      this._sanitizeProgress();
      this._sanitizeDemoProgress();
      this._sanitizeDemoEconomy();
      this._syncContractBase();
      return this.data;
    },

    // Force prog / contracts into a well-formed shape (idempotent).
    _sanitizeProgress() {
      const f = this.fresh();
      const p = (this.data.prog && typeof this.data.prog === 'object') ? this.data.prog : (this.data.prog = f.prog);
      if (!p.kills || typeof p.kills !== 'object') p.kills = { scav: 0, raider: 0, boss: 0 };
      ['scav', 'raider', 'boss'].forEach(k => { if (typeof p.kills[k] !== 'number') p.kills[k] = 0; });
      if (typeof p.surfaces !== 'number') p.surfaces = 0;
      if (!p.byLoc || typeof p.byLoc !== 'object') p.byLoc = {};
      const c = (this.data.contracts && typeof this.data.contracts === 'object' && !Array.isArray(this.data.contracts))
        ? this.data.contracts : (this.data.contracts = f.contracts);
      if (typeof c.stage !== 'number' || c.stage < 0) c.stage = 0;
      if (c.stage > G.Contracts.length) c.stage = G.Contracts.length;
    },
    _sanitizeDemoProgress() {
      const fresh = this._freshDemoProgress();
      const raw = (this.data.demoProgress && typeof this.data.demoProgress === 'object' && !Array.isArray(this.data.demoProgress))
        ? this.data.demoProgress : {};
      const maxOrder = (G.DemoLevels || []).length || 1;
      const highest = Number.isFinite(raw.highestUnlockedLevel) ? Math.floor(raw.highestUnlockedLevel) : 1;
      const progress = {
        highestUnlockedLevel: U.clamp(highest, 1, maxOrder),
        levels: {},
        history: Array.isArray(raw.history) ? raw.history.slice(-50).filter(Boolean) : [],
        version: 1,
      };
      for (const level of G.DemoLevels || []) {
        const prev = raw.levels && raw.levels[level.id] && typeof raw.levels[level.id] === 'object' ? raw.levels[level.id] : {};
        const base = fresh.levels[level.id];
        progress.levels[level.id] = {
          unlocked: level.order <= progress.highestUnlockedLevel,
          completed: !!prev.completed,
          normalExtracts: Number.isFinite(prev.normalExtracts) ? Math.max(0, prev.normalExtracts | 0) : base.normalExtracts,
          perfectExtracts: Number.isFinite(prev.perfectExtracts) ? Math.max(0, prev.perfectExtracts | 0) : base.perfectExtracts,
          failures: Number.isFinite(prev.failures) ? Math.max(0, prev.failures | 0) : base.failures,
          abandons: Number.isFinite(prev.abandons) ? Math.max(0, prev.abandons | 0) : base.abandons,
          attempts: Number.isFinite(prev.attempts) ? Math.max(0, prev.attempts | 0) : base.attempts,
          bestPerfectTime: Number.isFinite(prev.bestPerfectTime) && prev.bestPerfectTime > 0 ? Math.floor(prev.bestPerfectTime) : null,
        };
      }
      this.data.demoProgress = progress;
    },
    _sanitizeDemoEconomy() {
      const raw = (this.data.demoEconomy && typeof this.data.demoEconomy === 'object' && !Array.isArray(this.data.demoEconomy))
        ? this.data.demoEconomy : {};
      this.data.demoEconomy = {
        settledRunIds: Array.isArray(raw.settledRunIds) ? raw.settledRunIds.filter(id => typeof id === 'string' && id).slice(-100) : [],
        assetSettledRunIds: Array.isArray(raw.assetSettledRunIds) ? raw.assetSettledRunIds.filter(id => typeof id === 'string' && id).slice(-100) : [],
        lastSettlement: (raw.lastSettlement && typeof raw.lastSettlement === 'object' && !Array.isArray(raw.lastSettlement)) ? raw.lastSettlement : null,
        version: 1,
      };
    },
    save() { Save.write(this.data); },
    resetAll() { Save.clear(); this.data = this.fresh(); this._sanitizeDemoProgress(); this._sanitizeDemoEconomy(); this._syncContractBase(); this.save(); },
    markIntroSeen() { this.data.seenIntro = true; this.save(); },

    demoProgress() { if (!this.data.demoProgress) this._sanitizeDemoProgress(); return this.data.demoProgress; },
    isDemoLevelUnlocked(levelId) {
      const level = G.getDemoLevel && G.getDemoLevel(levelId);
      if (!level) return false;
      return level.order <= this.demoProgress().highestUnlockedLevel;
    },
    canStartDemoLevel(levelId) {
      const fallback = G.getDefaultDemoLevel && G.getDefaultDemoLevel();
      return this.isDemoLevelUnlocked(levelId || (fallback && fallback.id));
    },
    recordDemoLevelResult(levelId, result) {
      const level = G.getDemoLevel && G.getDemoLevel(levelId);
      if (!level || !result) return { ok: false };
      const progress = this.demoProgress();
      const row = progress.levels[level.id];
      if (!row) return { ok: false };
      const outcome = result.outcome || 'unknown';
      const wasCompleted = !!row.completed;
      const beforeHighest = progress.highestUnlockedLevel;
      let unlockedLevelId = null;
      row.attempts++;
      if (outcome === 'normal_extract') row.normalExtracts++;
      else if (outcome === 'perfect_extract') {
        row.perfectExtracts++;
        row.completed = true;
        if (Number.isFinite(result.time) && (row.bestPerfectTime == null || result.time < row.bestPerfectTime)) row.bestPerfectTime = Math.floor(result.time);
        if (level.order === progress.highestUnlockedLevel && level.order < (G.DemoLevels || []).length) {
          progress.highestUnlockedLevel = level.order + 1;
          const next = G.getDemoLevel && G.getDemoLevel(progress.highestUnlockedLevel);
          unlockedLevelId = next && next.id;
        }
      } else if (outcome === 'abandoned') row.abandons++;
      else row.failures++;
      for (const l of G.DemoLevels || []) {
        if (progress.levels[l.id]) progress.levels[l.id].unlocked = l.order <= progress.highestUnlockedLevel;
      }
      progress.history.push({
        levelId: level.id,
        order: level.order,
        outcome,
        challengeId: result.challengeId || null,
        time: Number.isFinite(result.time) ? Math.floor(result.time) : 0,
      });
      progress.history = progress.history.slice(-50);
      this.save();
      return {
        ok: true,
        firstCompletion: outcome === 'perfect_extract' && !wasCompleted,
        unlockedLevelId,
        highestUnlockedLevel: progress.highestUnlockedLevel,
        previousHighestUnlockedLevel: beforeHighest,
        allLevelsComplete: outcome === 'perfect_extract' && level.order === (G.DemoLevels || []).length,
      };
    },

    // ---- money ----
    money() { return this.data.money; },
    canAfford(c) { return this.data.money >= c; },
    earn(n) { this.data.money += n; this.save(); },
    spend(n) { if (this.data.money < n) return false; this.data.money -= n; this.save(); return true; },

    recordDemoRelicSettlement(result, player, carried) {
      this._sanitizeDemoEconomy();
      const settlement = this._buildDemoRelicSettlement(result, player, carried);
      const economy = this.data.demoEconomy;
      if (!settlement.ok) {
        economy.lastSettlement = settlement;
        this.save();
        return settlement;
      }
      const alreadyPaid = economy.settledRunIds.indexOf(settlement.settlementId) >= 0;
      settlement.duplicate = alreadyPaid;
      settlement.currencyAwarded = alreadyPaid ? 0 : settlement.currency;
      if (!alreadyPaid && settlement.currency > 0) {
        this.data.money += settlement.currency;
        economy.settledRunIds.push(settlement.settlementId);
        economy.settledRunIds = economy.settledRunIds.slice(-100);
      }
      const alreadyReturned = economy.assetSettledRunIds.indexOf(settlement.settlementId) >= 0;
      settlement.assetsDuplicate = alreadyReturned;
      settlement.assetOverflowSold = 0;
      if (settlement.success && !alreadyReturned) {
        const returned = this._returnDemoAssetsToStash(settlement.carriedItems);
        settlement.carriedItems = returned.items;
        settlement.assetOverflowSold = returned.sold;
        economy.assetSettledRunIds.push(settlement.settlementId);
        economy.assetSettledRunIds = economy.assetSettledRunIds.slice(-100);
      }
      settlement.balance = this.data.money;
      economy.lastSettlement = settlement;
      this.save();
      return settlement;
    },

    _buildDemoRelicSettlement(result, player, carried) {
      const outcome = result && result.outcome;
      const success = outcome === 'extract' || outcome === 'normal_extract' || outcome === 'perfect_extract';
      const rewardMultiplier = Number.isFinite(result && result.rewardMultiplier) ? result.rewardMultiplier : 1;
      const settlementId = this._demoSettlementId(result, player);
      const relics = this._collectDemoSettlementItems(player, 'valuable');
      const assets = this._collectDemoAssetItems(player, carried);
      const baseValue = relics.reduce((sum, item) => sum + item.value, 0);
      const currency = success ? Math.round(baseValue * rewardMultiplier) : 0;
      return {
        ok: true,
        settlementId,
        success,
        outcome: outcome || 'unknown',
        baseValue,
        rewardMultiplier,
        currency,
        currencyAwarded: 0,
        duplicate: false,
        balance: this.data.money,
        relicItems: relics,
        carriedItems: success ? assets : [],
        lostItems: success ? [] : relics.concat(assets),
        lostValue: success ? 0 : baseValue + assets.reduce((sum, item) => sum + item.value, 0),
      };
    },

    _demoSettlementId(result, player) {
      if (result && result.settlementId) return String(result.settlementId);
      const bag = player && Array.isArray(player.backpack) ? player.backpack : [];
      const pack = bag.map(s => s && s.id + ':' + (s.n || 0)).join('|');
      return [
        'demo', result && result.levelId, result && result.challengeId,
        result && result.outcome, result && result.time,
        result && result.baseLootValue, result && result.rewardMultiplier, pack,
      ].join(':');
    },

    _collectDemoSettlementItems(player, includeType, excludeType) {
      const bag = player && Array.isArray(player.backpack) ? player.backpack : [];
      const grouped = {};
      for (const s of bag) {
        if (!s || !G.getItem(s.id) || !Number.isFinite(s.n) || s.n <= 0) continue;
        const def = G.getItem(s.id);
        if (includeType && def.type !== includeType) continue;
        if (excludeType && def.type === excludeType) continue;
        if (!grouped[s.id]) grouped[s.id] = { id: s.id, n: 0, value: 0, type: def.type };
        const n = Math.floor(s.n);
        grouped[s.id].n += n;
        grouped[s.id].value += (def.value || 0) * n;
      }
      return Object.keys(grouped).map(id => grouped[id]);
    },

    _collectDemoAssetItems(player, carried) {
      if (carried && carried.external) return [];
      const grouped = {};
      const add = (id, n) => {
        const def = G.getItem(id);
        n = Math.floor(n || 0);
        if (!def || n <= 0 || !this._isDemoReturnableAsset(id)) return;
        if (!grouped[id]) grouped[id] = { id, n: 0, value: 0, type: def.type };
        grouped[id].n += n;
        grouped[id].value += (def.value || 0) * n;
      };
      let skippedEmergencyPistol = false;
      const skipEmergency = carried && carried.emergency;
      for (const w of (player && Array.isArray(player.weapons) ? player.weapons : [])) {
        if (!w || !w.id) continue;
        if (skipEmergency && !skippedEmergencyPistol && w.id === 'w_pistol') {
          skippedEmergencyPistol = true;
          continue;
        }
        add(w.id, 1);
      }
      if (player && player.armor && player.armor.id && (!Number.isFinite(player.armor.durability) || player.armor.durability > 0)) add(player.armor.id, 1);
      const reserve = player && player.reserve ? player.reserve : {};
      const emergencyReserve = carried && carried.emergency && carried.reserve ? carried.reserve : {};
      for (const cal in reserve) if (AMMO_ITEM[cal]) add(AMMO_ITEM[cal], Math.max(0, reserve[cal] - (emergencyReserve[cal] || 0)));
      const bag = player && Array.isArray(player.backpack) ? player.backpack : [];
      for (const s of bag) if (s && s.id) add(s.id, s.n);
      return Object.keys(grouped).map(id => grouped[id]);
    },

    _isDemoReturnableAsset(id) {
      const def = G.getItem(id);
      if (!def) return false;
      if (def.type === 'valuable') return false;
      if (id === (G.DemoConfig && G.DemoConfig.scrollItemId)) return false;
      if (id === (G.DemoConfig && G.DemoConfig.coinItemId)) return false;
      return ['weapon', 'armor', 'ammo', 'med'].indexOf(def.type) >= 0;
    },

    _returnDemoAssetsToStash(items) {
      const returned = [];
      let sold = 0;
      for (const item of items || []) {
        if (!item || !item.id || !Number.isFinite(item.n) || item.n <= 0) continue;
        const n = Math.floor(item.n);
        const leftover = this.addItem(item.id, n);
        const fit = n - leftover;
        if (fit > 0) returned.push({ id: item.id, n: fit, value: (G.getItem(item.id).value || 0) * fit, type: G.getItem(item.id).type });
        if (leftover > 0) sold += this.sellPrice(item.id) * leftover;
      }
      if (sold > 0) this.data.money += sold;
      return { items: returned, sold };
    },

    // ---- stash ----
    countItem(id) {
      let n = 0; for (const s of this.data.stash) if (s.id === id) n += s.n; return n;
    },
    stashUsed() { return this.data.stash.length; },
    stashFull() { return this.data.stash.length >= C.STASH_SLOTS; },
    addItem(id, n) {
      const def = G.getItem(id); if (!def) return n;
      const max = def.stack || 1; let left = n;
      if (max > 1) {
        for (const s of this.data.stash) {
          if (s.id === id && s.n < max) { const add = Math.min(max - s.n, left); s.n += add; left -= add; if (left <= 0) break; }
        }
      }
      while (left > 0 && this.data.stash.length < C.STASH_SLOTS) {
        const add = Math.min(max, left); this.data.stash.push({ id, n: add }); left -= add;
      }
      return left;
    },
    removeItem(id, n) {
      let removed = 0;
      for (let i = this.data.stash.length - 1; i >= 0; i--) {
        const s = this.data.stash[i];
        if (s.id === id) {
          const take = Math.min(s.n, n - removed); s.n -= take; removed += take;
          if (s.n <= 0) this.data.stash.splice(i, 1);
          if (removed >= n) break;
        }
      }
      return removed;
    },

    // ---- shop ----
    buyPrice(id) { return Math.round(G.getItem(id).value * G.SHOP_MARKUP); },
    sellPrice(id) { return Math.round(G.getItem(id).value * G.SELL_RATE); },
    highestShopUnlockIndex() {
      const order = G.ShopUnlockOrder || [];
      const progress = this.demoProgress ? this.demoProgress() : null;
      let highest = progress && Number.isFinite(progress.highestUnlockedLevel) ? progress.highestUnlockedLevel : 1;
      highest = Math.max(1, Math.min(highest, (G.DemoLevels || []).length || 1));
      let idx = 0;
      for (const level of G.DemoLevels || []) {
        if (level.order <= highest) idx = Math.max(idx, order.indexOf(level.shopUnlockGroup));
      }
      return Math.max(0, idx);
    },
    isShopItemUnlocked(id) {
      if ((G.ShopStock || []).indexOf(id) < 0) return false;
      const group = G.ShopItemUnlockGroup && G.ShopItemUnlockGroup[id];
      const idx = (G.ShopUnlockOrder || []).indexOf(group);
      return idx >= 0 && idx <= this.highestShopUnlockIndex();
    },
    shopUnlockLevelForItem(id) {
      const group = G.ShopItemUnlockGroup && G.ShopItemUnlockGroup[id];
      return (G.DemoLevels || []).find(level => level.shopUnlockGroup === group) || null;
    },
    buy(id, qty) {
      qty = qty || 1;
      if (!G.getItem(id) || (G.ShopStock || []).indexOf(id) < 0) return { ok: false, msg: G.t('ui.trader.toast.cannotBuy') };
      if (!this.isShopItemUnlocked(id)) {
        const level = this.shopUnlockLevelForItem(id);
        const msg = level ? G.t('toast.item_locked', { level: G.t('level.' + level.id + '.name') }) : G.t('ui.trader.toast.cannotBuy');
        return { ok: false, msg };
      }
      const cost = this.buyPrice(id) * qty;
      if (!this.canAfford(cost)) return { ok: false, msg: G.t('toast.no_credits') };
      if (this.stashFull() && this.countItem(id) === 0) return { ok: false, msg: G.t('toast.stash_full') };
      const leftover = this.addItem(id, qty);
      const bought = qty - leftover;
      if (bought <= 0) return { ok: false, msg: G.t('toast.stash_full') };
      this.spend(this.buyPrice(id) * bought);
      G.Audio.play('cash', { vol: 0.6 });
      return { ok: true, bought };
    },
    sell(id, qty) {
      qty = qty || 1;
      const have = this.countItem(id);
      qty = Math.min(qty, have);
      if (qty <= 0) return { ok: false };
      this.removeItem(id, qty);
      this.earn(this.sellPrice(id) * qty);
      G.Audio.play('cash', { vol: 0.6 });
      return { ok: true, sold: qty, gained: this.sellPrice(id) * qty };
    },

    // ---- loadout / raid lifecycle ----
    // Validate & deduct loadout from stash. Returns carried config or {error}.
    commitRaidStart(loadout) {
      const ld = loadout || this.data.loadout;
      // must bring a weapon — checked BEFORE any stash mutation so nothing is lost on abort
      if (!ld.primary && !ld.secondary) return { error: G.t('toast.no_weapon_selected') };
      // verify weapons & armor exist in stash
      const need = {};
      if (ld.primary) need[ld.primary] = (need[ld.primary] || 0) + 1;
      if (ld.secondary) need[ld.secondary] = (need[ld.secondary] || 0) + 1;
      if (ld.armor) need[ld.armor] = (need[ld.armor] || 0) + 1;
      for (const id in need) if (this.countItem(id) < need[id]) return { error: G.t('toast.missing_item', { name: G.I18n.itemName(id) }) };

      const carried = { weapons: [null, null], armorId: null, reserve: {}, backpack: [] };
      // deduct & equip weapons
      if (ld.primary) { this.removeItem(ld.primary, 1); carried.weapons[0] = { id: ld.primary, mag: G.getItem(ld.primary).mag }; }
      if (ld.secondary) { this.removeItem(ld.secondary, 1); carried.weapons[1] = { id: ld.secondary, mag: G.getItem(ld.secondary).mag }; }
      if (ld.armor) { this.removeItem(ld.armor, 1); carried.armorId = ld.armor; }
      // pull matching ammo — cap derived from the largest equipped magazine of that caliber
      // (so a pistol doesn't drag 240 rounds, and the at-risk-on-death exposure is bounded)
      const calibers = {};
      carried.weapons.forEach(w => { if (w) { const wd = G.getItem(w.id); calibers[wd.ammoType] = Math.max(calibers[wd.ammoType] || 0, wd.mag); } });
      for (const cal in calibers) {
        const cap = Math.max(120, calibers[cal] * 4);
        const ammoId = AMMO_ITEM[cal];
        const have = this.countItem(ammoId);
        const take = Math.min(have, cap);
        if (take > 0) { this.removeItem(ammoId, take); carried.reserve[cal] = take; }
        // load first magazine from reserve handled at player build
      }
      // meds
      if (ld.medId && ld.medCount > 0) {
        const have = this.countItem(ld.medId);
        const take = Math.min(have, ld.medCount);
        if (take > 0) { this.removeItem(ld.medId, take); carried.backpack.push({ id: ld.medId, n: take }); }
      }
      this.save();
      return carried;
    },

    prepareDemoLoadout(loadout) {
      const ld = loadout || this.data.loadout;
      const emergency = this.shouldUseEmergencyPistol(ld);
      if (emergency) return this.emergencyPistolKit();
      if (!ld.primary && !ld.secondary) return { error: G.t('toast.no_weapon_selected') };
      const need = {};
      if (ld.primary) need[ld.primary] = (need[ld.primary] || 0) + 1;
      if (ld.secondary) need[ld.secondary] = (need[ld.secondary] || 0) + 1;
      if (ld.armor) need[ld.armor] = (need[ld.armor] || 0) + 1;
      for (const id in need) if (this.countItem(id) < need[id]) return { error: G.t('toast.missing_item', { name: G.I18n.itemName(id) }) };

      const carried = { weapons: [null, null], armorId: null, reserve: {}, backpack: [], phase39Preview: true };
      if (ld.primary) carried.weapons[0] = { id: ld.primary, mag: G.getItem(ld.primary).mag };
      if (ld.secondary) carried.weapons[1] = { id: ld.secondary, mag: G.getItem(ld.secondary).mag };
      if (ld.armor) carried.armorId = ld.armor;
      const calibers = {};
      carried.weapons.forEach(w => { if (w) { const wd = G.getItem(w.id); calibers[wd.ammoType] = Math.max(calibers[wd.ammoType] || 0, wd.mag); } });
      for (const cal in calibers) {
        const cap = Math.max(120, calibers[cal] * 4);
        const ammoId = AMMO_ITEM[cal];
        const have = this.countItem(ammoId);
        const take = Math.min(have, cap);
        if (take > 0) carried.reserve[cal] = take;
      }
      if (ld.medId && ld.medCount > 0) {
        const have = this.countItem(ld.medId);
        const take = Math.min(have, ld.medCount);
        if (take > 0) carried.backpack.push({ id: ld.medId, n: take });
      }
      return carried;
    },

    shouldUseEmergencyPistol(loadout) {
      const hasWeapon = this.data.stash.some(s => {
        const def = G.getItem(s.id);
        return def && def.type === 'weapon' && s.n > 0;
      });
      if (hasWeapon || this.money() > 0) return false;
      const ld = loadout || this.data.loadout || {};
      return !ld.primary || this.countItem(ld.primary) <= 0;
    },

    emergencyPistolKit() {
      return {
        weapons: [{ id: 'w_pistol', mag: 8 }, null],
        armorId: null,
        reserve: { '9mm': 24 },
        backpack: [],
        emergency: true,
        phase39Preview: true,
      };
    },

    commitDemoRaidStart(loadout) {
      const ld = loadout || this.data.loadout;
      if (this.shouldUseEmergencyPistol(ld)) return this.emergencyPistolKit();
      const carried = this.commitRaidStart(ld);
      if (!carried.error) carried.assetsDeducted = true;
      return carried;
    },

    // Free scav kit — never deducts; ensures player can always raid.
    scavKit() {
      return {
        weapons: [{ id: 'w_pistol', mag: 8 }, null],
        armorId: null,
        reserve: { '9mm': 24 },
        backpack: [{ id: 'm_bandage', n: 1 }],
        scav: true,
      };
    },

    // On successful extract: stash the player's surviving gear + loot.
    // Gear is stashed first (priority for slots); anything that doesn't fit a full
    // stash is auto-sold for cash rather than silently destroyed. Scav runs pay a
    // loot tax on valuables so the free kit can't become an infinite-money farm.
    commitExtract(player, scav) {
      let value = 0, items = 0, sold = 0;
      const keep = scav ? (C.SCAV_LOOT_KEEP) : 1;
      // isLoot: only newly-found goods count toward earnings stats; returned gear does not
      const stashOrSell = (id, n, isLoot) => {
        if (n <= 0) return;
        const unfit = this.addItem(id, n);
        const fit = n - unfit;
        if (isLoot) { items += fit; value += (G.getItem(id).value || 0) * fit; }
        if (unfit > 0) { const cash = this.sellPrice(id) * unfit; this.data.money += cash; sold += cash; }
      };
      // gear first (returned, not earned)
      for (const w of player.weapons) if (w) stashOrSell(w.id, 1, false);
      if (player.armor) stashOrSell(player.armor.id, 1, false);
      for (const cal in player.reserve) { const n = player.reserve[cal]; if (n > 0 && AMMO_ITEM[cal]) stashOrSell(AMMO_ITEM[cal], n, false); }
      // backpack loot (scav tax applies to valuables only) — this is the actual earnings
      for (const s of player.backpack) {
        const def = G.getItem(s.id);
        const n = (scav && def.type === 'valuable') ? Math.floor(s.n * keep) : s.n;
        stashOrSell(s.id, n, true);
      }
      // stats
      const st = this.data.stats;
      st.raids++; st.survived++; st.kills += player.kills;
      st.totalEarned += value;
      if (value > st.bestExtract) st.bestExtract = value;
      this.save();
      return { value, items, sold, scav: !!scav };
    },

    commitDeath(player) {
      const st = this.data.stats;
      st.raids++; st.died++; st.kills += player.kills;
      this.save();
    },

    /* ----------------------------- Contracts ------------------------------ */
    // Fold a finished raid into the lifetime counters. Only a successful surface
    // (extract) counts — kills and dives the tide swallowed don't advance favors.
    recordRaid(res) {
      if (!res || res.outcome !== 'extract') return;
      // Seed the active contract's baseline from the PRE-raid counters first, so
      // this raid's own kills/surfaces count toward it (not baselined away).
      this._syncContractBase();
      const p = this.data.prog;
      p.surfaces++;
      if (res.locId) p.byLoc[res.locId] = (p.byLoc[res.locId] || 0) + 1;
      const k = res.killsByTier || {};
      for (const tier in p.kills) p.kills[tier] += (k[tier] || 0);
      this.save();
    },

    contractCurrent() { return G.Contracts[this.data.contracts.stage] || null; },

    // The lifetime counter a counter-goal measures against (deliver goals read
    // the stash directly and return 0 here).
    _contractCounter(c) {
      const g = c.goal, p = this.data.prog;
      if (g.kind === 'surface') return p.surfaces;
      if (g.kind === 'loc') return p.byLoc[g.loc] || 0;
      if (g.kind === 'kill') return p.kills[g.tier] || 0;
      return 0;
    },

    // Snapshot the active contract's baseline counter the first time we see it,
    // so progress is measured from when the favor was taken (not game start).
    _syncContractBase() {
      const c = this.contractCurrent();
      const ct = this.data.contracts;
      if (!c) { ct.base = null; return; }
      if (c.goal.kind === 'deliver') { ct.base = 0; return; }
      if (ct.base == null) ct.base = this._contractCounter(c);
    },

    // { cur, total, done } for the active contract (or null when all are done).
    contractProgress(c) {
      c = c || this.contractCurrent();
      if (!c) return null;
      const total = c.goal.n;
      let cur;
      if (c.goal.kind === 'deliver') cur = Math.min(this.countItem(c.goal.item), total);
      else cur = Math.max(0, Math.min(total, this._contractCounter(c) - (this.data.contracts.base || 0)));
      return { cur, total, done: cur >= total };
    },

    // Claim the active contract's reward (consuming any deliverable), then open
    // the next favor. Returns { ok, reward } or { ok:false }.
    claimContract() {
      const c = this.contractCurrent();
      if (!c) return { ok: false };
      const pr = this.contractProgress(c);
      if (!pr.done) return { ok: false };
      if (c.goal.kind === 'deliver') this.removeItem(c.goal.item, c.goal.n);
      const rw = c.reward || {};
      if (rw.money) this.data.money += rw.money;
      if (rw.items) for (const it of rw.items) this.addItem(it.id, it.n);
      this.data.contracts.stage++;
      this.data.contracts.base = null;
      this._syncContractBase();
      this.save();
      G.Audio.play('cash', { vol: 0.7 });
      return { ok: true, reward: rw };
    },

    // settings
    setSfx(on) { this.data.settings.sfx = on; G.Audio.setEnabled(on); this.save(); },
    setVolume(v) { this.data.settings.volume = v; G.Audio.setVolume(v); this.save(); },
    setLang(l) { const lang = G.I18n.setLang(l); this.data.settings.lang = lang; this.save(); return lang; },
  };
  G.Profile = Profile;

})();

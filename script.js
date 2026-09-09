/* =========================================================================
   BLOCKCRAFT BROS
   Een platformer-engine met 40 ingebouwde levels + een level editor.
   ========================================================================= */

'use strict';

/* ---------------------------- CONSTANTS -------------------------------- */
const TILE = 32;               // grootte van 1 tegel in pixels
const GRAVITY = 0.55;
const FRICTION = 0.82;
const MAX_FALL_SPEED = 14;
const RUN_SPEED = 3.6;
const RUN_ACCEL = 0.55;
const JUMP_VELOCITY = -11.5;
const JUMP_HOLD_BOOST = -0.42; // extra lift while holding jump early
const MAX_JUMP_HOLD_FRAMES = 14;

// Tile type codes used throughout the level data & editor
const T = {
  EMPTY: 0,
  GROUND: 1,
  BRICK: 2,
  QUESTION: 3,       // question block with coin
  QUESTION_POWER: 4,  // question block with powerup
  PIPE: 5,
  SPIKE: 6,
  COIN: 7,
  PLATFORM: 8,       // thin one-way platform
  FLAGPOLE: 9,
  START: 10,
  CLOUD_BLOCK: 11,
  ICE_BLOCK: 12,
  LAVA: 13,
  BOUNCE: 14,        // trampoline / bounce pad
  DOOR: 15,          // boss door / castle door (level end alt)
  STAIR: 16,
};

const ENEMY = {
  GOOMBA: 'goomba',
  FLYER: 'flyer',
  SPIKY: 'spiky',
  SHOOTER: 'shooter',
  JUMPER: 'jumper',
  BOSS: 'boss',
};

const POWERUP = {
  MUSHROOM: 'mushroom',
  FIRE: 'fire',
  STAR: 'star',
  WINGS: 'wings',
  ONEUP: 'oneup',
};

/* ---------------------------- UTILITIES -------------------------------- */
function rnd(seed) {
  // simple deterministic pseudo-random generator (mulberry32)
  let t = seed;
  return function () {
    t |= 0; t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function saveJSON(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* ignore */ }
}
function loadJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) { return fallback; }
}

/* =========================================================================
   LEVEL GENERATION
   40 levels are procedurally assembled from hand-authored "chunks" so
   every level feels designed rather than random, but we don't need to
   hand-place thousands of tiles. Each world (1-8) has 5 levels, and
   difficulty/enemy density/gimmicks scale with the world number.
   ========================================================================= */

const WORLD_THEMES = [
  { id: 1, name: 'Grasland', theme: 'grass' },
  { id: 2, name: 'Woestijn', theme: 'desert' },
  { id: 3, name: 'IJsvlakte', theme: 'ice' },
  { id: 4, name: 'Grotten', theme: 'castle' },
  { id: 5, name: 'Wolkenrijk', theme: 'grass' },
  { id: 6, name: 'Lavaland', theme: 'castle' },
  { id: 7, name: 'Nachtbos', theme: 'night' },
  { id: 8, name: 'Eindkasteel', theme: 'castle' },
];

// Builds a level's tile grid + entity list procedurally but deterministically.
function generateLevel(levelIndex) {
  // levelIndex: 0-39
  const world = Math.floor(levelIndex / 5); // 0-7
  const stage = levelIndex % 5;             // 0-4 (stage 5 = boss)
  const isBoss = stage === 4;
  const themeInfo = WORLD_THEMES[world];
  const difficulty = world + stage * 0.4; // rough scaling 0..~9

  const width = clamp(70 + world * 10 + stage * 6, 70, 170);
  const height = 18; // rows
  const groundY = 14; // row index where ground starts

  const grid = [];
  for (let y = 0; y < height; y++) grid.push(new Array(width).fill(T.EMPTY));

  const rand = rnd(levelIndex * 7919 + 13);
  const entities = [];
  let start = { x: 2, y: groundY - 1 };
  let flag = { x: width - 4, y: groundY - 1 };

  // Base ground with occasional pits
  let x = 0;
  const pitChance = isBoss ? 0 : clamp(0.06 + world * 0.015, 0.06, 0.22);
  while (x < width) {
    let pit = false;
    if (x > 8 && x < width - 8 && rand() < pitChance) {
      const pitWidth = 2 + Math.floor(rand() * clamp(2 + world * 0.3, 2, 4));
      for (let px = 0; px < pitWidth && x < width - 6; px++) {
        x++; pit = true;
      }
    }
    if (!pit) {
      for (let gy = groundY; gy < height; gy++) grid[gy][x] = T.GROUND;
      x++;
    }
  }

  // Helper to place a tile safely
  function set(gx, gy, val) {
    if (gx >= 0 && gx < width && gy >= 0 && gy < height) grid[gy][gx] = val;
  }
  function isGroundAt(gx) {
    return grid[groundY] && grid[groundY][gx] === T.GROUND;
  }

  // Themed obstacles based on world
  const theme = themeInfo.theme;

  // Scatter bricks / question blocks / coin arcs
  const featureCount = 8 + world * 3 + stage;
  for (let i = 0; i < featureCount; i++) {
    const fx = 6 + Math.floor(rand() * (width - 14));
    if (!isGroundAt(fx)) continue;
    const kind = rand();
    const blockY = groundY - 3 - Math.floor(rand() * 3);
    if (kind < 0.3) {
      // question block row
      const len = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < len; k++) {
        set(fx + k, blockY, rand() < 0.25 ? T.QUESTION_POWER : T.QUESTION);
      }
    } else if (kind < 0.55) {
      // brick platform
      const len = 2 + Math.floor(rand() * 4);
      for (let k = 0; k < len; k++) set(fx + k, blockY, T.BRICK);
    } else if (kind < 0.75) {
      // coin arc
      const len = 3 + Math.floor(rand() * 4);
      for (let k = 0; k < len; k++) {
        const arcY = blockY - Math.round(Math.sin((k / len) * Math.PI) * 3);
        set(fx + k, arcY, T.COIN);
      }
    } else if (kind < 0.9) {
      // floating platform (thin) for jumping puzzles
      const len = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < len; k++) set(fx + k, blockY, T.PLATFORM);
    } else {
      // pipe (obstacle to jump over)
      const pipeH = 2 + Math.floor(rand() * 2);
      for (let h = 0; h < pipeH; h++) set(fx, groundY - 1 - h, T.PIPE);
      set(fx, groundY - pipeH - 0, T.PIPE);
    }
  }

  // Theme-specific hazards
  if (theme === 'castle' || world >= 5) {
    // lava pits instead of plain pits occasionally + spikes
    const spikeCount = 4 + world;
    for (let i = 0; i < spikeCount; i++) {
      const sx = 10 + Math.floor(rand() * (width - 20));
      if (isGroundAt(sx) && isGroundAt(sx - 1) && isGroundAt(sx + 1)) {
        set(sx, groundY - 1, T.SPIKE);
      }
    }
  }
  if (theme === 'ice') {
    // convert some ground patches to ice
    let ix = 0;
    while (ix < width) {
      if (rand() < 0.3) {
        const len = 4 + Math.floor(rand() * 6);
        for (let k = 0; k < len && ix + k < width; k++) {
          if (grid[groundY][ix + k] === T.GROUND) grid[groundY][ix + k] = T.ICE_BLOCK;
        }
        ix += len;
      } else ix++;
    }
  }

  // Bounce pads for verticality (worlds 5+)
  if (world >= 4) {
    const bounceCount = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < bounceCount; i++) {
      const bx = 10 + Math.floor(rand() * (width - 20));
      if (isGroundAt(bx)) set(bx, groundY - 1, T.BOUNCE);
    }
  }

  // Stairs near the end for classic mario feel (non-boss levels)
  if (!isBoss && width > 40) {
    const stairX = width - 10;
    for (let s = 0; s < 4; s++) {
      for (let h = 0; h <= s; h++) {
        if (isGroundAt(stairX + s)) set(stairX + s, groundY - 1 - h, T.STAIR);
      }
    }
  }

  // Enemies: density scales with world/stage
  const enemyBudget = Math.round(4 + world * 2.2 + stage * 1.3);
  const enemyTypesAvailable = [ENEMY.GOOMBA];
  if (world >= 1) enemyTypesAvailable.push(ENEMY.JUMPER);
  if (world >= 2) enemyTypesAvailable.push(ENEMY.FLYER);
  if (world >= 3) enemyTypesAvailable.push(ENEMY.SPIKY);
  if (world >= 4) enemyTypesAvailable.push(ENEMY.SHOOTER);

  for (let i = 0; i < enemyBudget; i++) {
    const ex = 10 + Math.floor(rand() * (width - 20));
    if (!isGroundAt(ex)) continue;
    const type = enemyTypesAvailable[Math.floor(rand() * enemyTypesAvailable.length)];
    const ey = (type === ENEMY.FLYER) ? groundY - 4 - Math.floor(rand() * 3) : groundY - 1;
    entities.push({ type: 'enemy', kind: type, x: ex * TILE, y: ey * TILE });
  }

  // Boss levels get a boss near the end + a door
  if (isBoss) {
    const bossX = width - 8;
    entities.push({ type: 'enemy', kind: ENEMY.BOSS, x: bossX * TILE, y: (groundY - 3) * TILE, hp: 4 + world });
    set(width - 3, groundY - 1, T.DOOR);
    set(width - 3, groundY - 2, T.DOOR);
    set(width - 3, groundY - 3, T.DOOR);
    flag = null;
  }

  // Powerup pickups scattered directly on ground occasionally (not just in blocks)
  const looseBudget = 1 + Math.floor(world / 2);
  for (let i = 0; i < looseBudget; i++) {
    const px = 15 + Math.floor(rand() * (width - 30));
    if (isGroundAt(px)) {
      const types = [POWERUP.MUSHROOM, POWERUP.FIRE, POWERUP.STAR, POWERUP.WINGS];
      entities.push({ type: 'powerup', kind: types[Math.floor(rand() * types.length)], x: px * TILE, y: (groundY - 2) * TILE, loose: true });
    }
  }

  // Extra coins scattered
  const coinBudget = 10 + world * 2;
  for (let i = 0; i < coinBudget; i++) {
    const cx = 5 + Math.floor(rand() * (width - 10));
    const cy = groundY - 1 - Math.floor(rand() * 5);
    if (grid[cy] && grid[cy][cx] === T.EMPTY) grid[cy][cx] = T.COIN;
  }

  // Ensure start area is clear
  for (let cy = 0; cy < groundY; cy++) { grid[cy][0] = T.EMPTY; grid[cy][1] = T.EMPTY; grid[cy][2] = T.EMPTY; }

  // Place flagpole
  if (flag) {
    for (let h = 1; h <= 6; h++) set(flag.x, groundY - h, T.FLAGPOLE);
  }

  return {
    id: levelIndex,
    name: `${themeInfo.name} ${stage + 1}${isBoss ? ' - BAAS' : ''}`,
    world: world + 1,
    stage: stage + 1,
    theme,
    isBoss,
    width, height,
    grid,
    entities,
    start,
    timeLimit: Math.round(200 + width * 1.4),
  };
}

// Pre-generate all 40 levels once (fast enough, deterministic)
const CAMPAIGN_LEVELS = [];
for (let i = 0; i < 40; i++) CAMPAIGN_LEVELS.push(generateLevel(i));

/* =========================================================================
   THEME COLOR PALETTES
   ========================================================================= */
const THEME_COLORS = {
  grass:  { sky1: '#5c94fc', sky2: '#a9d6ff', ground: '#8b5a2b', groundTop: '#3fa34d', brick: '#c0723c', accent: '#2e7d32' },
  desert: { sky1: '#f7c873', sky2: '#ffe9b3', ground: '#c9a15a', groundTop: '#e0c288', brick: '#b5793a', accent: '#d9a441' },
  ice:    { sky1: '#bcd9f7', sky2: '#e8f4ff', ground: '#8fa8c9', groundTop: '#dff2ff', brick: '#6f92b8', accent: '#aeefff' },
  castle: { sky1: '#2b2233', sky2: '#4a3a5a', ground: '#4a4a55', groundTop: '#6b6b78', brick: '#5a4a4a', accent: '#8a2b2b' },
  night:  { sky1: '#0d1233', sky2: '#1c2555', ground: '#2f3550', groundTop: '#454d70', brick: '#3d3560', accent: '#7b6cd9' },
};

/* =========================================================================
   ENTITY CLASSES
   ========================================================================= */

class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = TILE * 0.7; this.h = TILE * 0.9;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
    this.facing = 1;
    this.power = 'small'; // small, big, fire
    this.invincible = 0;  // star timer
    this.hurtTimer = 0;   // brief invulnerability after hit
    this.wings = 0;       // wings charges
    this.fireCooldown = 0;
    this.dead = false;
    this.jumpHeld = 0;
    this.jumpReleased = true;
    this.animTimer = 0;
    this.animFrame = 0;
    this.onIce = false;
    this.crouching = false;
  }
  get height() { return this.power === 'small' ? TILE * 0.9 : TILE * 1.3; }
}

class Enemy {
  constructor(kind, x, y, opts) {
    this.kind = kind;
    this.x = x; this.y = y;
    this.w = TILE * 0.85; this.h = TILE * 0.85;
    this.vx = (kind === ENEMY.BOSS) ? 0 : -1.1;
    this.vy = 0;
    this.dead = false;
    this.squashed = false;
    this.squashTimer = 0;
    this.onGround = false;
    this.dir = -1;
    this.shootTimer = 90;
    this.hp = (opts && opts.hp) || (kind === ENEMY.SPIKY ? 2 : kind === ENEMY.BOSS ? 5 : 1);
    this.jumpTimer = 60 + Math.random() * 60;
    this.baseY = y;
    this.hitFlash = 0;
    if (kind === ENEMY.FLYER) { this.floatPhase = Math.random() * Math.PI * 2; }
  }
}

class Projectile {
  constructor(x, y, vx, vy, owner) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.w = 12; this.h = 12;
    this.owner = owner; // 'player' or 'enemy'
    this.dead = false;
    this.bounces = 0;
    this.life = 240;
  }
}

class PowerupEntity {
  constructor(kind, x, y, opts) {
    this.kind = kind;
    this.x = x; this.y = y;
    this.w = TILE * 0.7; this.h = TILE * 0.7;
    this.vx = opts && opts.loose ? 0 : 1.2;
    this.vy = 0;
    this.dead = false;
    this.emerging = !(opts && opts.loose);
    this.emergeTarget = y;
    if (this.emerging) this.y = y + TILE;
    this.spawnedFromBlock = !(opts && opts.loose);
    this.life = 999999;
  }
}

class Particle {
  constructor(x, y, vx, vy, color, life, size) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.color = color; this.life = life; this.maxLife = life;
    this.size = size || 4;
  }
}

class FloatingText {
  constructor(x, y, text, color) {
    this.x = x; this.y = y; this.text = text; this.color = color || '#fff';
    this.life = 45; this.vy = -1.1;
  }
}

/* =========================================================================
   GAME ENGINE
   ========================================================================= */

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.keys = {};
    this.reset();
    this.camera = { x: 0, y: 0 };
    this.shakeTimer = 0;
    this.paused = false;
    this.running = false;
    this.onWin = null;
    this.onLose = null;
    this.lastTime = 0;
    this.particles = [];
    this.floatingTexts = [];
    this._bindInput();
  }

  reset() {
    this.level = null;
    this.player = null;
    this.enemies = [];
    this.projectiles = [];
    this.powerups = [];
    this.coinsCollected = 0;
    this.lives = 3;
    this.time = 0;
    this.finished = false;
    this.won = false;
    this.blockBumps = []; // animated bump offsets for blocks {gx, gy, t}
    this.brokenTiles = new Set();
    this.usedBlocks = new Set(); // question blocks already used -> becomes brick-empty
    this.coinTilesCollected = new Set();
    this.flagReached = false;
  }

  _bindInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  loadLevel(levelData, opts) {
    this.reset();
    this.level = levelData;
    this.lives = (opts && opts.lives) || 3;
    const startX = (levelData.start.x) * TILE;
    const startY = (levelData.start.y) * TILE;
    this.player = new Player(startX, startY);
    this.enemies = [];
    this.powerups = [];
    this.projectiles = [];
    for (const ent of levelData.entities) {
      if (ent.type === 'enemy') this.enemies.push(new Enemy(ent.kind, ent.x, ent.y, ent));
      if (ent.type === 'powerup') this.powerups.push(new PowerupEntity(ent.kind, ent.x, ent.y, ent));
    }
    this.time = levelData.timeLimit || 300;
    this.finished = false;
    this.won = false;
    this.camera.x = 0;
    this.running = true;
    this.paused = false;
  }

  tileAt(gx, gy) {
    if (!this.level) return T.EMPTY;
    if (gy < 0) return T.EMPTY;
    if (gx < 0 || gx >= this.level.width || gy >= this.level.height) return T.GROUND; // treat world edges as solid bottom-ish
    return this.level.grid[gy][gx];
  }

  setTile(gx, gy, val) {
    if (gx < 0 || gx >= this.level.width || gy < 0 || gy >= this.level.height) return;
    this.level.grid[gy][gx] = val;
  }

  isSolid(tile) {
    return tile === T.GROUND || tile === T.BRICK || tile === T.QUESTION || tile === T.QUESTION_POWER ||
           tile === T.PIPE || tile === T.CLOUD_BLOCK || tile === T.ICE_BLOCK || tile === T.STAIR || tile === T.DOOR;
  }
  isHazard(tile) { return tile === T.SPIKE || tile === T.LAVA; }
  isOneWay(tile) { return tile === T.PLATFORM; }

  update(dt) {
    if (!this.running || this.paused || this.finished) return;
    this.time -= dt / 60;
    if (this.time <= 0 && !this.finished) { this.loseGame('tijd'); return; }

    this._updatePlayer();
    this._updateEnemies();
    this._updateProjectiles();
    this._updatePowerups();
    this._updateParticles();
    this._updateCamera();
    this._updateBlockBumps(dt);

    if (this.player.y > this.level.height * TILE + 200) {
      this.loseGame('val');
    }
  }

  _updateBlockBumps(dt) {
    for (let i = this.blockBumps.length - 1; i >= 0; i--) {
      this.blockBumps[i].t -= dt;
      if (this.blockBumps[i].t <= 0) this.blockBumps.splice(i, 1);
    }
  }

  /* ------------------------- PLAYER PHYSICS ------------------------- */
  _updatePlayer() {
    const p = this.player;
    if (p.dead) return;
    const left = this.keys['ArrowLeft'] || this.keys['KeyA'] || this.virtualLeft;
    const right = this.keys['ArrowRight'] || this.keys['KeyD'] || this.virtualRight;
    const jumpKey = this.keys['Space'] || this.keys['ArrowUp'] || this.keys['KeyW'] || this.virtualJump;
    const fireKey = this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.keys['KeyX'] || this.virtualFire;

    const accel = p.onIce ? RUN_ACCEL * 0.4 : RUN_ACCEL;
    const maxSpeed = p.invincible > 0 ? RUN_SPEED * 1.5 : RUN_SPEED;

    if (left && !right) { p.vx -= accel; p.facing = -1; }
    else if (right && !left) { p.vx += accel; p.facing = 1; }
    else { p.vx *= p.onIce ? 0.98 : FRICTION; if (Math.abs(p.vx) < 0.05) p.vx = 0; }
    p.vx = clamp(p.vx, -maxSpeed, maxSpeed);

    // Jump
    if (jumpKey && p.onGround && p.jumpReleased) {
      p.vy = JUMP_VELOCITY;
      p.onGround = false;
      p.jumpHeld = 1;
      p.jumpReleased = false;
      this._spawnParticles(p.x + p.w / 2, p.y + p.h, 3, '#fff', 1);
    } else if (jumpKey && p.jumpHeld > 0 && p.jumpHeld < MAX_JUMP_HOLD_FRAMES) {
      p.vy += JUMP_HOLD_BOOST;
      p.jumpHeld++;
    } else {
      p.jumpHeld = 0;
    }
    if (!jumpKey) p.jumpReleased = true;

    // Wings: allow a mid-air boost jump (double jump style) when wings>0
    if (jumpKey && !p.onGround && p.jumpReleased === false && p.wings > 0 && p.vy > 2 && p._wingsUsedThisAirtime !== true) {
      // handled via double-tap logic below instead
    }
    if (p._wantWingJump && p.wings > 0) {
      p.vy = JUMP_VELOCITY * 0.85;
      p.wings--;
      p._wantWingJump = false;
      this._spawnParticles(p.x + p.w / 2, p.y + p.h / 2, 6, '#fff8c0', 1);
    }

    // Gravity
    p.vy += GRAVITY;
    if (p.vy > MAX_FALL_SPEED) p.vy = MAX_FALL_SPEED;

    // Fire
    if (p.fireCooldown > 0) p.fireCooldown--;
    if (fireKey && p.power === 'fire' && p.fireCooldown <= 0) {
      this.projectiles.push(new Projectile(p.x + p.w / 2 + p.facing * 10, p.y + p.h / 2, p.facing * 6, -2, 'player'));
      p.fireCooldown = 20;
    }

    // Move & collide axis-separated
    p.onIce = false;
    this._moveAndCollide(p, true);

    if (p.hurtTimer > 0) p.hurtTimer--;
    if (p.invincible > 0) p.invincible--;

    // Interactions: coins, blocks, hazards, enemies, powerups, flag
    this._handleTileInteractions(p);
    this._handleEnemyCollisions();
    this._handlePowerupCollisions();
    this._handleFlagAndDoor();

    // animation
    p.animTimer += 1;
    if (Math.abs(p.vx) > 0.3 && p.onGround) {
      if (p.animTimer > 6) { p.animFrame = (p.animFrame + 1) % 4; p.animTimer = 0; }
    } else if (p.onGround) p.animFrame = 0;
  }

  requestWingJump() { this.player._wantWingJump = true; }

  _moveAndCollide(entity, isPlayer) {
    // Horizontal
    entity.x += entity.vx;
    this._resolveHorizontal(entity);
    // Vertical
    entity.y += entity.vy;
    const wasOnGround = entity.onGround;
    entity.onGround = false;
    this._resolveVertical(entity, isPlayer);
  }

  _getHeight(entity) {
    return entity === this.player ? entity.height : entity.h;
  }

  _resolveHorizontal(entity) {
    const h = this._getHeight(entity);
    const left = Math.floor(entity.x / TILE);
    const right = Math.floor((entity.x + entity.w) / TILE);
    const top = Math.floor(entity.y / TILE);
    const bottom = Math.floor((entity.y + h - 1) / TILE);
    for (let gy = top; gy <= bottom; gy++) {
      for (let gx = left; gx <= right; gx++) {
        const t = this.tileAt(gx, gy);
        if (this.isSolid(t)) {
          const tileRect = { x: gx * TILE, y: gy * TILE, w: TILE, h: TILE };
          const entRect = { x: entity.x, y: entity.y, w: entity.w, h };
          if (aabbOverlap(entRect, tileRect)) {
            if (entity.vx > 0) entity.x = tileRect.x - entity.w;
            else if (entity.vx < 0) entity.x = tileRect.x + TILE;
            if (entity.vx !== 0) entity.vx = (entity instanceof Enemy) ? -entity.vx : 0;
            if (t === T.ICE_BLOCK && entity === this.player) entity.onIce = true;
          }
        }
      }
    }
    // clamp to level bounds
    if (entity.x < 0) entity.x = 0;
    if (this.level && entity.x + entity.w > this.level.width * TILE) entity.x = this.level.width * TILE - entity.w;
  }

  _resolveVertical(entity, isPlayer) {
    const h = this._getHeight(entity);
    const left = Math.floor(entity.x / TILE);
    const right = Math.floor((entity.x + entity.w) / TILE);
    const top = Math.floor(entity.y / TILE);
    const bottom = Math.floor((entity.y + h) / TILE);
    for (let gy = top; gy <= bottom; gy++) {
      for (let gx = left; gx <= right; gx++) {
        const t = this.tileAt(gx, gy);
        const tileRect = { x: gx * TILE, y: gy * TILE, w: TILE, h: TILE };
        const entRect = { x: entity.x, y: entity.y, w: entity.w, h };
        if (this.isSolid(t) && aabbOverlap(entRect, tileRect)) {
          if (entity.vy > 0) {
            entity.y = tileRect.y - h;
            entity.vy = 0;
            entity.onGround = true;
            if (t === T.ICE_BLOCK && isPlayer) entity.onIce = true;
          } else if (entity.vy < 0) {
            entity.y = tileRect.y + TILE;
            entity.vy = 0;
            if (isPlayer) this._hitBlockAbove(gx, gy, t);
          }
        } else if (this.isOneWay(t) && aabbOverlap(entRect, tileRect) && entity.vy > 0 && (entity.y + h - entity.vy) <= tileRect.y + 4) {
          entity.y = tileRect.y - h;
          entity.vy = 0;
          entity.onGround = true;
        } else if (t === T.BOUNCE && aabbOverlap(entRect, tileRect) && entity.vy > 0) {
          entity.vy = JUMP_VELOCITY * 1.6;
          entity.onGround = false;
          this._spawnParticles(entity.x + entity.w / 2, tileRect.y, 8, '#ffe94d', 1);
        }
      }
    }
  }

  _hitBlockAbove(gx, gy, t) {
    if (t === T.QUESTION || t === T.QUESTION_POWER) {
      const key = gx + ',' + gy;
      if (!this.usedBlocks.has(key)) {
        this.usedBlocks.add(key);
        this.setTile(gx, gy, T.BRICK === t ? T.BRICK : 2); // becomes plain used block visually (brick-like but marked used)
        this.blockBumps.push({ gx, gy, t: 8 });
        if (t === T.QUESTION) {
          this.coinsCollected++;
          this.floatingTexts.push(new FloatingText(gx * TILE, gy * TILE - 10, '+1', '#ffd700'));
          this._spawnParticles(gx * TILE + TILE / 2, gy * TILE, 5, '#ffd700', 1);
        } else {
          const types = [POWERUP.MUSHROOM, POWERUP.FIRE, POWERUP.STAR, POWERUP.WINGS];
          const kind = this.player.power === 'small' ? POWERUP.MUSHROOM : types[Math.floor(Math.random() * types.length)];
          this.powerups.push(new PowerupEntity(kind, gx * TILE, gy * TILE, { loose: false }));
        }
      }
    } else if (t === T.BRICK) {
      if (this.player.power !== 'small') {
        this.setTile(gx, gy, T.EMPTY);
        this._spawnParticles(gx * TILE + TILE / 2, gy * TILE + TILE / 2, 8, '#c0723c', 1.4);
        this.floatingTexts.push(new FloatingText(gx * TILE, gy * TILE - 6, '+10', '#fff'));
        this.coinsCollected += 0; // bricks don't give coins but could add score later
      } else {
        this.blockBumps.push({ gx, gy, t: 6 });
      }
    }
  }

  _handleTileInteractions(p) {
    const h = p.height;
    const left = Math.floor(p.x / TILE);
    const right = Math.floor((p.x + p.w) / TILE);
    const top = Math.floor(p.y / TILE);
    const bottom = Math.floor((p.y + h) / TILE);
    for (let gy = top; gy <= bottom; gy++) {
      for (let gx = left; gx <= right; gx++) {
        const t = this.tileAt(gx, gy);
        if (t === T.COIN) {
          this.setTile(gx, gy, T.EMPTY);
          this.coinsCollected++;
          this._spawnParticles(gx * TILE + TILE / 2, gy * TILE + TILE / 2, 4, '#ffd700', 0.8);
          this.floatingTexts.push(new FloatingText(gx * TILE, gy * TILE, '+1', '#ffd700'));
        } else if (this.isHazard(t)) {
          this._hurtPlayer();
        }
      }
    }
  }

  /* ------------------------- ENEMIES ------------------------- */
  _updateEnemies() {
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.squashed) {
        e.squashTimer--;
        if (e.squashTimer <= 0) e.dead = true;
        continue;
      }
      if (e.hitFlash > 0) e.hitFlash--;

      if (e.kind === ENEMY.FLYER) {
        e.floatPhase += 0.05;
        e.y = e.baseY + Math.sin(e.floatPhase) * 24;
        e.x += e.vx;
        if (Math.random() < 0.01) e.vx *= -1;
      } else if (e.kind === ENEMY.BOSS) {
        e.vy += GRAVITY;
        if (e.vy > MAX_FALL_SPEED) e.vy = MAX_FALL_SPEED;
        this._moveAndCollide(e, false);
        // simple boss AI: hop toward player occasionally, shoot fireballs
        const dx = this.player.x - e.x;
        e.dir = dx > 0 ? 1 : -1;
        if (e.onGround) e.vx = e.dir * 1.4;
        e.jumpTimer--;
        if (e.jumpTimer <= 0 && e.onGround) {
          e.vy = JUMP_VELOCITY * 0.9;
          e.jumpTimer = 90 + Math.random() * 60;
        }
        e.shootTimer--;
        if (e.shootTimer <= 0) {
          e.shootTimer = 100;
          this.projectiles.push(new Projectile(e.x + e.w / 2, e.y + e.h / 2, e.dir * 4, -2, 'enemy'));
        }
      } else if (e.kind === ENEMY.SHOOTER) {
        // stationary, shoots at intervals
        e.shootTimer--;
        if (e.shootTimer <= 0) {
          e.shootTimer = 130;
          const dir = this.player.x > e.x ? 1 : -1;
          this.projectiles.push(new Projectile(e.x + e.w / 2, e.y + e.h / 2, dir * 3.2, 0, 'enemy'));
        }
        e.vy += GRAVITY; if (e.vy > MAX_FALL_SPEED) e.vy = MAX_FALL_SPEED;
        this._moveAndCollide(e, false);
      } else if (e.kind === ENEMY.JUMPER) {
        e.jumpTimer--;
        e.vy += GRAVITY; if (e.vy > MAX_FALL_SPEED) e.vy = MAX_FALL_SPEED;
        if (e.onGround && e.jumpTimer <= 0) {
          e.vy = JUMP_VELOCITY * 0.85;
          e.jumpTimer = 70 + Math.random() * 40;
        }
        e.x += e.vx;
        this._moveAndCollide(e, false);
      } else {
        // GOOMBA, SPIKY: simple walkers
        e.vy += GRAVITY; if (e.vy > MAX_FALL_SPEED) e.vy = MAX_FALL_SPEED;
        this._moveAndCollide(e, false);
      }

      // Turn around at ledges (basic ground check) for walkers
      if ((e.kind === ENEMY.GOOMBA || e.kind === ENEMY.SPIKY || e.kind === ENEMY.JUMPER) && e.onGround) {
        const aheadX = e.vx > 0 ? e.x + e.w + 2 : e.x - 2;
        const gx = Math.floor(aheadX / TILE);
        const gy = Math.floor((e.y + e.h + 2) / TILE);
        if (!this.isSolid(this.tileAt(gx, gy)) && this.tileAt(gx,gy) !== T.PLATFORM) {
          e.vx *= -1;
        }
      }

      // despawn if far from player (perf) but keep if within reasonable range
      if (Math.abs(e.x - this.player.x) > 2400) continue;
    }
    this.enemies = this.enemies.filter(e => !e.dead);
  }

  _handleEnemyCollisions() {
    const p = this.player;
    const pRect = { x: p.x, y: p.y, w: p.w, h: p.height };
    for (const e of this.enemies) {
      if (e.dead || e.squashed) continue;
      const eRect = { x: e.x, y: e.y, w: e.w, h: e.h };
      if (!aabbOverlap(pRect, eRect)) continue;

      if (p.invincible > 0) {
        this._killEnemy(e, true);
        continue;
      }

      const stomping = p.vy > 0 && (p.y + p.height - e.h * 0.5) < e.y + e.h * 0.4;
      if (stomping && e.kind !== ENEMY.SPIKY && e.kind !== ENEMY.BOSS) {
        this._killEnemy(e, false);
        p.vy = JUMP_VELOCITY * 0.6;
      } else if (stomping && e.kind === ENEMY.SPIKY) {
        // spiky can't be stomped safely -> hurts player anyway but bounce a little
        this._hurtPlayer();
        p.vy = JUMP_VELOCITY * 0.4;
      } else if (stomping && e.kind === ENEMY.BOSS) {
        e.hp--;
        e.hitFlash = 10;
        p.vy = JUMP_VELOCITY * 0.7;
        this._spawnParticles(e.x + e.w/2, e.y, 10, '#ff4444', 1);
        if (e.hp <= 0) { this._killEnemy(e, true); this._spawnParticles(e.x+e.w/2, e.y+e.h/2, 30, '#ffcc00', 2); }
      } else {
        this._hurtPlayer();
      }
    }
  }

  _killEnemy(e, instant) {
    if (instant) {
      e.dead = true;
      this._spawnParticles(e.x + e.w / 2, e.y + e.h / 2, 8, '#e74c3c', 1.2);
    } else {
      e.squashed = true;
      e.squashTimer = 14;
      this.coinsCollected += 0;
      this.floatingTexts.push(new FloatingText(e.x, e.y, '+50', '#fff'));
    }
  }

  _hurtPlayer() {
    const p = this.player;
    if (p.hurtTimer > 0 || p.invincible > 0 || this.finished) return;
    if (p.power === 'fire') { p.power = 'big'; p.hurtTimer = 90; this._spawnParticles(p.x, p.y, 10, '#ff8844', 1); }
    else if (p.power === 'big') { p.power = 'small'; p.hurtTimer = 90; this._spawnParticles(p.x, p.y, 10, '#88ccff', 1); }
    else {
      this.loseLife();
    }
  }

  loseLife() {
    this.lives--;
    if (this.lives <= 0) { this.loseGame('levens'); }
    else {
      // respawn at start
      const p = this.player;
      p.x = this.level.start.x * TILE;
      p.y = this.level.start.y * TILE;
      p.vx = 0; p.vy = 0;
      p.hurtTimer = 90;
      p.power = 'small';
    }
  }

  loseGame(reason) {
    if (this.finished) return;
    this.finished = true;
    this.won = false;
    this.running = false;
    if (this.onLose) this.onLose(reason);
  }

  winGame() {
    if (this.finished) return;
    this.finished = true;
    this.won = true;
    this.running = false;
    if (this.onWin) this.onWin({ coins: this.coinsCollected, time: this.time });
  }

  /* ------------------------- PROJECTILES ------------------------- */
  _updateProjectiles() {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      pr.vy += (pr.owner === 'player' ? 0.25 : 0.12);
      pr.x += pr.vx; pr.y += pr.vy;
      pr.life--;
      if (pr.life <= 0) { pr.dead = true; continue; }
      const gx = Math.floor((pr.x) / TILE), gy = Math.floor((pr.y) / TILE);
      if (this.isSolid(this.tileAt(gx, gy))) {
        if (pr.owner === 'player') {
          pr.vy = -6; pr.bounces++;
          if (pr.bounces > 3) pr.dead = true;
        } else {
          pr.dead = true;
        }
        this._spawnParticles(pr.x, pr.y, 3, pr.owner === 'player' ? '#ff8844' : '#aa44ff', 0.6);
      }
      if (pr.owner === 'player') {
        for (const e of this.enemies) {
          if (e.dead || e.squashed) continue;
          if (aabbOverlap({ x: pr.x - 6, y: pr.y - 6, w: 12, h: 12 }, { x: e.x, y: e.y, w: e.w, h: e.h })) {
            pr.dead = true;
            if (e.kind === ENEMY.BOSS) {
              e.hp--; e.hitFlash = 10;
              this._spawnParticles(e.x + e.w/2, e.y+e.h/2, 8, '#ff4444', 1);
              if (e.hp <= 0) this._killEnemy(e, true);
            } else {
              this._killEnemy(e, true);
            }
          }
        }
      } else {
        const p = this.player;
        if (aabbOverlap({ x: pr.x - 6, y: pr.y - 6, w: 12, h: 12 }, { x: p.x, y: p.y, w: p.w, h: p.height })) {
          if (p.invincible <= 0) { pr.dead = true; this._hurtPlayer(); }
        }
      }
    }
    this.projectiles = this.projectiles.filter(pr => !pr.dead);
  }

  /* ------------------------- POWERUPS ------------------------- */
  _updatePowerups() {
    for (const pu of this.powerups) {
      if (pu.dead) continue;
      if (pu.emerging) {
        pu.y -= 1;
        if (pu.y <= pu.emergeTarget - TILE) { pu.emerging = false; }
        continue;
      }
      if (pu.kind !== POWERUP.STAR) {
        pu.vy += GRAVITY * 0.7;
        if (pu.vy > MAX_FALL_SPEED) pu.vy = MAX_FALL_SPEED;
      } else {
        pu.vy += GRAVITY * 0.5;
      }
      pu.x += pu.vx;
      this._resolveHorizontalGeneric(pu);
      pu.y += pu.vy;
      this._resolveVerticalGeneric(pu);
      if (pu.kind === POWERUP.STAR) {
        // bounce
        if (pu.onGroundNow) pu.vy = JUMP_VELOCITY * 0.5;
      }
    }
    this.powerups = this.powerups.filter(pu => !pu.dead);
  }

  _resolveHorizontalGeneric(ent) {
    const left = Math.floor(ent.x / TILE), right = Math.floor((ent.x + ent.w) / TILE);
    const top = Math.floor(ent.y / TILE), bottom = Math.floor((ent.y + ent.h) / TILE);
    for (let gy = top; gy <= bottom; gy++) for (let gx = left; gx <= right; gx++) {
      if (this.isSolid(this.tileAt(gx, gy))) {
        const tileRect = { x: gx*TILE, y: gy*TILE, w: TILE, h: TILE };
        if (aabbOverlap({x:ent.x,y:ent.y,w:ent.w,h:ent.h}, tileRect)) {
          ent.vx *= -1;
          ent.x += ent.vx > 0 ? 2 : -2;
        }
      }
    }
  }
  _resolveVerticalGeneric(ent) {
    ent.onGroundNow = false;
    const left = Math.floor(ent.x / TILE), right = Math.floor((ent.x + ent.w) / TILE);
    const top = Math.floor(ent.y / TILE), bottom = Math.floor((ent.y + ent.h) / TILE);
    for (let gy = top; gy <= bottom; gy++) for (let gx = left; gx <= right; gx++) {
      const t = this.tileAt(gx, gy);
      if (this.isSolid(t) || this.isOneWay(t)) {
        const tileRect = { x: gx*TILE, y: gy*TILE, w: TILE, h: TILE };
        if (aabbOverlap({x:ent.x,y:ent.y,w:ent.w,h:ent.h}, tileRect) && ent.vy >= 0) {
          ent.y = tileRect.y - ent.h; ent.vy = 0; ent.onGroundNow = true;
        }
      }
    }
  }

  _handlePowerupCollisions() {
    const p = this.player;
    const pRect = { x: p.x, y: p.y, w: p.w, h: p.height };
    for (const pu of this.powerups) {
      if (pu.dead || pu.emerging) continue;
      if (aabbOverlap(pRect, { x: pu.x, y: pu.y, w: pu.w, h: pu.h })) {
        pu.dead = true;
        this._applyPowerup(pu.kind);
      }
    }
  }

  _applyPowerup(kind) {
    const p = this.player;
    this._spawnParticles(p.x + p.w/2, p.y, 12, '#fff200', 1.4);
    if (kind === POWERUP.MUSHROOM) {
      if (p.power === 'small') p.power = 'big';
      this.floatingTexts.push(new FloatingText(p.x, p.y - 10, 'Groter!', '#e74c3c'));
    } else if (kind === POWERUP.FIRE) {
      p.power = 'fire';
      this.floatingTexts.push(new FloatingText(p.x, p.y - 10, 'Vuur!', '#ff8844'));
    } else if (kind === POWERUP.STAR) {
      p.invincible = 600;
      this.floatingTexts.push(new FloatingText(p.x, p.y - 10, 'Onkwetsbaar!', '#ffd700'));
    } else if (kind === POWERUP.WINGS) {
      p.wings = Math.min(p.wings + 3, 5);
      this.floatingTexts.push(new FloatingText(p.x, p.y - 10, '+Vleugels', '#88ccff'));
    } else if (kind === POWERUP.ONEUP) {
      this.lives++;
      this.floatingTexts.push(new FloatingText(p.x, p.y - 10, '1-UP!', '#2ecc71'));
    }
  }

  /* ------------------------- FLAG / DOOR ------------------------- */
  _handleFlagAndDoor() {
    if (this.flagReached || this.finished) return;
    const p = this.player;
    const gx = Math.floor((p.x + p.w/2) / TILE);
    const gy = Math.floor((p.y + p.height/2) / TILE);
    const t = this.tileAt(gx, gy);
    if (t === T.FLAGPOLE) {
      this.flagReached = true;
      this._spawnParticles(p.x, p.y, 20, '#fff200', 2);
      setTimeout(() => this.winGame(), 500);
    } else if (t === T.DOOR) {
      // Boss levels: door only "wins" once boss is dead
      const bossAlive = this.enemies.some(e => e.kind === ENEMY.BOSS && !e.dead);
      if (!bossAlive) {
        this.flagReached = true;
        this._spawnParticles(p.x, p.y, 20, '#ffd700', 2);
        setTimeout(() => this.winGame(), 400);
      }
    }
  }

  /* ------------------------- CAMERA / FX ------------------------- */
  _updateCamera() {
    const p = this.player;
    const targetX = p.x - this.canvas.width / (2 * this._scale());
    this.camera.x += (targetX - this.camera.x) * 0.14;
    this.camera.x = clamp(this.camera.x, 0, Math.max(0, this.level.width * TILE - this.canvas.width / this._scale()));
    this.camera.y = 0;
  }
  _scale() { return 1; }

  _spawnParticles(x, y, count, color, speed) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (0.5 + Math.random() * 2) * (speed || 1);
      this.particles.push(new Particle(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd - 1, color, 20 + Math.random()*15, 3+Math.random()*3));
    }
  }
  _updateParticles() {
    for (const pt of this.particles) {
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.15; pt.life--;
    }
    this.particles = this.particles.filter(pt => pt.life > 0);
    for (const ft of this.floatingTexts) { ft.y += ft.vy; ft.life--; }
    this.floatingTexts = this.floatingTexts.filter(ft => ft.life > 0);
  }

  /* ============================ RENDERING ============================ */
  render() {
    const ctx = this.ctx;
    const cw = this.canvas.width, ch = this.canvas.height;
    if (!this.level) return;
    const colors = THEME_COLORS[this.level.theme] || THEME_COLORS.grass;

    // Sky gradient
    const grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, colors.sky1);
    grad.addColorStop(1, colors.sky2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);

    // Parallax background hills/stars
    this._renderParallax(colors);

    ctx.save();
    ctx.translate(-this.camera.x, -this.camera.y);

    const startCol = Math.max(0, Math.floor(this.camera.x / TILE) - 1);
    const endCol = Math.min(this.level.width - 1, Math.ceil((this.camera.x + cw) / TILE) + 1);

    // Tiles
    for (let gy = 0; gy < this.level.height; gy++) {
      for (let gx = startCol; gx <= endCol; gx++) {
        const t = this.level.grid[gy][gx];
        if (t === T.EMPTY) continue;
        this._drawTile(t, gx, gy, colors);
      }
    }

    // Powerups
    for (const pu of this.powerups) this._drawPowerup(pu);

    // Enemies
    for (const e of this.enemies) this._drawEnemy(e);

    // Projectiles
    for (const pr of this.projectiles) {
      ctx.fillStyle = pr.owner === 'player' ? '#ff5500' : '#aa22ff';
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Particles
    for (const pt of this.particles) {
      ctx.globalAlpha = clamp(pt.life / 20, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size/2, pt.y - pt.size/2, pt.size, pt.size);
      ctx.globalAlpha = 1;
    }

    // Player
    this._drawPlayer();

    // Floating texts
    ctx.font = 'bold 14px Trebuchet MS';
    ctx.textAlign = 'center';
    for (const ft of this.floatingTexts) {
      ctx.globalAlpha = clamp(ft.life / 45, 0, 1);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x + 12, ft.y);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  _renderParallax(colors) {
    const ctx = this.ctx;
    const cw = this.canvas.width, ch = this.canvas.height;
    const offset = this.camera.x * 0.3;
    ctx.fillStyle = colors.accent;
    ctx.globalAlpha = 0.35;
    for (let i = -1; i < 8; i++) {
      const hx = (i * 220 - (offset % 220));
      ctx.beginPath();
      ctx.ellipse(hx, ch - 60, 140, 90, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.level.theme === 'night') {
      ctx.fillStyle = '#fff';
      const starOffset = this.camera.x * 0.1;
      for (let i = 0; i < 40; i++) {
        const sx = (i * 53 - starOffset % 1000 + 1000) % (cw + 100) - 20;
        const sy = (i * 97) % (ch * 0.6);
        ctx.globalAlpha = 0.4 + 0.4 * Math.sin(i + Date.now()/500);
        ctx.fillRect(sx, sy, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  _bumpOffset(gx, gy) {
    const b = this.blockBumps.find(b => b.gx === gx && b.gy === gy);
    if (!b) return 0;
    return -Math.sin((b.t / 8) * Math.PI) * 6;
  }

  _drawTile(t, gx, gy, colors) {
    const ctx = this.ctx;
    const x = gx * TILE, y = gy * TILE;
    const bump = this._bumpOffset(gx, gy);
    const dy = y + bump;
    switch (t) {
      case T.GROUND:
        ctx.fillStyle = colors.ground;
        ctx.fillRect(x, dy, TILE, TILE);
        ctx.fillStyle = colors.groundTop;
        ctx.fillRect(x, dy, TILE, 6);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.strokeRect(x + 0.5, dy + 0.5, TILE - 1, TILE - 1);
        break;
      case T.ICE_BLOCK:
        ctx.fillStyle = colors.groundTop;
        ctx.fillRect(x, dy, TILE, TILE);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.strokeRect(x + 2, dy + 2, TILE - 4, TILE - 4);
        break;
      case T.BRICK:
        ctx.fillStyle = colors.brick;
        ctx.fillRect(x, dy, TILE, TILE);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.moveTo(x, dy + TILE/2); ctx.lineTo(x+TILE, dy+TILE/2);
        ctx.moveTo(x+TILE/2, dy); ctx.lineTo(x+TILE/2, dy+TILE/2);
        ctx.moveTo(x+TILE/4, dy+TILE/2); ctx.lineTo(x+TILE/4, dy+TILE);
        ctx.moveTo(x+3*TILE/4, dy+TILE/2); ctx.lineTo(x+3*TILE/4, dy+TILE);
        ctx.stroke();
        break;
      case T.QUESTION:
      case T.QUESTION_POWER:
        ctx.fillStyle = '#f5b700';
        ctx.fillRect(x, dy, TILE, TILE);
        ctx.strokeStyle = '#a06e00';
        ctx.strokeRect(x+2, dy+2, TILE-4, TILE-4);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px Trebuchet MS';
        ctx.textAlign = 'center';
        ctx.fillText(t === T.QUESTION_POWER ? '★' : '?', x + TILE/2, dy + TILE/2 + 7);
        break;
      case T.PIPE:
        ctx.fillStyle = colors.accent;
        ctx.fillRect(x+2, dy, TILE-4, TILE);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x+4, dy, 5, TILE);
        break;
      case T.SPIKE:
        ctx.fillStyle = '#888';
        ctx.beginPath();
        ctx.moveTo(x, y+TILE); ctx.lineTo(x+TILE/2, y+TILE-22); ctx.lineTo(x+TILE, y+TILE);
        ctx.closePath(); ctx.fill();
        break;
      case T.COIN:
        ctx.save();
        ctx.translate(x+TILE/2, y+TILE/2);
        const scaleX = Math.abs(Math.sin(Date.now()/200 + gx));
        ctx.scale(Math.max(0.2, scaleX), 1);
        ctx.fillStyle = '#ffd700';
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fff7c2';
        ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI*2); ctx.fill();
        ctx.restore();
        break;
      case T.PLATFORM:
        ctx.fillStyle = colors.brick;
        ctx.fillRect(x, dy+TILE*0.35, TILE, TILE*0.3);
        break;
      case T.FLAGPOLE:
        ctx.fillStyle = '#ccc';
        ctx.fillRect(x+TILE/2-2, y, 4, TILE);
        ctx.fillStyle = '#2ecc71';
        ctx.beginPath();
        ctx.moveTo(x+TILE/2+2, y+4);
        ctx.lineTo(x+TILE/2+22, y+12);
        ctx.lineTo(x+TILE/2+2, y+20);
        ctx.closePath(); ctx.fill();
        break;
      case T.CLOUD_BLOCK:
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x+TILE/2, dy+TILE/2, TILE/2, 0, Math.PI*2); ctx.fill();
        break;
      case T.BOUNCE:
        ctx.fillStyle = '#ff69b4';
        ctx.fillRect(x, dy+TILE*0.6, TILE, TILE*0.4);
        ctx.strokeStyle = '#c2185b';
        ctx.strokeRect(x, dy+TILE*0.6, TILE, TILE*0.4);
        break;
      case T.DOOR:
        ctx.fillStyle = '#3a2a1a';
        ctx.fillRect(x+4, dy, TILE-8, TILE+2);
        ctx.fillStyle = '#ffd700';
        ctx.beginPath(); ctx.arc(x+TILE-10, dy+TILE/2, 2, 0, Math.PI*2); ctx.fill();
        break;
      case T.STAIR:
        ctx.fillStyle = colors.ground;
        ctx.fillRect(x, dy, TILE, TILE);
        ctx.fillStyle = colors.groundTop;
        ctx.fillRect(x, dy, TILE, 5);
        break;
      case T.LAVA:
        ctx.fillStyle = '#ff4400';
        ctx.fillRect(x, dy, TILE, TILE);
        ctx.fillStyle = '#ffaa00';
        ctx.fillRect(x, dy, TILE, 4);
        break;
      default:
        ctx.fillStyle = '#999';
        ctx.fillRect(x, dy, TILE, TILE);
    }
  }

  _drawPowerup(pu) {
    const ctx = this.ctx;
    const cx = pu.x + pu.w/2, cy = pu.y + pu.h/2;
    if (pu.kind === POWERUP.MUSHROOM) {
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath(); ctx.arc(cx, cy - 2, 12, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx-10, cy-2, 20, 10);
      ctx.fillStyle = '#fff';
      [[-6,-4],[0,-8],[6,-4]].forEach(([dx,dy])=>{ctx.beginPath();ctx.arc(cx+dx,cy+dy,2.5,0,Math.PI*2);ctx.fill();});
    } else if (pu.kind === POWERUP.FIRE) {
      ctx.fillStyle = '#ff8c00';
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffdd55';
      ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI*2); ctx.fill();
    } else if (pu.kind === POWERUP.STAR) {
      this._drawStar(cx, cy, 11, '#ffd700');
    } else if (pu.kind === POWERUP.WINGS) {
      ctx.fillStyle = '#88ccff';
      ctx.beginPath(); ctx.ellipse(cx-8, cy, 9, 5, -0.3, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx+8, cy, 9, 5, 0.3, 0, Math.PI*2); ctx.fill();
    } else if (pu.kind === POWERUP.ONEUP) {
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font='bold 12px Trebuchet MS'; ctx.textAlign='center';
      ctx.fillText('1UP', cx, cy+4);
    }
  }

  _drawStar(cx, cy, r, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (Math.PI / 5) * i - Math.PI/2 + Date.now()/300;
      const rad = i % 2 === 0 ? r : r/2.2;
      const px = cx + Math.cos(ang)*rad, py = cy + Math.sin(ang)*rad;
      if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.closePath(); ctx.fill();
  }

  _drawEnemy(e) {
    const ctx = this.ctx;
    if (e.dead) return;
    ctx.save();
    if (e.hitFlash > 0 && e.hitFlash % 4 < 2) ctx.globalAlpha = 0.4;
    const squash = e.squashed ? 0.3 : 1;
    const cx = e.x + e.w/2, cy = e.y + e.h - (e.h*squash)/2;
    ctx.translate(cx, cy);
    if (e.vx < 0 || e.dir < 0) ctx.scale(-1, 1);

    const colorMap = {
      [ENEMY.GOOMBA]: '#8b4513',
      [ENEMY.FLYER]: '#9b59b6',
      [ENEMY.SPIKY]: '#555',
      [ENEMY.SHOOTER]: '#2c3e50',
      [ENEMY.JUMPER]: '#16a085',
      [ENEMY.BOSS]: '#c0392b',
    };
    ctx.fillStyle = colorMap[e.kind] || '#999';
    const w = e.w, h = e.h * squash;
    ctx.beginPath();
    ctx.ellipse(0, 0, w/2, h/2, 0, 0, Math.PI*2);
    ctx.fill();

    // eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(w*0.12, -h*0.1, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(w*0.16, -h*0.1, 2, 0, Math.PI*2); ctx.fill();

    if (e.kind === ENEMY.SPIKY) {
      ctx.fillStyle = '#222';
      for (let i=-2;i<=2;i++) {
        ctx.beginPath();
        ctx.moveTo(i*6, -h/2);
        ctx.lineTo(i*6-3, -h/2-8);
        ctx.lineTo(i*6+3, -h/2-8);
        ctx.closePath(); ctx.fill();
      }
    }
    if (e.kind === ENEMY.FLYER) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      const flap = Math.sin(Date.now()/80) * 8;
      ctx.beginPath(); ctx.ellipse(-w*0.4, -flap, 10, 5, 0.4, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(w*0.4, flap, 10, 5, -0.4, 0, Math.PI*2); ctx.fill();
    }
    if (e.kind === ENEMY.BOSS) {
      ctx.font = 'bold 10px Trebuchet MS'; ctx.fillStyle='#fff'; ctx.textAlign='center';
      ctx.fillText('HP ' + e.hp, 0, -h/2 - 10);
    }
    ctx.restore();
  }

  _drawPlayer() {
    const p = this.player;
    const ctx = this.ctx;
    if (p.hurtTimer > 0 && p.hurtTimer % 6 < 3) return; // blink when hurt
    ctx.save();
    const cx = p.x + p.w/2, cy = p.y + p.height/2;
    ctx.translate(cx, cy);
    if (p.facing < 0) ctx.scale(-1, 1);

    if (p.invincible > 0) {
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 18;
    }

    let bodyColor = '#e74c3c';
    if (p.power === 'fire') bodyColor = '#ffffff';
    if (p.power === 'big') bodyColor = '#3498db';

    const bw = p.w, bh = p.height;
    // legs (simple walk animation)
    const legOffset = (p.onGround && Math.abs(p.vx) > 0.3) ? Math.sin(p.animFrame) * 4 : 0;
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(-bw*0.3, bh*0.28 + legOffset, bw*0.28, bh*0.22);
    ctx.fillRect(bw*0.02, bh*0.28 - legOffset, bw*0.28, bh*0.22);

    // body
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-bw/2, -bh/2 + bh*0.15, bw, bh*0.5);
    // head
    ctx.fillStyle = '#ffd9a0';
    ctx.beginPath(); ctx.arc(bw*0.05, -bh*0.28, bw*0.42, 0, Math.PI*2); ctx.fill();
    // cap
    ctx.fillStyle = p.power === 'fire' ? '#ff4444' : (p.power === 'big' ? '#1a5276' : '#c0392b');
    ctx.beginPath(); ctx.arc(bw*0.05, -bh*0.36, bw*0.42, Math.PI, 0); ctx.fill();
    ctx.fillRect(bw*0.15, -bh*0.4, bw*0.4, bh*0.1);
    // eye
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(bw*0.22, -bh*0.26, 2.4, 0, Math.PI*2); ctx.fill();

    // wings indicator
    if (p.wings > 0) {
      ctx.fillStyle = 'rgba(136,204,255,0.8)';
      ctx.beginPath(); ctx.ellipse(-bw*0.55, 0, 8, 14, 0.3, 0, Math.PI*2); ctx.fill();
    }

    ctx.restore();
  }
}

/* =========================================================================
   SAVE DATA / PROGRESS
   ========================================================================= */
const SAVE_KEY = 'blockcraft_progress_v1';
const CUSTOM_LEVELS_KEY = 'blockcraft_custom_levels_v1';

function loadProgress() {
  return loadJSON(SAVE_KEY, { unlocked: 1, stars: {} }); // unlocked = highest level index+1 reachable
}
function saveProgress(p) { saveJSON(SAVE_KEY, p); }

function loadCustomLevels() { return loadJSON(CUSTOM_LEVELS_KEY, []); }
function saveCustomLevels(list) { saveJSON(CUSTOM_LEVELS_KEY, list); }

/* =========================================================================
   APP CONTROLLER — wires up screens, menus, editor & game
   ========================================================================= */
const App = {
  screens: {},
  currentWorld: 0,
  editorState: null,
  playSource: null, // {type:'campaign', index} or {type:'custom', data}

  init() {
    this.screens = {
      menu: document.getElementById('menu-screen'),
      levelSelect: document.getElementById('level-select-screen'),
      game: document.getElementById('game-screen'),
      editor: document.getElementById('editor-screen'),
    };
    this._buildClouds();
    this._bindMenu();
    this._bindLevelSelect();
    this._bindGameScreen();
    this._bindEditor();
    this.showScreen('menu');
  },

  showScreen(name) {
    Object.values(this.screens).forEach(s => s.classList.remove('active'));
    this.screens[name].classList.add('active');
  },

  _buildClouds() {
    const container = document.getElementById('clouds-container');
    for (let i = 0; i < 6; i++) {
      const c = document.createElement('div');
      c.className = 'cloud';
      const w = 60 + Math.random() * 80, h = w * 0.4;
      c.style.width = w + 'px'; c.style.height = h + 'px';
      c.style.top = (10 + Math.random() * 60) + '%';
      c.style.animationDuration = (18 + Math.random() * 20) + 's';
      c.style.animationDelay = (-Math.random() * 20) + 's';
      container.appendChild(c);
    }
  },

  /* --------------------------- MENU --------------------------- */
  _bindMenu() {
    document.getElementById('btn-play').addEventListener('click', () => {
      this.openLevelSelect('campaign');
    });
    document.getElementById('btn-editor').addEventListener('click', () => {
      this.openEditor(null);
    });
    document.getElementById('btn-mylevels').addEventListener('click', () => {
      this.openLevelSelect('custom');
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      if (confirm('Weet je zeker dat je alle voortgang wilt resetten?')) {
        saveProgress({ unlocked: 1, stars: {} });
        alert('Voortgang gereset!');
      }
    });
  },

  /* --------------------------- LEVEL SELECT --------------------------- */
  openLevelSelect(mode) {
    this.levelSelectMode = mode;
    document.getElementById('ls-title').textContent = mode === 'campaign' ? 'Avontuur — Kies een level' : 'Mijn Levels';
    document.getElementById('world-tabs').innerHTML = '';
    document.getElementById('world-tabs').style.display = mode === 'campaign' ? 'flex' : 'none';
    if (mode === 'campaign') {
      WORLD_THEMES.forEach((w, i) => {
        const tab = document.createElement('div');
        tab.className = 'world-tab' + (i === this.currentWorld ? ' active' : '');
        tab.textContent = `Wereld ${w.id}: ${w.name}`;
        tab.addEventListener('click', () => { this.currentWorld = i; this._renderLevelGrid(); });
        document.getElementById('world-tabs').appendChild(tab);
      });
    }
    this._renderLevelGrid();
    this.showScreen('levelSelect');
  },

  _renderLevelGrid() {
    const grid = document.getElementById('level-grid');
    grid.innerHTML = '';
    const progress = loadProgress();
    if (this.levelSelectMode === 'campaign') {
      const startIdx = this.currentWorld * 5;
      for (let i = startIdx; i < startIdx + 5; i++) {
        const level = CAMPAIGN_LEVELS[i];
        const locked = i > progress.unlocked;
        const tile = document.createElement('div');
        tile.className = 'level-tile' + (locked ? ' locked' : '');
        const starCount = progress.stars[i] || 0;
        tile.innerHTML = locked
          ? `<div class="lock-icon">🔒</div><div style="font-size:12px">${i+1}</div>`
          : `<div>${level.isBoss ? '👑' : i+1}</div><div class="stars">${'★'.repeat(starCount)}${'☆'.repeat(3-starCount)}</div>`;
        if (!locked) {
          tile.addEventListener('click', () => this.startCampaignLevel(i));
        }
        grid.appendChild(tile);
      }
    } else {
      const customs = loadCustomLevels();
      if (customs.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color:#aaa; padding:40px;">Je hebt nog geen levels gemaakt.<br>Ga naar de Level Editor om je eerste level te bouwen! 🛠</div>';
      } else {
        customs.forEach((lvl, idx) => {
          const tile = document.createElement('div');
          tile.className = 'level-tile custom-tile';
          tile.innerHTML = `<div>🧩</div><div style="font-size:11px; padding:0 4px; text-align:center;">${lvl.name}</div>`;
          tile.addEventListener('click', () => this.startCustomLevel(idx));
          tile.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (confirm(`Level "${lvl.name}" verwijderen?`)) {
              const list = loadCustomLevels();
              list.splice(idx, 1);
              saveCustomLevels(list);
              this._renderLevelGrid();
            }
          });
          grid.appendChild(tile);
        });
      }
    }
  },

  _bindLevelSelect() {
    document.getElementById('ls-back').addEventListener('click', () => this.showScreen('menu'));
  },

  /* --------------------------- GAME SCREEN --------------------------- */
  _bindGameScreen() {
    const canvas = document.getElementById('game-canvas');
    this.game = new Game(canvas);
    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());

    this.game.onWin = (result) => this._onLevelWin(result);
    this.game.onLose = (reason) => this._onLevelLose(reason);

    document.getElementById('pause-btn').addEventListener('click', () => this._togglePause());

    // mobile controls
    const bind = (id, prop) => {
      const el = document.getElementById(id);
      const set = (v) => { this.game[prop] = v; };
      el.addEventListener('touchstart', (e) => { e.preventDefault(); set(true); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); set(false); }, { passive: false });
      el.addEventListener('mousedown', () => set(true));
      el.addEventListener('mouseup', () => set(false));
      el.addEventListener('mouseleave', () => set(false));
    };
    bind('btn-left', 'virtualLeft');
    bind('btn-right', 'virtualRight');
    bind('jump-btn', 'virtualJump');
    bind('btn-fire', 'virtualFire');

    // double-tap jump button for wings while airborne
    let lastJumpTap = 0;
    document.getElementById('jump-btn').addEventListener('touchstart', () => {
      const now = Date.now();
      if (now - lastJumpTap < 300) this.game.requestWingJump();
      lastJumpTap = now;
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.game.player?.onGround) {
        if (this._spaceDoubleTimer && Date.now() - this._spaceDoubleTimer < 300) {
          this.game.requestWingJump();
        }
        this._spaceDoubleTimer = Date.now();
      }
      if (e.code === 'Escape') this._togglePause();
    });

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  },

  _resizeCanvas() {
    const canvas = document.getElementById('game-canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  },

  startCampaignLevel(index) {
    this.playSource = { type: 'campaign', index };
    this.game.loadLevel(CAMPAIGN_LEVELS[index]);
    document.getElementById('hud-level-name').textContent = CAMPAIGN_LEVELS[index].name;
    this.showScreen('game');
    document.getElementById('message-overlay').classList.remove('active');
  },

  startCustomLevel(idx) {
    const customs = loadCustomLevels();
    const data = customs[idx];
    if (!data) return;
    this.playSource = { type: 'custom', index: idx };
    const level = this._hydrateCustomLevel(data);
    this.game.loadLevel(level);
    document.getElementById('hud-level-name').textContent = data.name;
    this.showScreen('game');
    document.getElementById('message-overlay').classList.remove('active');
  },

  playTestLevel(levelData) {
    this.playSource = { type: 'test' };
    this.game.loadLevel(levelData);
    document.getElementById('hud-level-name').textContent = levelData.name + ' (test)';
    this.showScreen('game');
    document.getElementById('message-overlay').classList.remove('active');
  },

  _hydrateCustomLevel(data) {
    // data.grid is stored as array of strings for compactness; convert back
    const grid = data.grid.map(row => row.split(',').map(Number));
    return {
      id: 'custom',
      name: data.name,
      width: data.width,
      height: grid.length,
      theme: data.theme,
      isBoss: false,
      grid,
      entities: data.entities,
      start: data.start || { x: 2, y: grid.length - 5 },
      timeLimit: 400,
    };
  },

  _loop(t) {
    const dt = this._lastT ? Math.min(2, (t - this._lastT) / (1000 / 60)) : 1;
    this._lastT = t;
    if (this.screens.game.classList.contains('active')) {
      this.game.update(dt);
      this.game.render();
      document.getElementById('hud-lives').textContent = this.game.lives;
      document.getElementById('hud-coins').textContent = this.game.coinsCollected;
    }
    requestAnimationFrame(this._loop);
  },

  _togglePause() {
    if (!this.game.running) return;
    this.game.paused = !this.game.paused;
    if (this.game.paused) {
      this._showMessage('⏸ Gepauzeerd', '', [
        { label: '▶ Verder', action: () => this._hideMessage() },
        { label: '🏠 Menu', action: () => { this._hideMessage(); this.showScreen('menu'); } },
      ]);
    } else {
      this._hideMessage();
    }
  },

  _onLevelWin(result) {
    let starText = '';
    if (this.playSource.type === 'campaign') {
      const progress = loadProgress();
      const idx = this.playSource.index;
      progress.unlocked = Math.max(progress.unlocked, idx + 1);
      const stars = result.coins >= 15 ? 3 : result.coins >= 8 ? 2 : 1;
      progress.stars[idx] = Math.max(progress.stars[idx] || 0, stars);
      saveProgress(progress);
      starText = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    }
    const backLabel = this.playSource.type === 'test' ? '🛠 Terug naar editor' : '🏠 Menu';
    const backAction = this.playSource.type === 'test'
      ? () => { this._hideMessage(); this.showScreen('editor'); }
      : () => { this._hideMessage(); this.showScreen('menu'); };
    const buttons = [];
    if (this.playSource.type === 'campaign' && this.playSource.index < 39) {
      buttons.push({ label: 'Volgend level ▶', action: () => { this._hideMessage(); this.startCampaignLevel(this.playSource.index + 1); } });
    }
    buttons.push({ label: '🔁 Opnieuw', action: () => { this._hideMessage(); this._replay(); } });
    buttons.push({ label: backLabel, action: backAction });

    this._showMessage('🏆 Level voltooid!', `Munten: ${result.coins}  ${starText}`, buttons);
  },

  _onLevelLose(reason) {
    const msg = reason === 'tijd' ? 'De tijd is op!' : reason === 'val' ? 'Je bent gevallen!' : 'Je hebt geen levens meer!';
    const backLabel = this.playSource.type === 'test' ? '🛠 Terug naar editor' : '🏠 Menu';
    const backAction = this.playSource.type === 'test'
      ? () => { this._hideMessage(); this.showScreen('editor'); }
      : () => { this._hideMessage(); this.showScreen('menu'); };
    this._showMessage('💀 Game Over', msg, [
      { label: '🔁 Opnieuw', action: () => { this._hideMessage(); this._replay(); } },
      { label: backLabel, action: backAction },
    ]);
  },

  _replay() {
    if (this.playSource.type === 'campaign') this.startCampaignLevel(this.playSource.index);
    else if (this.playSource.type === 'custom') this.startCustomLevel(this.playSource.index);
    else if (this.playSource.type === 'test') this.playTestLevel(this.game.level);
  },

  _showMessage(title, sub, buttons) {
    const overlay = document.getElementById('message-overlay');
    document.getElementById('message-title').textContent = title;
    document.getElementById('message-sub').textContent = sub;
    const btnContainer = document.getElementById('message-buttons');
    btnContainer.innerHTML = '';
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'big-btn';
      el.style.fontSize = '15px';
      el.style.padding = '10px 16px';
      el.textContent = b.label;
      el.addEventListener('click', b.action);
      btnContainer.appendChild(el);
    });
    overlay.classList.add('active');
  },
  _hideMessage() {
    document.getElementById('message-overlay').classList.remove('active');
    this.game.paused = false;
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());

/* =========================================================================
   LEVEL EDITOR
   ========================================================================= */
const EDITOR_PALETTE = [
  { section: 'Speciaal' },
  { tile: T.START, icon: '🚩', label: 'Start', isSpecial: 'start' },
  { tile: T.FLAGPOLE, icon: '🏁', label: 'Vlag', isSpecial: 'flag' },
  { section: 'Blokken' },
  { tile: T.GROUND, icon: '🟫', label: 'Grond' },
  { tile: T.BRICK, icon: '🧱', label: 'Baksteen' },
  { tile: T.QUESTION, icon: '❓', label: 'Muntblok' },
  { tile: T.QUESTION_POWER, icon: '⭐', label: 'Powerblok' },
  { tile: T.PLATFORM, icon: '➖', label: 'Platform' },
  { tile: T.ICE_BLOCK, icon: '🧊', label: 'IJs' },
  { tile: T.CLOUD_BLOCK, icon: '☁️', label: 'Wolk' },
  { tile: T.PIPE, icon: '🟩', label: 'Pijp' },
  { tile: T.STAIR, icon: '🔼', label: 'Trap' },
  { section: 'Gevaar' },
  { tile: T.SPIKE, icon: '🔺', label: 'Stekels' },
  { tile: T.LAVA, icon: '🌋', label: 'Lava' },
  { tile: T.BOUNCE, icon: '🎯', label: 'Trampoline' },
  { section: 'Items' },
  { tile: T.COIN, icon: '🪙', label: 'Munt' },
  { section: 'Vijanden' },
  { entity: ENEMY.GOOMBA, icon: '🍄', label: 'Loper' },
  { entity: ENEMY.JUMPER, icon: '🐸', label: 'Springer' },
  { entity: ENEMY.FLYER, icon: '🦇', label: 'Vlieger' },
  { entity: ENEMY.SPIKY, icon: '🦔', label: 'Stekelig' },
  { entity: ENEMY.SHOOTER, icon: '🗿', label: 'Schutter' },
  { entity: ENEMY.BOSS, icon: '👹', label: 'BAAS' },
  { section: 'Power-ups' },
  { powerup: POWERUP.MUSHROOM, icon: '🍄', label: 'Paddo' },
  { powerup: POWERUP.FIRE, icon: '🔥', label: 'Vuur' },
  { powerup: POWERUP.STAR, icon: '✨', label: 'Ster' },
  { powerup: POWERUP.WINGS, icon: '🪽', label: 'Vleugels' },
  { powerup: POWERUP.ONEUP, icon: '💚', label: '1-UP' },
  { section: 'Wissen' },
  { tile: T.EMPTY, icon: '🚫', label: 'Wissen' },
];

class LevelEditor {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 60;
    this.height = 18;
    this.theme = 'grass';
    this.name = 'Mijn level';
    this.grid = this._emptyGrid();
    this.entities = []; // {type:'enemy'|'powerup', kind, x, y} in pixel coords
    this.start = { x: 2, y: this.height - 5 };
    this.selected = EDITOR_PALETTE.find(p => p.tile === T.GROUND);
    this.scroll = 0;
    this.zoom = 1;
    this._bindInput();
  }

  _emptyGrid() {
    const g = [];
    for (let y = 0; y < this.height; y++) g.push(new Array(this.width).fill(T.EMPTY));
    // simple default ground row
    for (let x = 0; x < this.width; x++) g[this.height - 3][x] = T.GROUND;
    for (let y = this.height - 2; y < this.height; y++) for (let x = 0; x < this.width; x++) g[y][x] = T.GROUND;
    return g;
  }

  resize(newWidth) {
    const g = [];
    for (let y = 0; y < this.height; y++) {
      const row = new Array(newWidth).fill(T.EMPTY);
      for (let x = 0; x < Math.min(newWidth, this.width); x++) row[x] = this.grid[y][x];
      g.push(row);
    }
    this.width = newWidth;
    this.grid = g;
    this.entities = this.entities.filter(e => e.x < newWidth * TILE);
  }

  clear() {
    this.grid = this._emptyGrid();
    this.entities = [];
    this.start = { x: 2, y: this.height - 5 };
  }

  _bindInput() {
    const canvas = this.canvas;
    let painting = false;
    let erasing = false;

    const getGridPos = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left) / this.zoom + this.scroll;
      const y = (clientY - rect.top) / this.zoom;
      return { gx: Math.floor(x / TILE), gy: Math.floor(y / TILE) };
    };

    const paint = (gx, gy, erase) => {
      if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return;
      const sel = this.selected;
      if (!sel) return;
      if (erase) {
        this.grid[gy][gx] = T.EMPTY;
        this.entities = this.entities.filter(e => !(Math.floor(e.x/TILE) === gx && Math.floor(e.y/TILE) === gy));
        return;
      }
      if (sel.isSpecial === 'start') {
        this.start = { x: gx, y: gy };
      } else if (sel.entity) {
        this.entities = this.entities.filter(e => !(e.type === 'enemy' && Math.floor(e.x/TILE) === gx && Math.floor(e.y/TILE) === gy));
        this.entities.push({ type: 'enemy', kind: sel.entity, x: gx * TILE, y: gy * TILE });
      } else if (sel.powerup) {
        this.entities = this.entities.filter(e => !(e.type === 'powerup' && Math.floor(e.x/TILE) === gx && Math.floor(e.y/TILE) === gy));
        this.entities.push({ type: 'powerup', kind: sel.powerup, x: gx * TILE, y: gy * TILE, loose: true });
      } else {
        this.grid[gy][gx] = sel.tile;
      }
    };

    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      painting = true;
      erasing = e.button === 2;
      const { gx, gy } = getGridPos(e.clientX, e.clientY);
      paint(gx, gy, erasing);
    });
    canvas.addEventListener('mousemove', (e) => {
      if (!painting) return;
      const { gx, gy } = getGridPos(e.clientX, e.clientY);
      paint(gx, gy, erasing);
    });
    window.addEventListener('mouseup', () => { painting = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // touch support
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      const { gx, gy } = getGridPos(t.clientX, t.clientY);
      painting = true;
      paint(gx, gy, false);
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!painting) return;
      const t = e.touches[0];
      const { gx, gy } = getGridPos(t.clientX, t.clientY);
      paint(gx, gy, false);
    }, { passive: false });
    canvas.addEventListener('touchend', () => { painting = false; });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scroll += e.deltaY > 0 ? 40 : -40;
      this.scroll = clamp(this.scroll, 0, Math.max(0, this.width * TILE - canvas.width));
    }, { passive: false });
  }

  render() {
    const ctx = this.ctx;
    const cw = this.canvas.width, ch = this.canvas.height;
    const colors = THEME_COLORS[this.theme] || THEME_COLORS.grass;
    const grad = ctx.createLinearGradient(0,0,0,ch);
    grad.addColorStop(0, colors.sky1); grad.addColorStop(1, colors.sky2);
    ctx.fillStyle = grad; ctx.fillRect(0,0,cw,ch);

    ctx.save();
    ctx.translate(-this.scroll, 0);

    // grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    const startCol = Math.floor(this.scroll / TILE);
    const endCol = Math.ceil((this.scroll + cw) / TILE);
    for (let gx = startCol; gx <= endCol; gx++) {
      ctx.beginPath(); ctx.moveTo(gx*TILE, 0); ctx.lineTo(gx*TILE, this.height*TILE); ctx.stroke();
    }
    for (let gy = 0; gy <= this.height; gy++) {
      ctx.beginPath(); ctx.moveTo(startCol*TILE, gy*TILE); ctx.lineTo(endCol*TILE, gy*TILE); ctx.stroke();
    }

    // tiles
    for (let gy = 0; gy < this.height; gy++) {
      for (let gx = startCol; gx <= endCol && gx < this.width; gx++) {
        if (gx < 0) continue;
        const t = this.grid[gy][gx];
        if (t !== T.EMPTY) this._drawEditorTile(t, gx, gy, colors);
      }
    }

    // entities
    for (const ent of this.entities) {
      const cx = ent.x + TILE/2, cy = ent.y + TILE/2;
      ctx.font = '22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let icon = '❓';
      if (ent.type === 'enemy') icon = EDITOR_PALETTE.find(p => p.entity === ent.kind)?.icon || '👾';
      if (ent.type === 'powerup') icon = EDITOR_PALETTE.find(p => p.powerup === ent.kind)?.icon || '⭐';
      ctx.fillText(icon, cx, cy);
    }

    // start marker
    ctx.font = '26px sans-serif';
    ctx.fillText('🚩', this.start.x * TILE + TILE/2, this.start.y * TILE + TILE/2);

    ctx.restore();
  }

  _drawEditorTile(t, gx, gy, colors) {
    const ctx = this.ctx;
    const x = gx*TILE, y = gy*TILE;
    const iconMap = {
      [T.GROUND]: null, [T.BRICK]: '🧱', [T.QUESTION]: '❓', [T.QUESTION_POWER]: '⭐',
      [T.PIPE]: null, [T.SPIKE]: '🔺', [T.COIN]: '🪙', [T.PLATFORM]: null,
      [T.FLAGPOLE]: '🏁', [T.CLOUD_BLOCK]: '☁️', [T.ICE_BLOCK]: null, [T.LAVA]: '🌋',
      [T.BOUNCE]: '🎯', [T.DOOR]: '🚪', [T.STAIR]: null,
    };
    if (t === T.GROUND) { ctx.fillStyle = colors.ground; ctx.fillRect(x,y,TILE,TILE); ctx.fillStyle=colors.groundTop; ctx.fillRect(x,y,TILE,5); }
    else if (t === T.ICE_BLOCK) { ctx.fillStyle = colors.groundTop; ctx.fillRect(x,y,TILE,TILE); }
    else if (t === T.PIPE) { ctx.fillStyle = colors.accent; ctx.fillRect(x+2,y,TILE-4,TILE); }
    else if (t === T.PLATFORM) { ctx.fillStyle = colors.brick; ctx.fillRect(x,y+TILE*0.35,TILE,TILE*0.3); }
    else if (t === T.STAIR) { ctx.fillStyle = colors.ground; ctx.fillRect(x,y,TILE,TILE); }
    else {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x,y,TILE,TILE);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.strokeRect(x+0.5,y+0.5,TILE-1,TILE-1);
    const icon = iconMap[t];
    if (icon) {
      ctx.font = '20px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(icon, x+TILE/2, y+TILE/2);
    }
  }

  toSaveData() {
    return {
      name: this.name,
      width: this.width,
      theme: this.theme,
      grid: this.grid.map(row => row.join(',')),
      entities: this.entities,
      start: this.start,
    };
  }

  toPlayableLevel() {
    return {
      id: 'test',
      name: this.name,
      width: this.width,
      height: this.height,
      theme: this.theme,
      isBoss: false,
      grid: this.grid.map(r => r.slice()),
      entities: this.entities.slice(),
      start: this.start,
      timeLimit: 500,
    };
  }
}

Object.assign(App, {
  openEditor(existingData) {
    if (!this.editor) {
      const canvas = document.getElementById('editor-canvas');
      this.editor = new LevelEditor(canvas);
      this._resizeEditorCanvas();
      window.addEventListener('resize', () => this._resizeEditorCanvas());
      this._renderPalette();
      this._startEditorLoop();
    }
    if (existingData) {
      const ed = this.editor;
      ed.name = existingData.name;
      ed.width = existingData.width;
      ed.theme = existingData.theme;
      ed.grid = existingData.grid.map(row => row.split(',').map(Number));
      ed.height = ed.grid.length;
      ed.entities = existingData.entities;
      ed.start = existingData.start;
      document.getElementById('ed-levelname').value = ed.name;
      document.getElementById('ed-width').value = ed.width;
      document.getElementById('ed-width-val').textContent = ed.width;
      document.getElementById('ed-theme').value = ed.theme;
    } else {
      this.editor.clear();
    }
    this.showScreen('editor');
  },

  _resizeEditorCanvas() {
    const wrap = document.getElementById('editor-canvas-wrap');
    const canvas = document.getElementById('editor-canvas');
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
  },

  _renderPalette() {
    const container = document.getElementById('palette');
    container.innerHTML = '';
    EDITOR_PALETTE.forEach(item => {
      if (item.section) {
        const title = document.createElement('div');
        title.className = 'palette-section-title';
        title.textContent = item.section;
        container.appendChild(title);
        return;
      }
      const el = document.createElement('div');
      el.className = 'palette-item' + (this.editor.selected === item ? ' selected' : '');
      el.innerHTML = `<span>${item.icon}</span><span class="p-label">${item.label}</span>`;
      el.addEventListener('click', () => {
        this.editor.selected = item;
        container.querySelectorAll('.palette-item').forEach(p => p.classList.remove('selected'));
        el.classList.add('selected');
      });
      container.appendChild(el);
    });
  },

  _startEditorLoop() {
    const loop = () => {
      if (this.screens.editor.classList.contains('active')) {
        this.editor.render();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  _bindEditor() {
    document.getElementById('ed-back').addEventListener('click', () => this.showScreen('menu'));
    document.getElementById('ed-width').addEventListener('input', (e) => {
      document.getElementById('ed-width-val').textContent = e.target.value;
    });
    document.getElementById('ed-width').addEventListener('change', (e) => {
      this.editor.resize(parseInt(e.target.value, 10));
    });
    document.getElementById('ed-theme').addEventListener('change', (e) => {
      this.editor.theme = e.target.value;
    });
    document.getElementById('ed-levelname').addEventListener('input', (e) => {
      this.editor.name = e.target.value || 'Naamloos level';
    });
    document.getElementById('ed-clear').addEventListener('click', () => {
      if (confirm('Editor leegmaken?')) this.editor.clear();
    });
    document.getElementById('ed-test').addEventListener('click', () => {
      const level = this.editor.toPlayableLevel();
      this._editorReturnFlag = true;
      this.playTestLevel(level);
    });
    document.getElementById('ed-save').addEventListener('click', () => {
      const data = this.editor.toSaveData();
      if (!data.name.trim()) { alert('Geef je level een naam!'); return; }
      const list = loadCustomLevels();
      list.push(data);
      saveCustomLevels(list);
      alert(`Level "${data.name}" opgeslagen! Te vinden bij "Mijn Levels".`);
    });
  },
});

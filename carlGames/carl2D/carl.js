/* ============================================
   CARL THE URGENT SLUG URCHIN - MAIN GAME LOGIC
   Vertical Climbing Edition
   ============================================ */

"use strict";

// ========== GLOBAL GAME STATE ==========
let game = {
    state: 'waiting', // Start in waiting state until menu is closed
    started: false,
    altitude: 0,
    highestAltitude: 0,
    lives: GAME_CONFIG.STARTING_LIVES,
    cameraY: 0,
    seaLevel: 0,
    surfaceGoal: GAME_CONFIG.SURFACE_GOAL,
    startTime: 0,
    currentTime: 0,
    pauseStartTime: 0,
    bestTime: null,
    frameCount: 0,
    flyingUp: false,
    flyTimer: 0,
    lastSideEnemySpawnTime: 0,  // Track last spawn time to prevent bunching
    bossMode: false,  // Boss fight active
    bossSpawned: false,  // Has boss been created
    boss: null,  // Reference to boss enemy
    bossIntroActive: false,  // Boss intro cutscene active
    bossIntroTimer: 0,  // Timer for boss intro
    musicFading: false,  // Is main music fading out
    musicFadeAmount: 1.0,  // Current volume for fade

    // Side-screen camping detection
    sideCampingTimer: 0,  // Frames spent on screen sides
    hardModeActive: false,  // Flag for hard mode punishment

    // Lives display hue animation
    livesHueTimer: 0,  // Timer for lives display color effect
    livesHueType: 'none',  // 'heal' or 'damage' or 'none'

    // Endgame cutscene (boss defeat)
    winSequenceActive: false,
    winSequenceTimer: 0,
    winSequencePhase: 0,
    winSequenceData: {
        startCameraY: 0,
        sunX: 0,
        sunY: 0,
        sunSize: 0,
        supernovaProgress: 0,
        fadeAlpha: 0
    },

    // Timer freeze + color on boss defeat
    timerFrozen: false,
    timerColor: null,

    // Pearl powerup during boss fight
    pearlPowerup: null
};

let carl;
let enemies = [];
let platforms = [];
let powerups = [];
let particles = [];
let background = { layers: [], bubbles: [], clouds: [] };
let keys = {};
let spacePressed = false;
let sounds = { backgroundMusic: null, jump: null, boost: null, hit: null, death: null, powerup: null, win: null, loaded: false, play(s) { if (this[s] && this.loaded) { try { this[s].play(); } catch (e) {} } }, stop(s) { if (this[s] && this.loaded) { try { this[s].stop(); } catch (e) {} } }, loop(s) { if (this[s] && this.loaded) { try { this[s].loop(); } catch (e) {} } }, pause(s) { if (this[s] && this.loaded) { try { this[s].pause(); } catch (e) {} } } };
let lastPlatformY = 0;
let platformGap = 600;
let waterHealTimer = 0; // Timer for water healing
let bossPowerupTimer = 0; // Timer for boss fight powerup spawn opportunities

// ========== CARL CHARACTER ==========
class Carl {
    constructor(x, y) {
        this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.size = CARL_CONFIG.SIZE;
        this.rotation = 0; this.animFrame = 0; this.animSpeed = CARL_CONFIG.ANIM_SPEED;
        this.accelerationX = CARL_CONFIG.ACCELERATION_X; this.accelerationY = CARL_CONFIG.ACCELERATION_Y;
        this.friction = CARL_CONFIG.FRICTION; this.waterResistance = CARL_CONFIG.WATER_RESISTANCE;
        this.maxSpeed = CARL_CONFIG.MAX_SPEED; this.jumpPower = CARL_CONFIG.JUMP_POWER; this.gravity = CARL_CONFIG.GRAVITY;
        this.speedBoost = 1.0; this.boostTimer = 0;
        this.hasShield = false;
        this.isGrounded = false; this.onPlatform = null;
        this.isInvincible = false; this.invincibleTimer = 0;
        this.jumping = false; // Track if Carl is in a jump
        this.wasAboveWater = false; // Track water surface crossing for logging
        this.healEffectTimer = 0; // Visual indicator when healed
        this.holdMode = false;          // Vertical position lock
        this.holdY = 0;                 // World Y to hold at
        this.holdActivatedByTouch = false;
        this.holdTouchStartScreenY = 0;
        this.pearlDash = false;       // Pearl powerup dash mode
        this.pearlDashTimer = 0;      // Frame counter for dash phases
        this.pearlDashStartTime = 0;  // millis() timestamp when dash began
        this.pearlDashShooting = false; // true once the downward shoot phase starts
        this.pearlPassedSun = false;  // Ensures sun takes damage only once per dash
        this.tentacles = [];
        for (let i = 0; i < CARL_CONFIG.TENTACLE_COUNT; i++) {
            this.tentacles.push({ angle: (TWO_PI / CARL_CONFIG.TENTACLE_COUNT) * i, length: CARL_CONFIG.TENTACLE_LENGTH, wave: random(TWO_PI) });
        }
    }
    
    update() {
        // Freeze Carl completely during boss intro - skip all movement logic
        if (game.bossIntroActive) {
            this.vx = 0;
            this.vy = 0;
            return; // Exit early, don't process any movement
        }

        // Pearl dash override - player loses control, Carl shoots straight down
        if (this.pearlDash) {
            this.pearlDashTimer++;
            const PEARL_WINDUP_MS = 3000; // exactly 3 real seconds
            let elapsed = millis() - this.pearlDashStartTime;

            // Wind-up: drift slowly upward while radial burst particles intensify over 3 seconds.
            if (elapsed < PEARL_WINDUP_MS) {
                this.vx = 0;
                this.vy = -18 * scaleY; // slow upward drift
                this.x += this.vx;
                this.y += this.vy;
                particles.push(new Particle(this.x, this.y, 'pearl_burst'));
                this.animFrame += this.animSpeed;
                return;
            }

            // First frame of dash phase: flip the flag so draw() shows trail immediately
            if (!this.pearlDashShooting) {
                this.pearlDashShooting = true;
            }

            // Shoot straight down – speed is higher to remain ~3 s since wind-up gained altitude
            this.vx = 0;
            this.vy = 26 * scaleY;
            this.x += this.vx;
            this.y += this.vy;
            // Screen wrap
            if (this.x < -this.size) this.x = width + this.size;
            if (this.x > width + this.size) this.x = -this.size;
            // Trail particles: random X jitter but always directly above Carl (no vx influence)
            if (frameCount % 2 === 0) {
                particles.push(new Particle(
                    this.x + random(-12, 12) * SCALE,
                    this.y - random(15, 45) * scaleY,
                    'pearl'
                ));
            }
            // End dash as soon as Carl reaches the water
            if (this.y >= game.surfaceGoal) {
                this.y = game.surfaceGoal;
                this.pearlDash = false;
                this.isInvincible = true;
                this.invincibleTimer = 60; // Brief invincibility after landing
                this.vx = 0;
                this.vy = 26 * scaleY; // carry downward momentum into the water (matches dash speed)
                // Stop super-Carl track and resume the boss battle music
                if (window.superCarlMusic && window.superCarlMusicLoaded) {
                    try { window.superCarlMusic.stop(); } catch (e) {}
                }
                if (window.bossMusic && window.bossMusicLoaded) {
                    try { window.bossMusic.play(); } catch (e) {}
                }
                // Steam burst from the impact point
                for (let i = 0; i < 35; i++) {
                    particles.push(new Particle(this.x + random(-70, 70) * SCALE, this.y, 'steam'));
                }
                // A few orange sparks for punch
                for (let i = 0; i < 12; i++) {
                    particles.push(new Particle(this.x + random(-30, 30) * SCALE, this.y, 'pearl_burst'));
                }
            }
            this.animFrame += this.animSpeed;
            return;
        }

        // Block input during boss defeat sequence, but allow falling
        let bossDefeated = false;
        if (game.bossMode) {
            let boss = enemies.find(e => e.type === 'sunboss');
            if (boss && boss.defeated) {
                bossDefeated = true;
                this.vx *= 0.95; // Slow horizontal movement
                // Skip input processing but continue with physics below
            }
        }
        
        if (game.state === 'playing' && !bossDefeated) {
            let accelX = this.accelerationX * this.speedBoost;
            let accelY = this.accelerationY * this.speedBoost;
            
            // Check if Carl is above water in boss mode
            let isAboveWater = game.bossMode && this.y < game.surfaceGoal;
            
            // Handle jumping when on a platform above water
            if (isAboveWater && this.onPlatform && !this.jumping) {
                // Check for jump input (spacebar or up arrow)
                if (keys[' '] || keys['ArrowUp'] || keys['w'] || keys['W']) {
                    this.vy = CARL_CONFIG.JUMP_POWER;
                    if (DEBUG) console.log('[PLATFORM JUMP] Jump velocity:', this.vy, '| scaleY:', scaleY, '| Expected height:', Math.abs(this.vy) * 20);
                    this.jumping = true;
                    this.onPlatform = null;
                }
            }
            
            // Touch/mouse controls - move Carl towards touch position
            if (mouseIsPressed || touches.length > 0) {
                // Check if tapping the pause button - if so, don't move
                let pauseButton = document.getElementById('pause-button');
                let clickedElement = document.elementFromPoint(mouseX, mouseY);
                let isClickingPauseButton = clickedElement && (
                    clickedElement === pauseButton || 
                    pauseButton.contains(clickedElement)
                );
                
                if (!isClickingPauseButton) {
                    let targetX = mouseX;
                    let targetY = mouseY + game.cameraY; // Convert screen Y to world Y
                    
                    // If using touches, use first touch
                    if (touches.length > 0) {
                        targetX = touches[0].x;
                        targetY = touches[0].y + game.cameraY;
                    }
                    
                    // Calculate direction to target
                    let dx = targetX - this.x;
                    let dy = targetY - this.y;
                    
                    // Apply acceleration towards target
                    // Horizontal movement
                    if (Math.abs(dx) > 10 * SCALE) { // Dead zone
                        if (dx < 0) this.vx -= accelX;
                        else this.vx += accelX;
                    }
                    
                    // Vertical movement - disable upward acceleration if above water (unless on platform for jumping)
                    if (Math.abs(dy) > 10 * SCALE) { // Dead zone
                        // Allow jump by tapping above Carl when on platform
                        if (dy < 0 && isAboveWater && this.onPlatform && !this.jumping) {
                            this.vy = CARL_CONFIG.JUMP_POWER;
                            this.jumping = true;
                            this.onPlatform = null;
                        } else if (this.holdMode && this.holdActivatedByTouch) {
                            // Check if vertical drag has exceeded threshold to cancel hold
                            let currentScreenY = touches.length > 0 ? touches[0].y : mouseY;
                            if (abs(currentScreenY - this.holdTouchStartScreenY) > 60) {
                                this.holdMode = false;
                                if (dy < 0 && !isAboveWater) this.vy -= accelY;
                                else if (dy > 0) this.vy += accelY;
                            }
                            // else: hold active, skip vertical movement
                        } else if (dy < 0 && !isAboveWater) {
                            this.vy -= accelY; // Only allow upward acceleration underwater
                        } else if (dy > 0) {
                            this.vy += accelY; // Always allow downward acceleration
                        }
                    }
                }
            } else {
                // Keyboard controls
                if (CONTROLS.LEFT.some(k => keys[k])) this.vx -= accelX;
                if (CONTROLS.RIGHT.some(k => keys[k])) this.vx += accelX;
                // Cancel hold mode on vertical input
                if (CONTROLS.UP.some(k => keys[k]) || CONTROLS.DOWN.some(k => keys[k])) {
                    this.holdMode = false;
                }
                if (!this.holdMode) {
                    if (CONTROLS.UP.some(k => keys[k]) && !isAboveWater) this.vy -= accelY; // Disable upward acceleration above water (jumping is handled separately)
                    if (CONTROLS.DOWN.some(k => keys[k])) this.vy += accelY;
                }
            }
        }
        
        // Check if Carl is above water in boss mode for physics adjustments
        let isAboveWater = game.bossMode && this.y < game.surfaceGoal;
        
        // Cancel hold mode when above water (jumping sequence)
        if (isAboveWater) this.holdMode = false;
        
        // Apply friction and water resistance only when underwater
        if (!isAboveWater) {
            this.vx *= this.friction * this.waterResistance;
            this.vy *= this.friction * this.waterResistance;
        } else {
            // Air physics when above water
            // Apply stronger deceleration on platforms, lighter in air
            if (this.onPlatform) {
                // On platform - strong friction to stop quickly
                this.vx *= 0.85;
            } else {
                // In air - lighter friction for momentum preservation
                this.vx *= 0.96;
            }
            // Minimal vertical air resistance to preserve jump height
            this.vy *= 0.998;
        }
        
        // Hold mode: spring-lock vertical position instead of applying gravity
        if (this.holdMode && !isAboveWater) {
            this.vy *= 0.5; // Extra strong vertical damping
            this.vy += (this.holdY - this.y) * 0.15; // Spring back to hold position
        } else {
            this.vy += this.gravity;
        }
        
        let maxSpd = this.maxSpeed * this.speedBoost;
        let maxSpdY = 28 * scaleY * this.speedBoost; // Vertical max speed should scale with scaleY
        this.vx = constrain(this.vx, -maxSpd, maxSpd);
        this.vy = constrain(this.vy, -maxSpdY * 1.5, maxSpdY * 1.5);
        
        this.x += this.vx;
        this.y += this.vy;
        
        // Track side-screen camping during level section (not boss mode)
        if (!game.bossMode && game.state === 'playing' && !game.hardModeActive) {
            let sideZoneWidth = width * 0.15; // 15% of screen width on each side
            let isOnSide = this.x < sideZoneWidth || this.x > width - sideZoneWidth;
            
            if (isOnSide) {
                game.sideCampingTimer++;
                // 5 seconds at 60 FPS = 300 frames
                if (game.sideCampingTimer >= 300) {
                    game.hardModeActive = true;
                    if (DEBUG) console.log('[HARD MODE] Activated! Player camped on screen sides for 5+ seconds');
                }
            } else {
                // Reset timer if not on side
                game.sideCampingTimer = 0;
            }
        }
        
        if (this.x < -this.size) this.x = width + this.size;
        if (this.x > width + this.size) this.x = -this.size;
        
        let seabedY = game.seaLevel + 30 * scaleY;
        if (this.y >= seabedY - this.size) {
            this.y = seabedY - this.size;
            this.vy = 0;
            this.isGrounded = true;
        } else {
            this.isGrounded = false;
        }
        
        this.onPlatform = null;
        for (let platform of platforms) {
            if (this.checkPlatformCollision(platform)) break;
        }
        
        game.altitude = Math.abs(this.y - game.seaLevel);
        if (game.altitude > game.highestAltitude) game.highestAltitude = game.altitude;
        
        // Track when Carl crosses water surface in boss mode
        if (game.bossMode) {
            // Check if Carl just breached the surface (was below, now above)
            if (!this.wasAboveWater && this.y < game.surfaceGoal) {
                if (DEBUG) console.log('[WATER BREACH] Velocity at breach:', this.vy, '| scaleY:', scaleY, '| Distance to first platform:', 180 * scaleY * Math.min(1.0, scaleY * 1.2));
            }
            this.wasAboveWater = this.y < game.surfaceGoal;
        }
        
        if (this.y <= game.surfaceGoal && !game.bossMode) {
            game.bossMode = true;
            this.vy = 0;
        }
        
        game.cameraY = lerp(game.cameraY, this.y - height / 2, 0.1);
        this.rotation = lerp(this.rotation, this.vx * 0.05, 0.1);
        this.animFrame += this.animSpeed;
        
        if (this.isInvincible) {
            this.invincibleTimer--;
            if (this.invincibleTimer <= 0) this.isInvincible = false;
        }
        
        if (this.boostTimer > 0) {
            this.boostTimer--;
            if (this.boostTimer <= 0) this.speedBoost = 1.0;
        }

        // Water healing logic
        if (game.bossMode && !isAboveWater) {
            waterHealTimer++;
            if (waterHealTimer >= 600) { // 10 seconds at 60 FPS
                if (game.lives < GAME_CONFIG.STARTING_LIVES) {
                    game.lives++;
                    this.healEffectTimer = 80; // Show heal effect for ~1.3 seconds
                    game.livesHueTimer = 80;
                    game.livesHueType = 'heal';
                }
                waterHealTimer = 0;
            }
        }
        
        // Decrement heal effect timer
        if (this.healEffectTimer > 0) {
            this.healEffectTimer--;
        }
    }
    
    checkPlatformCollision(platform) {
        let overlap = this.size * 0.5;
        // Landing on top
        if (this.vy >= 0 && this.y + this.size >= platform.y && this.y < platform.y &&
            this.x + overlap > platform.x && this.x - overlap < platform.x + platform.width) {
            this.y = platform.y - this.size;
            this.vy = 0;
            this.onPlatform = platform;
            this.jumping = false; // Reset jumping flag when landing
            return true;
        }
        // Hitting underside (when moving up)
        if (this.vy < 0 && this.y - this.size <= platform.y + platform.height && this.y > platform.y + platform.height &&
            this.x + overlap > platform.x && this.x - overlap < platform.x + platform.width) {
            this.y = platform.y + platform.height + this.size;
            this.vy = 0;
            return true;
        }
        // Left side collision
        if (this.vx > 0 && this.x + overlap > platform.x && this.x < platform.x &&
            this.y + this.size > platform.y && this.y - this.size < platform.y + platform.height) {
            this.x = platform.x - overlap;
            this.vx *= -0.5;
            return true;
        }
        // Right side collision
        if (this.vx < 0 && this.x - overlap < platform.x + platform.width && this.x > platform.x + platform.width &&
            this.y + this.size > platform.y && this.y - this.size < platform.y + platform.height) {
            this.x = platform.x + platform.width + overlap;
            this.vx *= -0.5;
            return true;
        }
        return false;
    }
    
    applySpeedBoost(duration) {
        this.speedBoost = 1.8;
        this.boostTimer = duration;
        sounds.play('boost');
        for (let i = 0; i < 20; i++) particles.push(new Particle(this.x, this.y, 'boost'));
    }

    startPearlDash() {
        this.pearlDash = true;
        this.pearlDashTimer = 0;
        this.pearlDashStartTime = millis();
        this.pearlDashShooting = false;
        this.pearlPassedSun = false;
        this.isInvincible = true;
        this.invincibleTimer = 9999; // Will be replaced when dash ends
        this.vx = 0;
        this.vy = 0;
        // Pause boss battle music and play the super-Carl track
        if (window.bossMusic && window.bossMusicLoaded) {
            try { window.bossMusic.pause(); } catch (e) {}
        }
        if (window.superCarlMusic && window.superCarlMusicLoaded) {
            try { window.superCarlMusic.setVolume(1.0); window.superCarlMusic.play(); } catch (e) {}
        }
        for (let i = 0; i < 20; i++) {
            particles.push(new Particle(this.x + random(-this.size, this.size), this.y + random(-this.size, this.size), 'pearl'));
        }
    }

    draw() {
        push();
        translate(this.x, this.y - game.cameraY);
        rotate(this.rotation);
        
        if (this.isInvincible && !this.pearlDash && frameCount % 10 < 5) { pop(); return; }
        
        // Heal effect visual
        if (this.healEffectTimer > 0) {
            let healAlpha;
            // Fade in quickly (first 20 frames), stay full (next 30 frames), fade out quickly (last 30 frames)
            if (this.healEffectTimer > 60) {
                // Fade in: 80-60 = first 20 frames
                healAlpha = map(this.healEffectTimer, 80, 60, 0, 150);
            } else if (this.healEffectTimer > 30) {
                // Full brightness: 60-30 = middle 30 frames
                healAlpha = 150;
            } else {
                // Fade out: last 30 frames
                healAlpha = map(this.healEffectTimer, 30, 0, 150, 0);
            }
            fill(50, 255, 100, healAlpha);
            noStroke();
            circle(0, 0, this.size * 2.2);
            // Inner brighter glow
            fill(100, 255, 150, healAlpha * 0.6);
            circle(0, 0, this.size * 1.8);
        }
        
        // Speed boost visual effect
        if (this.boostTimer > 0) { 
            // Speed trail effect - emanates from the glow bubble
            for (let i = 1; i <= 4; i++) {
                push();
                let trailAlpha = map(i, 1, 4, 100, 20);
                let trailSize = map(i, 1, 4, 1.0, 0.6);
                fill(255, 255, 0, trailAlpha);
                noStroke();
                // Position trails behind the bubble based on velocity
                let trailX = -this.vx * i * 0.8;
                let trailY = -this.vy * i * 0.8;
                translate(trailX, trailY);
                circle(0, 0, this.size * 2 * trailSize);
                pop();
            }
            // Main glow effect
            fill(255, 255, 0, 100); noStroke(); circle(0, 0, this.size * 2);
        }
        
        // Draw shield visual if Carl has one
        if (this.hasShield) {
            push();
            noFill();
            stroke(100, 200, 255, 150);
            strokeWeight(3 * SCALE);
            let shieldPulse = sin(frameCount * 0.1) * 5 * SCALE;
            circle(0, 0, this.size * 1.8 + shieldPulse);
            // Add hexagonal pattern
            strokeWeight(2 * SCALE);
            for (let i = 0; i < 6; i++) {
                let angle = (TWO_PI / 6) * i;
                let x1 = cos(angle) * (this.size * 0.9 + shieldPulse);
                let y1 = sin(angle) * (this.size * 0.9 + shieldPulse);
                let x2 = cos(angle + TWO_PI / 6) * (this.size * 0.9 + shieldPulse);
                let y2 = sin(angle + TWO_PI / 6) * (this.size * 0.9 + shieldPulse);
                line(x1, y1, x2, x2);
            }
            pop();
        }
        
        // Compute pearl intensity: 0→1 over 3s wind-up, then holds at 1 during dash.
        // Drives all gradual color transitions and glow opacity.
        const PEARL_WINDUP_MS = 3000;
        let pearlIntensity = 0;
        if (this.pearlDash) {
            let elapsed = millis() - this.pearlDashStartTime;
            pearlIntensity = this.pearlDashShooting ? 1.0 : constrain(elapsed / PEARL_WINDUP_MS, 0, 1);
        }
        // Channel lerp helper: blends from purple value 'a' toward orange value 'b'
        let lc = (a, b) => Math.round(a + (b - a) * pearlIntensity);

        // Outer glow fades in during wind-up; velocity trail extends behind during dash
        if (pearlIntensity > 0) {
            push();
            noStroke();
            fill(255, 140, 0, pearlIntensity * 90);
            circle(0, 0, this.size * 2.8);
            // Trail: visible from the exact same frame pearlDashShooting flips true
            if (this.pearlDashShooting) {
                push();
                rotate(-this.rotation); // undo the parent rotate(this.rotation)
                for (let i = 1; i <= 6; i++) {
                    let trailAlpha = map(i, 1, 6, 125, 8);
                    let trailSize = map(i, 1, 6, 2.4, 0.7);
                    fill(255, max(50, 180 - i * 22), 0, trailAlpha);
                    circle(0, -this.size * i * 1.4, this.size * trailSize);
                }
                pop();
            }
            pop();
        }

        // === COLOR SCHEME (lerps from purple to orange during pearl dash) ===
        let bodyR = lc(128, 255), bodyG = lc(60, 140), bodyB = lc(180, 0);
        let bodyLightR = lc(177, 255), bodyLightG = lc(156, 218), bodyLightB = lc(217, 160);
        let bodyDarkR = lc(80, 180), bodyDarkG = lc(40, 60), bodyDarkB = lc(120, 0);
        let tentBaseR = lc(100, 180), tentBaseG = lc(50, 70), tentBaseB = lc(160, 20);
        let tentLightR = lc(160, 255), tentLightG = lc(100, 160), tentLightB = lc(200, 80);
        let tentDotR = lc(70, 160), tentDotG = lc(30, 50), tentDotB = lc(100, 10);
        let spikeR = lc(90, 165), spikeG = lc(50, 70), spikeB = lc(120, 15);
        let earR = lc(110, 200), earG = lc(55, 80), earB = lc(150, 10);
        let earInnerR = lc(170, 255), earInnerG = lc(120, 180), earInnerB = lc(190, 100);
        let s = this.size * 0.7; // sprite scale (70% of hitbox size)

        // === 1. TENTACLES (behind body) — 9 wavy bezier tentacles ===
        // Skip the bottom 45° arc: that's ±22.5° around straight down (HALF_PI).
        // Spread 9 tentacles equally across the remaining 315° (7/8 of a circle).
        let tentGapAngle = PI * 0.125; // 22.5° in radians
        let tentArcStart = HALF_PI + tentGapAngle; // just past bottom-right
        let tentArcSpan = TWO_PI - tentGapAngle * 2; // 315°
        // Movement intensity drives tentacle animation (0 when still, 1 at full speed)
        let speed = sqrt(this.vx * this.vx + this.vy * this.vy);
        let moveIntensity = constrain(speed / (this.maxSpeed * 0.5), 0, 1);
        for (let i = 0; i < 9; i++) {
            let angle = tentArcStart + (tentArcSpan / 9) * (i + 0.5);
            // Erratic multi-frequency waves — each tentacle has its own chaotic phase
            let f = frameCount;
            let wave  = (sin(f * 0.55 + i * 2.3) * 0.6
                       + sin(f * 1.1  + i * 1.1) * 0.25
                       + sin(f * 0.28 + i * 3.7) * 0.15) * s * 0.22 * moveIntensity;
            let wave2 = (cos(f * 0.48 + i * 1.9) * 0.6
                       + cos(f * 0.97 + i * 2.5) * 0.25
                       + cos(f * 0.33 + i * 0.9) * 0.15) * s * 0.18 * moveIntensity;

            // Origin on body edge
            let ox = cos(angle) * s * 0.55;
            let oy = sin(angle) * s * 0.55;

            // Tentacle length — erratic length pulsing when moving
            let tentLen = s * 0.85
                + (sin(f * 0.42 + i * 1.7) * 0.6 + sin(f * 0.87 + i * 2.9) * 0.4)
                  * s * 0.18 * moveIntensity;
            let ex = cos(angle) * (s * 0.55 + tentLen) + wave;
            let ey = sin(angle) * (s * 0.55 + tentLen) + wave2;

            // Control points — independently erratic for wild curves
            let cp1Wave = (sin(f * 0.73 + i * 1.4) * 0.7 + sin(f * 1.3 + i * 2.1) * 0.3) * s * 0.18 * moveIntensity;
            let cp2Wave = (cos(f * 0.61 + i * 2.8) * 0.7 + cos(f * 1.05 + i * 1.6) * 0.3) * s * 0.16 * moveIntensity;
            let cx1 = ox + cos(angle + 0.4) * tentLen * 0.4 + cp1Wave;
            let cy1 = oy + sin(angle + 0.4) * tentLen * 0.4 + cp1Wave * 0.8;
            let cx2 = ox + cos(angle - 0.3) * tentLen * 0.75 + cp2Wave;
            let cy2 = oy + sin(angle - 0.3) * tentLen * 0.75 + cp2Wave * 0.8;

            // Thick outer stroke
            noFill();
            stroke(tentBaseR, tentBaseG, tentBaseB);
            strokeWeight(5 * SCALE);
            bezier(ox, oy, cx1, cy1, cx2, cy2, ex, ey);

            // Lighter inner highlight stroke
            stroke(tentLightR, tentLightG, tentLightB, 120);
            strokeWeight(2.5 * SCALE);
            bezier(ox, oy, cx1, cy1, cx2, cy2, ex, ey);

            // Suction dots along the tentacle curve
            noStroke();
            fill(tentDotR, tentDotG, tentDotB);
            for (let j = 1; j <= 5; j++) {
                let t = j / 6;
                let px = bezierPoint(ox, cx1, cx2, ex, t);
                let py = bezierPoint(oy, cy1, cy2, ey, t);
                let dotSize = map(j, 1, 5, 4, 2.5) * SCALE;
                circle(px, py, dotSize);
            }
        }

        // === 2. BODY (circular with radial gradient) ===
        noStroke();
        // Shadow under body
        fill(bodyDarkR, bodyDarkG, bodyDarkB);
        circle(0, s * 0.03, s * 1.34);
        // Main body circle with gradient
        let bodyGrad = drawingContext.createRadialGradient(
            -s * 0.15, -s * 0.15, s * 0.05,
            0, 0, s * 0.65
        );
        bodyGrad.addColorStop(0, `rgb(${bodyLightR},${bodyLightG},${bodyLightB})`);
        bodyGrad.addColorStop(0.5, `rgb(${bodyR},${bodyG},${bodyB})`);
        bodyGrad.addColorStop(1, `rgb(${bodyDarkR},${bodyDarkG},${bodyDarkB})`);
        drawingContext.fillStyle = bodyGrad;
        circle(0, 0, s * 1.3);
        // Swirl markings on body
        noFill();
        stroke(bodyDarkR, bodyDarkG, bodyDarkB, 80);
        strokeWeight(2 * SCALE);
        arc(-s * 0.15, s * 0.1, s * 0.35, s * 0.35, PI * 0.3, PI * 1.5);
        arc(s * 0.1, s * 0.05, s * 0.25, s * 0.25, PI * 1.2, PI * 2.5);

        // Lighter stomach oval
        noStroke();
        fill(bodyLightR, bodyLightG, bodyLightB, 120);
        ellipse(0, s * 0.18, s * 0.55, s * 0.45);

        // === 3. SPIKES (16 small triangles around body) ===
        fill(spikeR, spikeG, spikeB);
        noStroke();
        for (let i = 0; i < 16; i++) {
            let spikeAngle = (TWO_PI / 16) * i;
            let sx = cos(spikeAngle) * s * 0.6;
            let sy = sin(spikeAngle) * s * 0.6;
            let spikeLen = s * 0.12 + sin(this.animFrame + i * 0.8) * s * 0.02;
            push();
            translate(sx, sy);
            rotate(spikeAngle);
            triangle(-s * 0.04, 0, s * 0.04, 0, 0, -spikeLen);
            pop();
        }

        // === 4. EARS (cat-like triangles on top) ===
        noStroke();
        // Left ear
        fill(earR, earG, earB);
        push();
        translate(-s * 0.35, -s * 0.55);
        rotate(-0.15);
        triangle(-s * 0.12, s * 0.1, s * 0.12, s * 0.1, 0, -s * 0.22);
        fill(earInnerR, earInnerG, earInnerB);
        triangle(-s * 0.06, s * 0.08, s * 0.06, s * 0.08, 0, -s * 0.14);
        pop();
        // Right ear
        fill(earR, earG, earB);
        push();
        translate(s * 0.35, -s * 0.55);
        rotate(0.15);
        triangle(-s * 0.12, s * 0.1, s * 0.12, s * 0.1, 0, -s * 0.22);
        fill(earInnerR, earInnerG, earInnerB);
        triangle(-s * 0.06, s * 0.08, s * 0.06, s * 0.08, 0, -s * 0.14);
        pop();

        // === 5. EYES (large expressive cartoon eyes) ===
        let pupilOffsetX = constrain(this.vx * 2, -3, 3) * SCALE;
        let pupilOffsetY = constrain(this.vy * 0.5, -3, 3) * SCALE;
        let eyeLX = -s * 0.25, eyeRX = s * 0.25, eyeY = -s * 0.15;
        // White eyeballs
        fill(255);
        noStroke();
        ellipse(eyeLX, eyeY, s * 0.35, s * 0.4);
        ellipse(eyeRX, eyeY, s * 0.35, s * 0.4);
        // Green irises
        fill(50, 180, 100);
        ellipse(eyeLX + pupilOffsetX, eyeY + pupilOffsetY, s * 0.18, s * 0.22);
        ellipse(eyeRX + pupilOffsetX, eyeY + pupilOffsetY, s * 0.18, s * 0.22);
        // Black pupils
        fill(0);
        ellipse(eyeLX + pupilOffsetX, eyeY + pupilOffsetY, s * 0.09, s * 0.11);
        ellipse(eyeRX + pupilOffsetX, eyeY + pupilOffsetY, s * 0.09, s * 0.11);
        // White highlight dots
        fill(255, 255, 255, 220);
        ellipse(eyeLX - s * 0.04 + pupilOffsetX * 0.3, eyeY - s * 0.06 + pupilOffsetY * 0.3, s * 0.07, s * 0.07);
        ellipse(eyeRX - s * 0.04 + pupilOffsetX * 0.3, eyeY - s * 0.06 + pupilOffsetY * 0.3, s * 0.07, s * 0.07);

        // === 6. MOUTH (mischievous grin with teeth) ===
        // White mouth interior
        fill(255);
        noStroke();
        arc(0, s * 0.08, s * 0.45, s * 0.3, 0.1, PI - 0.1, CHORD);
        // Mouth outline
        stroke(lc(80, 140), lc(40, 50), lc(100, 10));
        strokeWeight(2.5 * SCALE);
        noFill();
        arc(0, s * 0.08, s * 0.45, s * 0.3, 0.1, PI - 0.1);
        // Small triangular teeth along the top of the smile
        fill(255);
        noStroke();
        for (let i = 0; i < 5; i++) {
            let t = map(i, 0, 4, 0.35, PI - 0.35);
            let tx = cos(t) * s * 0.225;
            let ty = s * 0.08;
            triangle(tx - s * 0.025, ty, tx + s * 0.025, ty, tx, ty + s * 0.05);
        }

        // === 7. FEET (stick out below body) ===
        fill(bodyDarkR, bodyDarkG, bodyDarkB);
        noStroke();
        ellipse(-s * 0.2, s * 0.68, s * 0.2, s * 0.16);
        ellipse(s * 0.2, s * 0.68, s * 0.2, s * 0.16);

        pop();
    }
    
    hit() {
        if (!this.isInvincible) {
            // Check if Carl has a shield
            if (this.hasShield) {
                // Shield absorbs the hit
                this.hasShield = false;
                this.isInvincible = true;
                this.invincibleTimer = CARL_CONFIG.INVINCIBLE_DURATION;
                sounds.play('powerup');
                // Shield breaking particles
                for (let i = 0; i < 30; i++) particles.push(new Particle(this.x, this.y, 'shield'));
            } else {
                // No shield, take damage
                game.lives--;
                this.isInvincible = true;
                this.invincibleTimer = CARL_CONFIG.INVINCIBLE_DURATION;
                sounds.play('hit');
                for (let i = 0; i < 15; i++) particles.push(new Particle(this.x, this.y, 'hit'));
                
                // Blood in the water: spawn a shark from the side furthest from Carl at max speed (only underwater)
                if (this.y > game.surfaceGoal) {
                    let sharkFromLeft = this.x > width / 2;
                    let sharkX = sharkFromLeft ? -70 * SCALE : width + 70 * SCALE;
                    let sharkDir = sharkFromLeft ? 1 : -1;
                    let bloodShark = new Shark(sharkX, this.y, sharkDir);
                    bloodShark.speed = ENEMY_CONFIG.SHARK_SPEED * 2.5 * (game.bossMode ? 1.5 : 1.0);
                    enemies.push(bloodShark);
                }

                // Reset water healing timer when taking damage
                waterHealTimer = 0;
                
                if (game.lives <= 0) gameOver();
            }
        }
    }
    
    reset() {
        this.x = width / 2; this.y = game.seaLevel; this.vx = 0; this.vy = 0;
        this.rotation = 0; this.isInvincible = false; this.invincibleTimer = 0;
        this.speedBoost = 1.0; this.boostTimer = 0; this.hasShield = false;
        this.holdMode = false;
        this.pearlDash = false; this.pearlDashTimer = 0; this.pearlDashStartTime = 0; this.pearlDashShooting = false; this.pearlPassedSun = false;
    }
}

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
    }
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
                if (CONTROLS.UP.some(k => keys[k]) && !isAboveWater) this.vy -= accelY; // Disable upward acceleration above water (jumping is handled separately)
                if (CONTROLS.DOWN.some(k => keys[k])) this.vy += accelY;
            }
        }
        
        // Check if Carl is above water in boss mode for physics adjustments
        let isAboveWater = game.bossMode && this.y < game.surfaceGoal;
        
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
        
        this.vy += this.gravity;
        
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
    
    draw() {
        push();
        translate(this.x, this.y - game.cameraY);
        rotate(this.rotation);
        
        if (this.isInvincible && frameCount % 10 < 5) { pop(); return; }
        
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
        
        for (let i = 0; i < this.tentacles.length; i++) {
            let t = this.tentacles[i];
            let waveOffset = sin(this.animFrame + t.wave) * 5 * SCALE;
            let tentacleLength = t.length + waveOffset;
            let endX = cos(t.angle) * tentacleLength;
            let endY = sin(t.angle) * tentacleLength;
            let grad = drawingContext.createLinearGradient(0, 0, endX, endY);
            grad.addColorStop(0, '#8b5dbf');
            grad.addColorStop(1, '#c98dd9');
            strokeWeight(6 * SCALE);
            drawingContext.strokeStyle = grad;
            line(0, 0, endX, endY);
            noStroke(); fill(100, 60, 130);
            for (let j = 0; j < 3; j++) {
                let t_pos = (j + 1) / 4;
                circle(endX * t_pos, endY * t_pos, 4 * SCALE);
            }
        }
        
        let bodyGrad = drawingContext.createRadialGradient(0, -5, 5, 0, 0, this.size * 0.6);
        bodyGrad.addColorStop(0, '#b19cd9');
        bodyGrad.addColorStop(0.5, '#8b5dbf');
        bodyGrad.addColorStop(1, '#6b4a9e');
        noStroke();
        drawingContext.fillStyle = bodyGrad;
        ellipse(0, 0, this.size * 1.2, this.size);
        
        stroke(100, 60, 130, 150); strokeWeight(3 * SCALE); noFill();
        for (let i = 0; i < 3; i++) { let offset = i * 8 * SCALE - 8 * SCALE; arc(offset, 0, 15 * SCALE, 15 * SCALE, 0, PI); }
        
        fill(90, 50, 120); noStroke();
        for (let i = 0; i < 12; i++) {
            let spikeAngle = (PI / 12) * i + PI * 0.3;
            let spikeX = cos(spikeAngle) * (this.size * 0.45);
            let spikeY = sin(spikeAngle) * (this.size * 0.35);
            let spikeSize = (8 + sin(this.animFrame + i) * 2) * SCALE;
            push(); translate(spikeX, spikeY); rotate(spikeAngle);
            triangle(-spikeSize/2, 0, spikeSize/2, 0, 0, -spikeSize * 1.5);
            pop();
        }
        
        fill(255); ellipse(-12 * SCALE, -8 * SCALE, 16 * SCALE, 20 * SCALE); ellipse(12 * SCALE, -8 * SCALE, 16 * SCALE, 20 * SCALE);
        let pupilX = constrain(this.vx * 2 * SCALE, -3 * SCALE, 3 * SCALE);
        let pupilY = constrain(this.vy * 0.5 * SCALE, -3 * SCALE, 3 * SCALE);
        fill(50, 180, 100); ellipse(-12 * SCALE + pupilX, -8 * SCALE + pupilY, 8 * SCALE, 10 * SCALE); ellipse(12 * SCALE + pupilX, -8 * SCALE + pupilY, 8 * SCALE, 10 * SCALE);
        fill(255, 255, 255, 200); ellipse(-14 * SCALE + pupilX, -10 * SCALE + pupilY, 3 * SCALE, 3 * SCALE); ellipse(10 * SCALE + pupilX, -10 * SCALE + pupilY, 3 * SCALE, 3 * SCALE);
        stroke(80, 40, 100); strokeWeight(2 * SCALE); noFill(); arc(0, 2 * SCALE, 20 * SCALE, 15 * SCALE, 0, PI);
        strokeWeight(1 * SCALE); line(-6 * SCALE, 2 * SCALE, -6 * SCALE, 6 * SCALE); line(-2 * SCALE, 2 * SCALE, -2 * SCALE, 6 * SCALE); line(2 * SCALE, 2 * SCALE, 2 * SCALE, 6 * SCALE); line(6 * SCALE, 2 * SCALE, 6 * SCALE, 6 * SCALE);
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
    }
}

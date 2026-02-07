/* ============================================
   OBSTACLES - ENEMIES, PLATFORMS, POWERUPS
   ============================================ */

"use strict";

// ========== PLATFORMS ==========
class Platform {
    constructor(x, y, width, height) {
        this.x = x; this.y = y; this.width = width; this.height = height || (30 * scaleY);
        this.toRemove = false;
        this.decorSeed = floor(random(100000));
        
        // Only spawn entities on platforms wide enough
        if (this.width < GAME_CONFIG.PLATFORM_MIN_WIDTH_FOR_SPAWNS) return;
        
        // Single RNG roll for spawn type:
        // 0-0.25: 1 crab (25%)
        // 0.25-0.30: 2 crabs (5%)
        // 0.30-0.40: speed powerup (10%)
        // 0.40-0.50: shield powerup (10%)
        // 0.50-1.00: nothing (50%)
        let spawnRoll = random();
        let spawnType = 'nothing';
        let crabCount = 0;
        
        if (spawnRoll < 0.25) {
            spawnType = 'crab';
            crabCount = 1;
        } else if (spawnRoll < 0.30) {
            spawnType = 'crab';
            crabCount = 2;
        } else if (spawnRoll < 0.40) {
            spawnType = 'speed';
        } else if (spawnRoll < 0.50) {
            spawnType = 'shield';
        }
        
        // Spawn crabs if rolled
        if (crabCount > 0) {
            // Only spawn 1 crab maximum per platform
            crabCount = 1;
            
            for (let i = 0; i < crabCount; i++) {
                let crabX = this.x + random(50 * scaleX, this.width - 50 * scaleX);
                // Position crab on top of platform - use crab size to place properly
                let crabSize = 35 * SCALE;
                let crabY = this.y - crabSize;
                
                // Only skip spawning if near start AND too close to Carl
                let shouldSpawn = true;
                
                if (typeof game !== 'undefined' && game && typeof game.seaLevel !== 'undefined') {
                    let nearStart = Math.abs(this.y - game.seaLevel) < GAME_CONFIG.PLATFORM_START_SAFE_ZONE;
                    
                    if (nearStart && typeof carl !== 'undefined' && carl) {
                        let safeRadius = GAME_CONFIG.PLATFORM_CRAB_SAFE_RADIUS;
                        let distToCarl = dist(crabX, crabY, carl.x, carl.y);
                        if (distToCarl <= safeRadius) {
                            shouldSpawn = false;
                        }
                    }
                }
                
                if (shouldSpawn) {
                    enemies.push(new Crab(crabX, crabY, this.x, this.x + this.width));
                }
            }
        }
        
        // Spawn powerup if rolled (only if no powerup already exists)
        if ((spawnType === 'speed' || spawnType === 'shield') && powerups.length === 0) {
            let powerupSize = 30 * SCALE;
            powerups.push(new Powerup(this.x + this.width / 2, this.y - powerupSize - 10 * scaleY, spawnType));
        }
    }
    
    update() {
        // Don't despawn boss platforms
        if (this.bossPlatform) return;
        
        if (this.y - game.cameraY > height + 200) this.toRemove = true;
    }
    
    draw() {
        push(); translate(0, -game.cameraY);
        fill(0, 0, 0, 50); rect(this.x + 5 * scaleX, this.y + 5 * scaleY, this.width, this.height, 5 * SCALE);
        fill(120, 100, 80); noStroke(); rect(this.x, this.y, this.width, this.height, 5 * SCALE);
        fill(80, 140, 60); rect(this.x, this.y, this.width, 8 * scaleY, 5 * SCALE, 5 * SCALE, 0, 0);
        fill(100, 85, 70);
        randomSeed(this.decorSeed);
        for (let i = 0; i < this.width; i += 40 * scaleX) {
            let rockX = this.x + i + random(-5, 5) * scaleX;
            let rockY = this.y + 10 * scaleY + random(-3, 3) * scaleY;
            ellipse(rockX, rockY, 15 * SCALE, 12 * SCALE);
        }
        randomSeed(frameCount);
        pop();
    }
}

function generatePlatforms() {
    while (lastPlatformY > game.cameraY - height * 3) {
        let gap = random(GAME_CONFIG.PLATFORM_GAP_MIN, GAME_CONFIG.PLATFORM_GAP_MAX);
        lastPlatformY -= gap;
        
        // Stop generating platforms near/above water surface
        if (lastPlatformY < game.surfaceGoal + 500) {
            break;
        }
        
        // Don't generate platforms too close to starting position (ocean floor)
        if (lastPlatformY > game.seaLevel - GAME_CONFIG.PLATFORM_START_SAFE_ZONE) {
            continue;
        }
        
        let platformCount = floor(random(1, 3));
        for (let i = 0; i < platformCount; i++) {
            let platformWidth = random(GAME_CONFIG.PLATFORM_WIDTH_MIN, GAME_CONFIG.PLATFORM_WIDTH_MAX);
            let platformHeight = (random() > 0.7 ? random(30, 50) : random(80, 200)) * scaleY;
            let platformX = random(50 * scaleX, width - platformWidth - 50 * scaleX);
            platforms.push(new Platform(platformX, lastPlatformY + random(-150, 150) * scaleY, platformWidth, platformHeight));
        }
    }
}

// ========== ENEMIES ==========

// Helper function to count enemies of a specific type
function countEnemyType(type) {
    return enemies.filter(e => e.type === type).length;
}

class Enemy {
    constructor(type, x, y) {
        this.type = type; this.x = x; this.y = y; this.toRemove = false; this.animFrame = random(TWO_PI);
    }
    update() {
        this.animFrame += 0.1;
        // Remove enemies far off-screen to allow new ones to spawn
        // Measure from center of screen for even distribution
        let screenCenterY = game.cameraY + height / 2;
        if (abs(this.y - screenCenterY) > height * GAME_CONFIG.ENEMY_REMOVAL_DISTANCE) this.toRemove = true;
    }
    checkCollision(carl) {
        let d = dist(this.x, this.y, carl.x, carl.y);
        return d < (this.size + carl.size) * 0.7;
    }
}

class Jellyfish extends Enemy {
    constructor(x, y) {
        super('jellyfish', x, y);
        this.size = 40 * SCALE; this.bobSpeed = 0.05; this.bobAmount = 30 * scaleY; this.baseY = y;
    }
    update() {
        super.update();
        this.y = this.baseY + sin(this.animFrame * this.bobSpeed * 50) * this.bobAmount;
    }
    draw() {
        push(); translate(this.x, this.y - game.cameraY);
        fill(255, 150, 200, 200); noStroke(); arc(0, 0, this.size * 1.2, this.size, PI, TWO_PI);
        fill(255, 200, 220, 150); arc(0, -5 * SCALE, this.size * 0.8, this.size * 0.6, PI, TWO_PI);
        stroke(255, 100, 150, 180); strokeWeight(3 * SCALE);
        for (let i = 0; i < 6; i++) {
            let offset = (i - 2.5) * 8 * SCALE;
            let wave = sin(this.animFrame + i) * 10 * SCALE;
            noFill(); beginShape(); vertex(offset, this.size * 0.5);
            bezierVertex(offset + wave, this.size * 0.7, offset - wave, this.size * 0.9, offset + wave * 0.5, this.size * 1.2);
            endShape();
        }
        pop();
    }
}

class Crab extends Enemy {
    constructor(x, y, leftBound, rightBound) {
        super('crab', x, y);
        this.size = 35 * SCALE; 
        this.speedMultiplier = random(0.8, 1.2); // ±20% speed variation
        this.speed = ENEMY_CONFIG.CRAB_SPEED * this.speedMultiplier;
        this.direction = random() > 0.5 ? 1 : -1;
        this.leftBound = leftBound; this.rightBound = rightBound;
    }
    update() {
        this.animFrame += 0.1;
        // Only remove crabs when they're far BELOW screen center (already passed)
        // Don't remove them when they're above (not yet reached)
        let screenCenterY = game.cameraY + height / 2;
        if (this.y > screenCenterY + height * GAME_CONFIG.ENEMY_REMOVAL_DISTANCE) this.toRemove = true;
        
        this.x += this.speed * this.direction;
        if (this.x <= this.leftBound + 20 || this.x >= this.rightBound - 20) this.direction *= -1;
    }
    draw() {
        push(); translate(this.x, this.y - game.cameraY);
        if (this.direction < 0) scale(-1, 1);
        fill(220, 80, 60); noStroke(); ellipse(0, 0, this.size, this.size * 0.7);
        stroke(180, 60, 40); strokeWeight(2 * SCALE); noFill();
        for (let i = -1; i <= 1; i++) arc(i * 8 * SCALE, -5 * SCALE, 12 * SCALE, 12 * SCALE, 0, PI);
        fill(240, 100, 80); noStroke();
        push(); translate(-this.size * 0.5, -5 * SCALE);
        ellipse(0, 0, 15 * SCALE, 10 * SCALE); triangle(-5 * SCALE, 0, -12 * SCALE, -8 * SCALE, -8 * SCALE, -3 * SCALE); pop();
        push(); translate(this.size * 0.5, -5 * SCALE);
        ellipse(0, 0, 15 * SCALE, 10 * SCALE); triangle(5 * SCALE, 0, 12 * SCALE, -8 * SCALE, 8 * SCALE, -3 * SCALE); pop();
        stroke(220, 80, 60); strokeWeight(3 * SCALE);
        line(-8 * SCALE, -8 * SCALE, -8 * SCALE, -15 * SCALE); line(8 * SCALE, -8 * SCALE, 8 * SCALE, -15 * SCALE);
        fill(255); noStroke(); circle(-8 * SCALE, -16 * SCALE, 8 * SCALE); circle(8 * SCALE, -16 * SCALE, 8 * SCALE);
        fill(0); circle(-8 * SCALE, -16 * SCALE, 4 * SCALE); circle(8 * SCALE, -16 * SCALE, 4 * SCALE);
        stroke(220, 80, 60); strokeWeight(2 * SCALE);
        for (let i = -2; i <= 2; i++) {
            if (i === 0) continue;
            let legX = i * 8 * SCALE;
            let legBob = sin(this.animFrame + i) * 2 * SCALE;
            line(legX, this.size * 0.3, legX, this.size * 0.5 + legBob);
        }
        pop();
    }
}

class Mine extends Enemy {
    constructor(x, y) {
        super('mine', x, y);
        this.size = 35 * SCALE; this.rotationSpeed = 0.02; this.rotation = 0;
    }
    update() {
        super.update(); this.rotation += this.rotationSpeed;
    }
    draw() {
        push(); translate(this.x, this.y - game.cameraY); rotate(this.rotation);
        fill(60, 60, 70); noStroke(); circle(0, 0, this.size);
        fill(40, 40, 50); arc(0, 0, this.size, this.size, PI * 0.5, PI * 1.5);
        fill(80, 80, 90);
        for (let i = 0; i < 8; i++) {
            let angle = (TWO_PI / 8) * i;
            push(); rotate(angle); rect(-3 * SCALE, this.size * 0.5, 6 * SCALE, 15 * SCALE); ellipse(0, this.size * 0.5 + 15 * SCALE, 8 * SCALE, 8 * SCALE); pop();
        }
        let pulseAlpha = map(sin(this.animFrame * 5), -1, 1, 100, 255);
        fill(255, 0, 0, pulseAlpha); circle(0, 0, 8 * SCALE);
        pop();
    }
}

class Urchin extends Enemy {
    constructor(x, y) {
        super('urchin', x, y);
        this.size = 45 * SCALE; this.spikeCount = 16;
    }
    draw() {
        push(); translate(this.x, this.y - game.cameraY);
        stroke(90, 50, 110); strokeWeight(4 * SCALE);
        for (let i = 0; i < this.spikeCount; i++) {
            let angle = (TWO_PI / this.spikeCount) * i;
            let len = this.size * 0.8 + sin(this.animFrame + i) * 5 * SCALE;
            let x1 = cos(angle) * (this.size * 0.3);
            let y1 = sin(angle) * (this.size * 0.3);
            let x2 = cos(angle) * len;
            let y2 = sin(angle) * len;
            line(x1, y1, x2, y2);
        }
        fill(120, 70, 140); noStroke(); circle(0, 0, this.size * 0.6);
        fill(100, 50, 120);
        for (let i = 0; i < 5; i++) {
            let angle = (TWO_PI / 5) * i + this.animFrame * 0.5;
            let x = cos(angle) * 8 * SCALE;
            let y = sin(angle) * 8 * SCALE;
            circle(x, y, 6 * SCALE);
        }
        pop();
    }
}

class SideJellyfish extends Enemy {
    constructor(x, y, direction) {
        super('sidejellyfish', x, y);
        this.size = 45 * SCALE; 
        this.speedMultiplier = random(0.8, 1.2); // ±20% speed variation
        // Boss mode speed boost: 1.5x faster
        let bossModeBoost = (typeof game !== 'undefined' && game.bossMode) ? 1.5 : 1.0;
        this.speed = 4 * scaleX * this.speedMultiplier * bossModeBoost;
        this.direction = direction;
        this.bobAmount = 40 * scaleY; this.baseY = y;
    }
    update() {
        super.update();
        // Add speed boost based on Carl's vertical speed
        let carlVerticalSpeed = Math.abs(carl.vy);
        let speedBoost = carlVerticalSpeed > 5 ? (carlVerticalSpeed - 5) * 0.15 * scaleX : 0;
        this.x += (this.speed + speedBoost) * this.direction;
        this.y = this.baseY + sin(this.animFrame * 3) * this.bobAmount;
        // Despawn when off-screen horizontally OR vertically
        if (this.x < -100 || this.x > width + 100) this.toRemove = true;
    }
    draw() {
        push(); translate(this.x, this.y - game.cameraY);
        if (this.direction < 0) scale(-1, 1);
        fill(180, 100, 255, 200); noStroke(); arc(0, 0, this.size * 1.3, this.size * 1.1, PI, TWO_PI);
        fill(200, 150, 255, 150); arc(0, -5 * SCALE, this.size * 0.9, this.size * 0.7, PI, TWO_PI);
        stroke(160, 80, 230, 180); strokeWeight(3 * SCALE);
        for (let i = 0; i < 8; i++) {
            let offset = (i - 3.5) * 7 * SCALE;
            let wave = sin(this.animFrame + i) * 12 * SCALE;
            noFill(); beginShape(); vertex(offset, this.size * 0.55);
            bezierVertex(offset + wave, this.size * 0.75, offset - wave, this.size * 0.95, offset + wave * 0.5, this.size * 1.3);
            endShape();
        }
        pop();
    }
}

class Shark extends Enemy {
    constructor(x, y, direction) {
        super('shark', x, y);
        this.size = 60 * SCALE; 
        this.speedMultiplier = random(0.8, 1.2); // ±20% speed variation
        // Boss mode speed boost: 1.5x faster
        let bossModeBoost = (typeof game !== 'undefined' && game.bossMode) ? 1.5 : 1.0;
        this.speed = ENEMY_CONFIG.SHARK_SPEED * this.speedMultiplier * bossModeBoost;
        this.direction = direction;
    }
    update() {
        super.update();
        // Add speed boost based on Carl's vertical speed
        let carlVerticalSpeed = Math.abs(carl.vy);
        let speedBoost = carlVerticalSpeed > 5 ? (carlVerticalSpeed - 5) * 0.15 * scaleX : 0;
        this.x += (this.speed + speedBoost) * this.direction;
        // Despawn when off-screen horizontally OR vertically
        if (this.x < -150 || this.x > width + 150) this.toRemove = true;
    }
    draw() {
        push(); translate(this.x, this.y - game.cameraY);
        if (this.direction < 0) scale(-1, 1);
        fill(100, 120, 140); noStroke();
        ellipse(0, 0, this.size * 1.4, this.size * 0.6);
        triangle(this.size * 0.7, 0, this.size * 1.1, 0, this.size * 0.9, -this.size * 0.4);
        triangle(-this.size * 0.6, 0, -this.size * 0.9, 0, -this.size * 0.75, this.size * 0.5);
        triangle(-this.size * 0.6, 0, -this.size * 0.9, 0, -this.size * 0.75, -this.size * 0.5);
        fill(80, 100, 120);
        triangle(this.size * 0.2, -this.size * 0.3, this.size * 0.5, -this.size * 0.3, this.size * 0.35, -this.size * 0.7);
        fill(255); circle(this.size * 0.4, -this.size * 0.15, 12 * SCALE);
        fill(0); circle(this.size * 0.4, -this.size * 0.15, 6 * SCALE);
        fill(200, 210, 220); arc(-this.size * 0.3, this.size * 0.1, this.size * 0.6, this.size * 0.3, 0, PI);
        stroke(80, 90, 100); strokeWeight(2 * SCALE); noFill();
        for (let i = 0; i < 5; i++) {
            let x = -this.size * 0.5 + i * 8 * SCALE;
            line(x, this.size * 0.1, x + 4 * SCALE, this.size * 0.25);
        }
        pop();
    }
}

class Bomb extends Enemy {
    constructor(x, y, direction) {
        super('bomb', x, y);
        this.size = 70 * SCALE; 
        this.speedMultiplier = random(0.8, 1.2); // ±20% speed variation
        // Boss mode speed boost: 1.5x faster
        let bossModeBoost = (typeof game !== 'undefined' && game.bossMode) ? 1.5 : 1.0;
        this.speed = ENEMY_CONFIG.BOMB_SPEED * this.speedMultiplier * bossModeBoost;
        this.direction = direction;
        this.exploding = false; this.explosionTimer = 0; this.maxExplosionTime = 30;
    }
    update() {
        super.update();
        if (this.exploding) {
            this.explosionTimer++;
            if (this.explosionTimer >= this.maxExplosionTime) this.toRemove = true;
        } else {
            // Add speed boost based on Carl's vertical speed
            let carlVerticalSpeed = Math.abs(carl.vy);
            let speedBoost = carlVerticalSpeed > 5 ? (carlVerticalSpeed - 5) * 0.15 * scaleX : 0;
            this.x += (this.speed + speedBoost) * this.direction;
            if (this.x < -150 || this.x > width + 150) this.toRemove = true;
        }
    }
    checkCollision(carl) {
        if (this.exploding) return false;
        let d = dist(this.x, this.y, carl.x, carl.y);
        if (d < (this.size + carl.size) * 0.7) {
            this.exploding = true;
            return true;
        }
        return false;
    }
    draw() {
        push(); translate(this.x, this.y - game.cameraY);
        if (this.exploding) {
            let progress = this.explosionTimer / this.maxExplosionTime;
            let explosionSize = this.size * 3 * progress;
            let alpha = 255 * (1 - progress);
            fill(255, 150, 0, alpha); noStroke(); circle(0, 0, explosionSize);
            fill(255, 200, 100, alpha * 0.7); circle(0, 0, explosionSize * 0.7);
            fill(255, 255, 200, alpha * 0.5); circle(0, 0, explosionSize * 0.4);
            for (let i = 0; i < 8; i++) {
                let angle = (TWO_PI / 8) * i + this.explosionTimer * 0.1;
                let len = explosionSize * 0.6;
                stroke(255, 180, 50, alpha); strokeWeight(3 * SCALE);
                line(0, 0, cos(angle) * len, sin(angle) * len);
            }
        } else {
            fill(60, 60, 70); noStroke(); circle(0, 0, this.size);
            fill(40, 40, 50); arc(0, 0, this.size, this.size, PI * 0.5, PI * 1.5);
            fill(80, 80, 90);
            for (let i = 0; i < 12; i++) {
                let angle = (TWO_PI / 12) * i;
                push(); rotate(angle); rect(-2 * SCALE, this.size * 0.5, 4 * SCALE, this.size * 0.3); pop();
            }
            let pulseAlpha = map(sin(this.animFrame * 5), -1, 1, 100, 255);
            fill(255, 50, 50, pulseAlpha); circle(0, 0, 10 * SCALE);
            fill(255, 255, 255, 80); circle(-this.size * 0.2, -this.size * 0.2, this.size * 0.25);
        }
        pop();
    }
}

class Fishhook extends Enemy {
    constructor(x, y) {
        super('fishhook', x, y);
        this.size = 40 * SCALE; this.baseY = y; this.swayAmount = 15 * scaleY;
    }
    update() {
        super.update();
        this.y = this.baseY + sin(this.animFrame * 0.5) * this.swayAmount;
    }
    draw() {
        push(); translate(this.x, this.y - game.cameraY);
        let lineLength = 300 * scaleY;
        let segments = 20;
        for (let i = 0; i < segments; i++) {
            let progress = i / segments;
            let alpha = 255 * (1 - progress);
            let yPos = -this.size * 0.5 - (lineLength * progress);
            stroke(80, 80, 80, alpha); strokeWeight(2 * SCALE);
            let nextProgress = (i + 1) / segments;
            let nextYPos = -this.size * 0.5 - (lineLength * nextProgress);
            line(0, yPos, 0, nextYPos);
        }
        fill(150, 150, 160); noStroke();
        ellipse(0, -this.size * 0.5, 12 * SCALE, 8 * SCALE);
        stroke(180, 180, 190); strokeWeight(5 * SCALE); noFill();
        arc(0, 0, this.size * 0.8, this.size * 0.8, PI * 0.2, PI * 1.3);
        noStroke(); fill(180, 180, 190);
        triangle(-this.size * 0.15, this.size * 0.4, this.size * 0.15, this.size * 0.4, 0, this.size * 0.6);
        fill(200, 100, 100); circle(this.size * 0.2, -this.size * 0.2, 10 * SCALE);
        pop();
    }
}

function spawnFloatingEnemies() {
    // Grace period: reduced spawn rate in first N seconds
    if (game.currentTime < GAME_CONFIG.GRACE_PERIOD_SECONDS && random() > GAME_CONFIG.GRACE_PERIOD_SPAWN_CHANCE) {
        return;
    }
    
    // Don't spawn enemies near/above water surface
    if (game.cameraY < game.surfaceGoal + 1000) {
        return;
    }
    
    let maxEnemies = GAME_CONFIG.MAX_TOTAL_ENEMIES;
    // Hard cap - no spawning if at max (exclude crabs from count)
    let nonCrabEnemies = enemies.filter(e => e.type !== 'crab').length;
    if (nonCrabEnemies >= maxEnemies) {
        return;
    }
    
    // Scale spawn chance based on enemy count (more enemies = harder to spawn)
    let enemyRatio = nonCrabEnemies / maxEnemies;
    let baseSpawnChance = map(enemyRatio, 0, 1, GAME_CONFIG.SPAWN_CHANCE_FLOATING_MIN, GAME_CONFIG.SPAWN_CHANCE_FLOATING_MAX);
    
    // Gradual ramp-up: reduce spawn chance at game start
    let timeMultiplier = 1.0;
    if (game.currentTime < 2) {
        timeMultiplier = 10.0; // 10% spawn chance (0-2 seconds)
    } else if (game.currentTime < 5) {
        timeMultiplier = 4.0; // 25% spawn chance (2-5 seconds)
    } else if (game.currentTime < 10) {
        timeMultiplier = 1.67; // 60% spawn chance (5-10 seconds)
    }
    
    // Increase spawn rate when Carl is moving fast upward
    let carlVerticalSpeed = Math.abs(carl.vy);
    let speedMultiplier = 1.0;
    if (carlVerticalSpeed > 3) {
        // For every 2 units of vertical speed, increase spawn rate dramatically
        speedMultiplier = 1.0 + (carlVerticalSpeed - 3) * 0.08;
        speedMultiplier = Math.min(speedMultiplier, 3.5); // Cap at 3.5x spawn rate
    }
    // Divide by multipliers to lower the threshold and increase spawn rate
    let spawnChance = (baseSpawnChance * timeMultiplier) / speedMultiplier;
    
    if (random() > spawnChance) {
        let safeRadius = GAME_CONFIG.ENEMY_SAFE_RADIUS;
        let spawnX, spawnY;
        let attempts = 0;
        
        // Spawn ahead of Carl's movement direction
        let verticalOffset = 0;
        if (carl.vy < -3) {
            // Moving up - spawn further above screen
            verticalOffset = -height * map(Math.abs(carl.vy), 3, 20, 0.3, 1.0);
        } else if (carl.vy > 3) {
            // Moving down - spawn further below screen
            verticalOffset = height * map(carl.vy, 3, 20, 0.3, 1.0);
        }
        
        do {
            // Spawn in upper portion of screen with wider variation
            spawnY = game.cameraY + random(-height * 0.2, height * 0.8) + verticalOffset;
            spawnX = random(width);
            attempts++;
        } while (dist(spawnX, spawnY, carl.x, carl.y) < safeRadius && attempts < 10);
        
        // Don't spawn if final position is in surface safe zone
        if (spawnY < game.surfaceGoal + 1000) {
            return;
        }
        
        // Don't spawn if below or too close to ocean floor (sea level)
        let oceanFloorSafeZone = game.seaLevel - 600 * scaleY; // 600 units above floor (tripled from 200)
        if (spawnY > oceanFloorSafeZone) {
            return;
        }
        
        if (attempts < 10) {
            let enemyType = floor(random(3));
            if (enemyType === 0) {
                // Check jellyfish limit - only count regular jellyfish, not side jellyfish
                let regularJellyfishCount = enemies.filter(e => e.type === 'jellyfish').length;
                if (regularJellyfishCount < ENEMY_LIMITS['jellyfish']) {
                    enemies.push(new Jellyfish(spawnX, spawnY));
                }
            } else if (enemyType === 1) {
                // Check urchin limit (max 3)
                if (countEnemyType('urchin') < ENEMY_LIMITS['urchin']) {
                    enemies.push(new Urchin(spawnX, spawnY));
                }
            } else {
                // Check small mine limit (max 4)
                if (countEnemyType('mine') < ENEMY_LIMITS['mine']) {
                    enemies.push(new Mine(spawnX, spawnY));
                }
            }
        }
    }
}

function spawnSideEnemies() {
    // Cooldown check to prevent bunching
    let now = Date.now();
    let carlSpeed = Math.abs(carl.vy);
    
    // In boss mode, much more aggressive spawning when underwater
    let cooldown = game.bossMode ? 800 : (carlSpeed > 10 ? 50 : 150);
    if (now - game.lastSideEnemySpawnTime < cooldown) {
        return;
    }
    
    // In boss mode, only spawn if Carl is underwater (to prevent camping)
    if (game.bossMode) {
        // Only spawn when Carl is underwater
        if (carl.y <= game.surfaceGoal) {
            return; // Carl is above water, don't spawn
        }
        
        // Increased limits in boss mode: max 4 sharks, 2 bombs, and 3 jellyfish at a time
        let sharkCount = enemies.filter(e => e.type === 'shark').length;
        let bombCount = enemies.filter(e => e.type === 'bomb').length;
        let jellyfishCount = enemies.filter(e => e.type === 'sidejellyfish').length;
        
        // Allow spawning if we're under the limits
        if (sharkCount >= 4 && bombCount >= 2 && jellyfishCount >= 3) {
            return; // Already at limit
        }
        
        // Increased spawn chance in boss mode - from 70% to 85%
        if (random() > 0.15) { // Changed from 0.3 to 0.15
            return;
        }
        
        // Update spawn time
        game.lastSideEnemySpawnTime = Date.now();
        
        let direction = random() > 0.5 ? 1 : -1;
        let spawnX = direction > 0 ? -100 * scaleX : width + 100 * scaleX;
        let spawnY = game.surfaceGoal + random(100 * scaleY, 400 * scaleY); // Spawn in water zone
        
        // Decide what to spawn based on what we need
        let availableTypes = [];
        if (sharkCount < 4) availableTypes.push('shark');
        if (bombCount < 2) availableTypes.push('bomb');
        if (jellyfishCount < 3) availableTypes.push('jellyfish');
        
        if (availableTypes.length === 0) return;
        
        // Choose randomly from available types
        let spawnType = availableTypes[floor(random(availableTypes.length))];
        
        if (spawnType === 'shark') {
            enemies.push(new Shark(spawnX, spawnY, direction));
        } else if (spawnType === 'bomb') {
            enemies.push(new Bomb(spawnX, spawnY, direction));
        } else if (spawnType === 'jellyfish') {
            enemies.push(new SideJellyfish(spawnX, spawnY, direction));
        }
        
        return; // Exit early for boss mode
    }
    
    // Regular game mode logic below
    // Grace period: reduced spawn rate in first N seconds
    if (game.currentTime < GAME_CONFIG.GRACE_PERIOD_SECONDS && random() > GAME_CONFIG.GRACE_PERIOD_SPAWN_CHANCE) {
        return;
    }
    
    // Don't spawn enemies near/above water surface (unless in boss mode with Carl underwater)
    if (!game.bossMode && game.cameraY < game.surfaceGoal + 1000) {
        return;
    }
    
    let maxEnemies = GAME_CONFIG.MAX_TOTAL_ENEMIES;
    // Hard cap - no spawning if at max (exclude crabs from count)
    let nonCrabEnemies = enemies.filter(e => e.type !== 'crab').length;
    if (nonCrabEnemies >= maxEnemies) {
        return;
    }
    
    // Scale spawn chance based on enemy count (more enemies = harder to spawn)
    let enemyRatio = nonCrabEnemies / maxEnemies;
    let baseSpawnChance = map(enemyRatio, 0, 1, GAME_CONFIG.SPAWN_CHANCE_SIDE_MIN, GAME_CONFIG.SPAWN_CHANCE_SIDE_MAX);
    
    // Gradual ramp-up: reduce spawn chance at game start
    let timeMultiplier = 1.0;
    if (game.currentTime < 2) {
        timeMultiplier = 10.0; // 10% spawn chance (0-2 seconds)
    } else if (game.currentTime < 5) {
        timeMultiplier = 4.0; // 25% spawn chance (2-5 seconds)
    } else if (game.currentTime < 10) {
        timeMultiplier = 1.67; // 60% spawn chance (5-10 seconds)
    }
    
    // Increase spawn rate when Carl is moving fast vertically
    let carlVerticalSpeed = Math.abs(carl.vy);
    let speedMultiplier = 1.0;
    if (carlVerticalSpeed > 3) {
        // For every 2 units of vertical speed, increase spawn rate dramatically
        speedMultiplier = 1.0 + (carlVerticalSpeed - 3) * 0.08;
        speedMultiplier = Math.min(speedMultiplier, 3.5); // Cap at 3.5x spawn rate
    }
    // Divide by multipliers to lower the threshold and increase spawn rate
    let spawnChance = (baseSpawnChance * timeMultiplier) / speedMultiplier;
    
    if (random() > spawnChance) {
        // Update spawn time to prevent immediate next spawn
        game.lastSideEnemySpawnTime = Date.now();
        
        let safeRadius = GAME_CONFIG.ENEMY_SAFE_RADIUS;
        
        // Base spawn at screen center for better distribution
        let screenCenterY = game.cameraY + height / 2;
        
        // Spawn ahead based on Carl's vertical movement direction
        let verticalOffset = 0;
        if (carl.vy < -3) {
            // Moving up - spawn above screen proportional to speed
            verticalOffset = -height * map(Math.abs(carl.vy), 3, 20, 0.5, 1.8);
        } else if (carl.vy > 3) {
            // Moving down - spawn below screen proportional to speed
            verticalOffset = height * map(carl.vy, 3, 20, 0.5, 1.8);
        }
        
        // When stationary: spawn around center ±50% of screen height
        // When fast: spawn ahead with offset
        let spawnY = screenCenterY + random(-height * 0.5, height * 0.5) + verticalOffset;
        
        // In boss mode, spawn near water level
        if (game.bossMode) {
            spawnY = game.surfaceGoal + random(50 * scaleY, 300 * scaleY);
        }
        
        // Don't spawn if final position is in surface safe zone (unless boss mode)
        if (!game.bossMode && spawnY < game.surfaceGoal + 1000) {
            return;
        }
        
        // Don't spawn if below or too close to ocean floor (sea level)
        let oceanFloorSafeZone = game.seaLevel - 600 * scaleY; // 600 units above floor (tripled from 200)
        if (spawnY > oceanFloorSafeZone) {
            return;
        }
        
        if (Math.abs(spawnY - carl.y) < safeRadius) {
            return;
        }
        
        let direction = random() > 0.5 ? 1 : -1;
        // Use screen-width relative spawn positions
        let spawnX = direction > 0 ? -100 * scaleX : width + 100 * scaleX;
        
        // In boss mode, only spawn sharks and bombs
        let enemyType;
        if (game.bossMode) {
            // Count current sharks and bombs
            let sharkCount = enemies.filter(e => e.type === 'shark').length;
            let bombCount = enemies.filter(e => e.type === 'bomb').length;
            
            // Prefer spawning what we're missing
            if (sharkCount < 2 && bombCount < 1) {
                enemyType = random() > 0.33 ? 1 : 2; // 67% shark, 33% bomb
            } else if (sharkCount < 2) {
                enemyType = 1; // Spawn shark
            } else if (bombCount < 1) {
                enemyType = 2; // Spawn bomb
            } else {
                return; // At limit
            }
        } else {
            enemyType = floor(random(4));
        }
        
        if (enemyType === 3 && !game.bossMode) {
            let hookX = random(width * 0.2, width * 0.8);
            if (dist(hookX, spawnY, carl.x, carl.y) < safeRadius) {
                return;
            }
            // Check fishhook limit (max 3)
            if (countEnemyType('fishhook') < ENEMY_LIMITS['fishhook']) {
                enemies.push(new Fishhook(hookX, spawnY));
            }
        } else {
            // Check full distance for side-spawning enemies too
            if (dist(spawnX, spawnY, carl.x, carl.y) < safeRadius) {
                return;
            }
            if (enemyType === 0 && !game.bossMode) {
                if (countEnemyType('sidejellyfish') < ENEMY_LIMITS['sidejellyfish']) {
                    enemies.push(new SideJellyfish(spawnX, spawnY, direction));
                }
            } else if (enemyType === 1) {
                // Check shark limit
                let maxSharks = game.bossMode ? 2 : ENEMY_LIMITS['shark'];
                if (countEnemyType('shark') < maxSharks) {
                    enemies.push(new Shark(spawnX, spawnY, direction));
                }
            } else if (enemyType === 2) {
                // Check bomb limit
                let maxBombs = game.bossMode ? 1 : ENEMY_LIMITS['bomb'];
                if (countEnemyType('bomb') < maxBombs) {
                    enemies.push(new Bomb(spawnX, spawnY, direction));
                }
            }
        }
    }
}

// ========== POWERUPS ==========
class Powerup {
    constructor(x, y, type) {
        this.x = x; this.y = y; this.type = type; this.size = 30 * SCALE;
        this.collected = false; this.toRemove = false; this.animFrame = 0;
        this.bobAmount = 10 * scaleY; this.baseY = y;
    }
    update() {
        this.animFrame += 0.1;
        this.y = this.baseY + sin(this.animFrame) * this.bobAmount;
        if (!this.collected) {
            let d = dist(this.x, this.y, carl.x, carl.y);
            if (d < this.size + carl.size) this.collect();
        }
        // Only remove powerups when far BELOW camera (already passed), not above (not yet reached)
        if (this.y - game.cameraY > height * 2) this.toRemove = true;
    }
    collect() {
        this.collected = true; this.toRemove = true;
        sounds.play('powerup');
        if (this.type === 'speed') {
            carl.applySpeedBoost(CARL_CONFIG.SPEED_BOOST_DURATION);
        } else if (this.type === 'shield') {
            carl.hasShield = true;
        }
        for (let i = 0; i < 15; i++) particles.push(new Particle(this.x, this.y, 'powerup'));
    }
    draw() {
        if (this.collected) return;
        push(); translate(this.x, this.y - game.cameraY); rotate(this.animFrame);
        
        if (this.type === 'speed') {
            fill(255, 255, 0, 100); noStroke(); circle(0, 0, this.size * 1.5);
            fill(255, 220, 0);
        } else if (this.type === 'shield') {
            fill(100, 200, 255, 100); noStroke(); circle(0, 0, this.size * 1.5);
            fill(100, 180, 255);
        }
        
        beginShape();
        for (let i = 0; i < 10; i++) {
            let angle = (TWO_PI / 10) * i;
            let r = i % 2 === 0 ? this.size * 0.6 : this.size * 0.3;
            let x = cos(angle) * r;
            let y = sin(angle) * r;
            vertex(x, y);
        }
        endShape(CLOSE);
        
        fill(255, 100, 0); textAlign(CENTER, CENTER); textSize(16); textStyle(BOLD);
        if (this.type === 'speed') {
            text('⚡', 0, 0);
        } else if (this.type === 'shield') {
            text('🛡', 0, 0);
        }
        pop();
    }
}

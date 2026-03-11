/* ============================================
   VISUAL EFFECTS - BACKGROUNDS, PARTICLES, BUBBLES
   ============================================ */

"use strict";

// ========== PARTICLES ==========
class Particle {
    constructor(x, y, type) {
        this.x = x; this.y = y;
        this.life = 255; this.size = random(5, 15) * SCALE; this.type = type; this.toRemove = false;
        
        // Shield particles explode radially in all directions
        if (type === 'shield') {
            let angle = random(TWO_PI);
            let baseSpeedX = random(3, 6) * scaleX;
            let baseSpeedY = random(3, 6) * scaleY;
            let xComponent = cos(angle);
            let yComponent = sin(angle);
            
            // Adjust speed based on direction - more speed upward, less downward
            let speedMultiplier = 1.0;
            if (yComponent < 0) {
                // Moving upward (negative y) - increase speed
                speedMultiplier = map(yComponent, -1, 0, 1.5, 1.0);
            } else {
                // Moving downward (positive y) - decrease speed
                speedMultiplier = map(yComponent, 0, 1, 1.0, 0.4);
            }
            
            this.vx = xComponent * baseSpeedX * speedMultiplier;
            this.vy = yComponent * baseSpeedY * speedMultiplier;
        } else if (type === 'pearl_burst') {
            // Radial explosion outward in all directions
            let angle = random(TWO_PI);
            let speed = random(2.5, 7.0) * SCALE;
            this.vx = cos(angle) * speed;
            this.vy = sin(angle) * speed;
        } else if (type === 'steam') {
            // Float upward and scatter slightly
            this.vx = random(-1.5, 1.5) * SCALE;
            this.vy = random(-4.5, -1.5) * SCALE;
        } else if (type === 'debris') {
            // Grey shards scatter outward (fishhook breaking)
            let angle = random(TWO_PI);
            let speed = random(1.5, 4.5);
            this.vx = cos(angle) * speed * scaleX;
            this.vy = sin(angle) * speed * scaleY - 1.5 * scaleY;
        } else if (type === 'fire') {
            // Fiery explosion particles (mine/bomb)
            let angle = random(TWO_PI);
            let speed = random(2, 6.5);
            this.vx = cos(angle) * speed * scaleX;
            this.vy = sin(angle) * speed * scaleY - random(1, 3) * scaleY; // upward bias
        } else if (type === 'electric') {
            // Fast electric scatter in all directions (jellyfish)
            let angle = random(TWO_PI);
            let speed = random(3, 8);
            this.vx = cos(angle) * speed * scaleX;
            this.vy = sin(angle) * speed * scaleY;
        } else {
            this.vx = random(-3, 3) * scaleX;
            this.vy = random(-3, 3) * scaleY;
        }
        
        if (type === 'hit') this.color = color(255, 100, 150);
        else if (type === 'boost') this.color = color(255, 255, 0);
        else if (type === 'powerup') this.color = color(255, 220, 0);
        else if (type === 'shield') this.color = color(100, 200, 255);
        else if (type === 'pearl') this.color = color(255, 130, 20);
        else if (type === 'pearl_burst') this.color = color(255, floor(random(50, 160)), 0);
        else if (type === 'steam') this.color = color(190, 190, 195);
        else if (type === 'debris') this.color = color(floor(random(120, 185)), floor(random(120, 185)), floor(random(130, 195)));
        else if (type === 'fire') this.color = color(255, floor(random(50, 210)), 0);
        else if (type === 'electric') this.color = color(floor(random(80, 200)), floor(random(180, 255)), 255);
        else this.color = color(150, 200, 255);

        // Per-type fade rate and gravity (overrides for steam and pearl_burst)
        this.fadeRate = 5;
        this.gravity = 0.2;
        if (type === 'pearl_burst') {
            this.size = random(8, 22) * SCALE;
            this.fadeRate = 9;
            this.gravity = 0.15;
        } else if (type === 'steam') {
            this.size = random(18, 40) * SCALE;
            this.fadeRate = 7;
            this.gravity = 0.04;
        } else if (type === 'debris') {
            this.size = random(4, 10) * SCALE;
            this.fadeRate = 6;
            this.gravity = 0.3;
        } else if (type === 'fire') {
            this.size = random(10, 24) * SCALE;
            this.fadeRate = 8;
            this.gravity = -0.08; // float upward slightly
        } else if (type === 'electric') {
            this.size = random(4, 9) * SCALE;
            this.fadeRate = 12; // fast fade
            this.gravity = 0.0;
        }
    }
    update() {
        this.x += this.vx; this.y += this.vy; this.vy += this.gravity; this.life -= this.fadeRate;
        if (this.life <= 0) this.toRemove = true;
    }
    draw() {
        push(); translate(0, -game.cameraY);
        this.color.setAlpha(this.life); fill(this.color); noStroke(); circle(this.x, this.y, this.size);
        pop();
    }
}

// ========== UNDERWATER SHOCKWAVE ==========
class Shockwave {
    constructor(x, y) {
        this.x = x; this.y = y;
        this.progress = 0;  // 0→1: expand, 1→2: implode
        this.toRemove = false;
        this.maxR = 200 * SCALE;
    }
    update() {
        this.progress += 0.045;
        if (this.progress >= 2.0) this.toRemove = true;
    }
    draw() {
        let r, alpha, weight;
        if (this.progress <= 1.0) {
            r = this.maxR * this.progress;
            alpha = map(this.progress, 0, 1, 200, 80);
            weight = map(this.progress, 0, 1, 5, 2.5) * SCALE;
        } else {
            r = this.maxR * (2.0 - this.progress);
            alpha = map(this.progress, 1, 2, 80, 0);
            weight = 2 * SCALE;
        }
        push();
        translate(0, -game.cameraY);
        noFill();
        stroke(0, 10, 35, alpha);
        strokeWeight(weight);
        circle(this.x, this.y, r * 2);
        stroke(0, 20, 55, alpha * 0.45);
        strokeWeight(max(1, weight * 0.6));
        circle(this.x, this.y, r * 1.55);
        pop();
    }
}

// ========== BOSS EXPLOSION PARTICLE ==========
class BossExplosionParticle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        let angle = random(TWO_PI);
        let speed = random(2.5, 7);
        this.vx = cos(angle) * speed;
        this.vy = sin(angle) * speed;
        this.life = 255;
        this.size = random(10, 40) * SCALE;
        this.toRemove = false;
        // Supernova colors
        let colors = [
            color(255, 255, 0),   // Yellow
            color(255, 150, 0),   // Orange
            color(255, 50, 0),    // Red-orange
            color(255, 255, 255), // White
        ];
        this.color = random(colors);
    }
    
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.98;
        this.vy *= 0.98;
        this.life -= 1.5;
        if (this.life <= 0) this.toRemove = true;
    }
    
    draw() {
        push();
        translate(0, -game.cameraY);
        this.color.setAlpha(this.life);
        fill(this.color);
        noStroke();
        circle(this.x, this.y, this.size);
        // Glow effect
        this.color.setAlpha(this.life * 0.3);
        circle(this.x, this.y, this.size * 2);
        pop();
    }
}

// ========== BACKGROUND LAYERS ==========
class BackgroundLayer {
    constructor(depth, color1, color2) {
        this.depth = depth; this.scrollSpeed = depth * 0.3;
        this.color1 = color1; this.color2 = color2; this.elements = [];
        for (let i = 0; i < 8; i++) {
            this.elements.push({
                x: random(width), y: random(-height * 3, height * 3),
                type: random() > 0.5 ? 'coral' : 'rock',
                size: random(30, 80) * depth, variant: floor(random(3))
            });
        }
    }
    update() {}
    draw() {
        push(); translate(0, -game.cameraY * this.scrollSpeed);
        for (let elem of this.elements) {
            // Don't draw background elements above the water surface
            if (elem.y < game.surfaceGoal) {
                continue;
            }
            
            push(); translate(elem.x, elem.y);
            let alpha = map(this.depth, 0, 1, 80, 180);
            if (elem.type === 'coral') {
                fill(this.color1.levels[0], this.color1.levels[1], this.color1.levels[2], alpha);
                noStroke();
                if (elem.variant === 0) {
                    rect(-elem.size * 0.1, 0, elem.size * 0.2, elem.size);
                    rect(-elem.size * 0.3, elem.size * 0.3, elem.size * 0.15, elem.size * 0.5);
                    rect(elem.size * 0.15, elem.size * 0.4, elem.size * 0.15, elem.size * 0.4);
                } else if (elem.variant === 1) {
                    triangle(0, elem.size, -elem.size * 0.5, 0, elem.size * 0.5, 0);
                } else {
                    ellipse(0, elem.size * 0.7, elem.size * 0.8, elem.size);
                }
            } else {
                fill(this.color2.levels[0], this.color2.levels[1], this.color2.levels[2], alpha);
                noStroke(); ellipse(0, 0, elem.size * 1.2, elem.size * 0.8);
            }
            pop();
        }
        pop();
    }
}

// ========== CLOUDS ==========
class Cloud {
    constructor(x, y) {
        this.x = x !== undefined ? x : random(-width, width * 2);
        this.y = y !== undefined ? y : random(game.surfaceGoal - 2000 * scaleY, game.surfaceGoal - 100 * scaleY);
        this.size = random(160, 340) * SCALE;
        this.speed = random(0.3, 0.8) * scaleX;
        this.puffCount = floor(random(3, 6));
        this.puffs = [];
        for (let i = 0; i < this.puffCount; i++) {
            this.puffs.push({
                offsetX: random(-this.size * 0.5, this.size * 0.5),
                offsetY: random(-this.size * 0.2, this.size * 0.2),
                size: random(this.size * 0.6, this.size)
            });
        }
    }
    
    update() {
        this.x += this.speed;
        // Wrap around when off screen
        if (this.x > width + this.size * 2) {
            this.x = -this.size * 2;
            this.y = random(game.surfaceGoal - 2000 * scaleY, game.surfaceGoal - 100 * scaleY);
        }
    }
    
    draw() {
        // Only draw if above water surface and on screen
        if (this.y > game.surfaceGoal) return;
        
        push();
        translate(0, -game.cameraY);
        noStroke();
        
        // Draw cloud puffs
        for (let puff of this.puffs) {
            fill(255, 255, 255, 200);
            ellipse(this.x + puff.offsetX, this.y + puff.offsetY, puff.size, puff.size * 0.8);
        }
        
        pop();
    }
}

// ========== CLOUD CEILING LAYER ==========
// A thick, dense cloud band above the boss fight area.
// Carl drifts into it during the pearl windup; above it the sky is dark.
class CloudLayer {
    constructor() {
        this.centerY  = game.surfaceGoal - 2350 * scaleY;
        this.halfThick = 300 * scaleY;
        this.puffs = [];
        for (let i = 0; i < 120; i++) {
            this.puffs.push({
                x:     random(-width * 0.1, width * 1.1),
                yOff:  random(-this.halfThick, this.halfThick),
                w:     random(250, 700) * SCALE,
                h:     random(100, 280) * SCALE,
                alpha: floor(random(160, 235))
            });
        }
    }

    draw() {
        push();
        translate(0, -game.cameraY);
        noStroke();

        let topY  = this.centerY - this.halfThick;
        let botY  = this.centerY + this.halfThick;
        let fadeH = this.halfThick * 0.7;

        // Base gradient fill — creates solid core with soft top/bottom edges
        let grad = drawingContext.createLinearGradient(0, topY - fadeH, 0, botY + fadeH);
        grad.addColorStop(0,    'rgba(225,235,255,0)');
        grad.addColorStop(0.22, 'rgba(225,235,255,210)');
        grad.addColorStop(0.78, 'rgba(225,235,255,210)');
        grad.addColorStop(1,    'rgba(225,235,255,0)');
        drawingContext.fillStyle = grad;
        drawingContext.fillRect(0, topY - fadeH, width, (botY + fadeH) - (topY - fadeH));

        // Puffs for fluffy texture
        for (let p of this.puffs) {
            fill(255, 255, 255, p.alpha);
            ellipse(p.x, this.centerY + p.yOff, p.w, p.h);
        }

        pop();
    }
}

// ========== STAR FIELD ==========
class StarField {
    constructor() {
        // Stars populate world-space well above the cloud ceiling
        const cloudTop = game.surfaceGoal - 2650 * scaleY;
        this.cloudTop = cloudTop;
        this.stars = [];
        for (let i = 0; i < 220; i++) {
            this.stars.push({
                x:     random(0, width),
                y:     random(cloudTop - 8000 * scaleY, cloudTop - 60 * scaleY),
                size:  random(2, 5.5) * SCALE,
                phase: random(TWO_PI),
                speed: random(0.03, 0.09)
            });
        }
    }

    draw() {
        // Skip entirely when the camera is well below the cloud layer
        if (game.cameraY > this.cloudTop + height) return;
        push();
        translate(0, -game.cameraY);
        noStroke();
        for (let s of this.stars) {
            if (s.y < game.cameraY - 100 || s.y > game.cameraY + height + 100) continue;
            // Twinkle: amplitude keeps stars visible but shimmering
            let twinkle = 0.65 + 0.35 * sin(frameCount * s.speed + s.phase);
            // Fade out near/inside the cloud layer; fully bright further above
            let fadeAlpha = constrain(map(s.y, this.cloudTop, this.cloudTop - 320 * scaleY, 0, 1), 0, 1);
            fill(255, 255, 220, 255 * twinkle * fadeAlpha);
            circle(s.x, s.y, s.size);
        }
        pop();
    }
}

// ========== BUBBLES ==========
class Bubble {
    constructor(x, y) {
        this.x = x !== undefined ? x : random(width);
        this.y = y !== undefined ? y : random(game.cameraY, game.cameraY + height);
        this.size = random(5, 20) * SCALE; this.speed = random(1, 3) * scaleY;
        this.wobble = random(TWO_PI); this.wobbleSpeed = random(0.02, 0.05);
    }
    update() {
        this.y -= this.speed; this.wobble += this.wobbleSpeed;
        this.x += sin(this.wobble) * 0.5 * scaleX;
        // Respawn bubbles at bottom of screen when they go off top
        if (this.y < game.cameraY - 50 * scaleY) {
            this.y = game.cameraY + height + random(0, 100) * scaleY;
            this.x = random(width);
        }
    }
    draw() {
        push(); translate(0, -game.cameraY); noStroke();
        fill(255, 255, 255, 100); circle(this.x, this.y, this.size);
        fill(255, 255, 255, 200); circle(this.x - this.size * 0.2, this.y - this.size * 0.2, this.size * 0.3);
        pop();
    }
}

// ========== DRAWING FUNCTIONS ==========
function drawBackground() {
    let depth = map(carl.y, game.seaLevel, game.surfaceGoal, 0, 1);
    depth = constrain(depth, 0, 1);

    // Sky darkens to deep night blue once Carl is above the cloud ceiling
    const CLOUD_LAYER_BOT = game.surfaceGoal - 2050 * scaleY;
    const CLOUD_LAYER_TOP = game.surfaceGoal - 2650 * scaleY;
    let aboveCloud = constrain(map(carl.y, CLOUD_LAYER_BOT, CLOUD_LAYER_TOP - 300 * scaleY, 0, 1), 0, 1);

    let c1 = lerpColor(lerpColor(color(4, 30, 66), color(100, 180, 220), depth), color(5, 10, 40), aboveCloud);
    let c2 = lerpColor(lerpColor(color(10, 77, 104), color(150, 200, 240), depth), color(8, 18, 60), aboveCloud);
    let c3 = lerpColor(lerpColor(color(26, 123, 160), color(180, 220, 255), depth), color(15, 35, 90), aboveCloud);

    for (let y = 0; y < height; y++) {
        let inter = map(y, 0, height, 0, 1);
        let c = inter < 0.5 ? lerpColor(c1, c2, inter * 2) : lerpColor(c2, c3, (inter - 0.5) * 2);
        stroke(c); line(0, y, width, y);
    }
}

// Draw big grey rock (called early for layering behind floor/grass)
function drawGreyRock() {
    push(); translate(0, -game.cameraY);
    let seabedY = game.seaLevel + 30 * scaleY;
    
    // Big grey rock sticking out of the ocean floor
    fill(120, 120, 130);
    noStroke();
    randomSeed(99999);
    let bigRockX = width / 2 + random(-200, 200) * scaleX;
    let bigRockY = seabedY + 5 * scaleY; // Slightly raised
    ellipse(bigRockX, bigRockY, 120 * SCALE, 90 * SCALE);
    // Shadow detail on big rock
    fill(90, 90, 100);
    ellipse(bigRockX + 20 * scaleX, bigRockY + 15 * scaleY, 40 * SCALE, 30 * SCALE);
    
    randomSeed(frameCount);
    pop();
}

// Draw grass layer (called before seabed for layering)
function drawSeabedGrass() {
    push(); translate(0, -game.cameraY);
    let seabedY = game.seaLevel + 30 * scaleY;
    
    // Grass/seaweed (increased density)
    randomSeed(67890);
    for (let i = 0; i < width; i += 50 * scaleX) {
        let x = i + random(-20, 20) * scaleX;
        stroke(50, 100, 50); strokeWeight(4 * SCALE); noFill(); beginShape();
        for (let j = 0; j < 5; j++) {
            let swayX = sin(frameCount * 0.02 + i) * 10 * scaleX;
            vertex(x + swayX, seabedY - j * 20 * scaleY);
        }
        endShape();
    }
    
    // Additional shorter grass
    randomSeed(11111);
    for (let i = 0; i < width; i += 35 * scaleX) {
        let x = i + random(-15, 15) * scaleX;
        stroke(60, 120, 60); strokeWeight(3 * SCALE); noFill(); beginShape();
        for (let j = 0; j < 3; j++) {
            let swayX = sin(frameCount * 0.03 + i * 0.5) * 8 * scaleX;
            vertex(x + swayX, seabedY - j * 15 * scaleY);
        }
        endShape();
    }
    
    randomSeed(frameCount);
    pop();
}

function drawSeabed() {
    push(); translate(0, -game.cameraY);
    let seabedY = game.seaLevel + 30 * scaleY;
    
    // Main seabed floor
    fill(194, 178, 128); noStroke(); rect(0, seabedY, width, 1000 * scaleY);
    
    // Rocks on surface
    fill(180, 160, 110);
    randomSeed(12345);
    for (let i = 0; i < width; i += 30 * scaleX) {
        let x = i + random(-10, 10) * scaleX;
        let y = seabedY + random(10, 40) * scaleY;
        ellipse(x, y, random(20, 40) * SCALE, random(15, 30) * SCALE);
    }
    
    // Additional larger rocks on surface
    fill(160, 140, 100);
    randomSeed(54321);
    for (let i = 0; i < width; i += 120 * scaleX) {
        let x = i + random(-20, 20) * scaleX;
        let y = seabedY + random(5, 25) * scaleY;
        ellipse(x, y, random(40, 70) * SCALE, random(30, 50) * SCALE);
    }
    
    // Depth-based rocks - erratic and random placement, sparser with depth
    randomSeed(77777);
    let depthLayers = 12; // Increased from 8 to 12 for better gradient
    let allRocks = []; // Track rock positions to prevent overlap
    
    for (let layer = 0; layer < depthLayers; layer++) {
        let baseDepth = (layer + 1) * 80 * scaleY; // Reduced spacing for more rocks
        let spacing = 45 * scaleX * (1 + layer * 0.4); // Tighter initial spacing
        let rockCount = floor(width / spacing);
        
        fill(170 - layer * 7, 150 - layer * 7, 100 - layer * 5);
        
        for (let i = 0; i < rockCount; i++) {
            let attempts = 0;
            let placed = false;
            
            while (!placed && attempts < 10) {
                // Much more erratic placement
                let x = i * spacing + random(-spacing * 0.4, spacing * 0.4) * scaleX;
                let y = seabedY + baseDepth + random(-50, 70) * scaleY;
                let rockSize = random(10, 40) * SCALE * (1 - layer * 0.06);
                let rockHeight = rockSize * random(0.6, 1.2);
                
                // Check for collisions with existing rocks
                let overlaps = false;
                for (let rock of allRocks) {
                    let dx = x - rock.x;
                    let dy = y - rock.y;
                    let minDist = (rockSize + rock.w) / 2 + 10 * SCALE; // Add padding
                    if (dx * dx + dy * dy < minDist * minDist) {
                        overlaps = true;
                        break;
                    }
                }
                
                if (!overlaps) {
                    ellipse(x, y, rockSize, rockHeight);
                    allRocks.push({x: x, y: y, w: rockSize, h: rockHeight});
                    placed = true;
                }
                attempts++;
            }
        }
    }
    
    randomSeed(frameCount);
    pop();
}

function drawSurfaceIndicator() {
    let distToSurface = carl.y - game.surfaceGoal;
    if (distToSurface < 500 * scaleY && distToSurface > 0 && !game.bossMode) {
        push(); fill(255, 50, 50); textAlign(CENTER); textSize(24 * SCALE);
        text('Warning: Deathly Laser ☀️', width / 2, 50 * scaleY); pop();
    }
}

function drawWaterSurface() {
    let surfaceY = game.surfaceGoal - game.cameraY;
    if (surfaceY > -200 && surfaceY < height + 200) {
        push();
        let waveOffset = frameCount * 0.05;
        for (let i = 0; i < 3; i++) {
            let alpha = map(i, 0, 2, 150, 50);
            let offset = i * 3;
            stroke(100, 180, 220, alpha);
            strokeWeight(4 - i);
            noFill();
            beginShape();
            for (let x = -50; x < width + 50; x += 20) {
                let wave = sin(x * 0.02 + waveOffset + i * 0.5) * 8;
                vertex(x, surfaceY + wave + offset);
            }
            endShape();
        }
        for (let i = 0; i < 20; i++) {
            let x = (frameCount * 2 + i * 50) % (width + 100) - 50;
            let size = random(3, 8);
            fill(255, 255, 255, 150);
            ellipse(x, surfaceY - 20 + random(-10, 10), size, size);
        }
        pop();
    }
}

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
        } else {
            this.vx = random(-3, 3) * scaleX;
            this.vy = random(-3, 3) * scaleY;
        }
        
        if (type === 'hit') this.color = color(255, 100, 150);
        else if (type === 'boost') this.color = color(255, 255, 0);
        else if (type === 'powerup') this.color = color(255, 220, 0);
        else if (type === 'shield') this.color = color(100, 200, 255);
        else this.color = color(150, 200, 255);
    }
    update() {
        this.x += this.vx; this.y += this.vy; this.vy += 0.2; this.life -= 5;
        if (this.life <= 0) this.toRemove = true;
    }
    draw() {
        push(); translate(0, -game.cameraY);
        this.color.setAlpha(this.life); fill(this.color); noStroke(); circle(this.x, this.y, this.size);
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
        this.y = y !== undefined ? y : random(game.surfaceGoal - height, game.surfaceGoal - 100 * scaleY);
        this.size = random(60, 120) * SCALE;
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
            this.y = random(game.surfaceGoal - height, game.surfaceGoal - 100 * scaleY);
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
    let c1 = lerpColor(color(4, 30, 66), color(100, 180, 220), depth);
    let c2 = lerpColor(color(10, 77, 104), color(150, 200, 240), depth);
    let c3 = lerpColor(color(26, 123, 160), color(180, 220, 255), depth);
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

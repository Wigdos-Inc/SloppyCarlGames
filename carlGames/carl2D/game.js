/* ============================================
   GAME LOOP AND STATE MANAGEMENT
   ============================================ */

"use strict";

// ========== DEBUG MODE ==========
let DEBUG = false;
window.debug = function() {
    DEBUG = !DEBUG;
    console.log(`DEBUG mode ${DEBUG ? 'ENABLED' : 'DISABLED'}`);
    console.log('Features: Boss skip (Y key), console logs');
};

// ========== GAME LOOP ==========
function setup() {
    let canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('canvas-container');
    calculateScale(); // Calculate scaling based on window size
    loadSounds();
    initGame();
}

function draw() {
    // Only update time if actually playing (not waiting or paused)
    if (game.state === 'playing') {
        game.currentTime = (Date.now() - game.startTime) / 1000;
    }

    // Run/advance win cutscene timer even after state changes
    if (game.winSequenceActive) {
        game.winSequenceTimer++;
    }
    
    // Screen shake during boss defeat (first 3 seconds)
    let shakeX = 0;
    let shakeY = 0;
    if (game.bossMode) {
        let boss = enemies.find(e => e.type === 'sunboss');
        if (boss && boss.defeated && boss.defeatTimer <= 180) {
            let intensity = 5 * SCALE;
            shakeX = random(-intensity, intensity);
            shakeY = random(-intensity, intensity);
        }
    }
    
    push();
    translate(shakeX, shakeY);
    
    drawBackground();
    for (let layer of background.layers) { layer.update(); layer.draw(); }
    drawGreyRock();
    drawSeabedGrass();
    drawSeabed();
    for (let bubble of background.bubbles) { bubble.update(); bubble.draw(); }
    // Update and draw clouds above water
    for (let cloud of background.clouds) { cloud.update(); cloud.draw(); }

    // If we are in the end cutscene, drive camera/visuals and skip normal simulation.
    if (game.winSequenceActive) {
        updateWinSequence();

        // Update particles for supernova animation
        for (let i = particles.length - 1; i >= 0; i--) {
            if (!particles[i]) continue;
            particles[i].update();
            if (!particles[i]) continue;
            if (particles[i].toRemove) particles.splice(i, 1);
        }

        // Draw world objects (platforms can be hidden via fade overlay)
        for (let platform of platforms) platform.draw();
        for (let powerup of powerups) powerup.draw();
        for (let enemy of enemies) enemy.draw();
        for (let particle of particles) particle.draw();
        carl.draw();
        drawWaterSurface();
        drawSurfaceIndicator();
        updateHUD();

        drawWinSequenceOverlay();
        return;
    }
    
    if (game.state === 'playing') {
        // Handle music fading when approaching surface
        if (!game.bossMode && !game.musicFading) {
            let distToSurface = carl.y - game.surfaceGoal;
            if (distToSurface < 1000 * scaleY && distToSurface > 0) {
                game.musicFading = true;
            }
        }
        
        // Fade out main music as Carl approaches surface
        if (game.musicFading && !game.bossMode) {
            let distToSurface = carl.y - game.surfaceGoal;
            if (distToSurface > 0) {
                game.musicFadeAmount = map(distToSurface, 0, 1000 * scaleY, 0, 1);
                game.musicFadeAmount = constrain(game.musicFadeAmount, 0, 1);
                if (window.gameMusic && window.gameMusicLoaded) {
                    window.gameMusic.setVolume(0.5 * game.musicFadeAmount);
                }
            }
        }
        
        // Boss intro sequence
        if (game.bossMode && !game.bossIntroActive && !game.bossSpawned) {
            game.bossIntroActive = true;
            game.bossIntroTimer = 0;
            // Stop main music completely
            if (window.gameMusic && window.gameMusicLoaded) {
                window.gameMusic.stop();
            }
            // Lock Carl at the WATER SURFACE (not seabed) during intro
            carl.y = game.surfaceGoal;
            carl.vx = 0;
            carl.vy = 0;
            // Don't set camera here - let it smoothly lerp during the intro
        }
        
        // Boss mode initialization
        if (game.bossMode && !game.bossSpawned) {
            // During intro, animate the sun coming down
            if (game.bossIntroActive) {
                game.bossIntroTimer++;
                
                // Clear all enemies below the surface (only once at start)
                if (game.bossIntroTimer === 1) {
                    for (let i = enemies.length - 1; i >= 0; i--) {
                        if (enemies[i].y > game.surfaceGoal) {
                            enemies.splice(i, 1);
                        }
                    }
                    
                    // Clear all platforms below the surface
                    for (let i = platforms.length - 1; i >= 0; i--) {
                        if (platforms[i].y > game.surfaceGoal) {
                            platforms.splice(i, 1);
                        }
                    }
                    
                    // Create manual boss platforms above water
                    createBossPlatforms();
                    
                    // Create the sun boss off-screen above
                    let bossX = width / 2;
                    let bossY = game.surfaceGoal - height; // Start way above
                    game.boss = new SunBoss(bossX, bossY);
                    game.boss.introMode = true; // Special flag for intro
                    game.boss.targetY = game.surfaceGoal - 400 * scaleY; // Target position
                    enemies.push(game.boss);
                    
                    // Reset last platform Y for boss platforms
                    lastPlatformY = game.surfaceGoal;
                }
                
                // Animate sun descending
                if (game.boss && game.boss.introMode) {
                    let descendSpeed = 3 * scaleY;
                    game.boss.y += descendSpeed;
                    game.boss.baseY = game.boss.y;
                    
                    // Check if sun reached target position
                    if (game.boss.y >= game.boss.targetY) {
                        game.boss.y = game.boss.targetY;
                        game.boss.baseY = game.boss.targetY;
                        game.boss.targetBaseY = game.boss.targetY; // Set target to prevent shooting back up
                        game.boss.introMode = false;
                        game.bossSpawned = true;
                        game.bossIntroActive = false;
                        
                        // Start boss music
                        if (window.bossMusic && window.bossMusicLoaded) {
                            window.bossMusic.setVolume(0.5);
                            window.bossMusic.loop();
                        }
                        
                        // Give player a moment before attacks start
                        game.boss.attackCooldown = 60; // 1 second delay
                    }
                }
                
                // Keep Carl locked at the water surface during intro
                carl.y = game.surfaceGoal;
                carl.vx = 0;
                carl.vy = 0;
            }
        }
        
        // Update camera to follow Carl smoothly, even during boss intro
        if (game.bossMode) {
            // Check if boss is defeated - focus camera on sun instead of Carl
            let boss = enemies.find(e => e.type === 'sunboss');
            if (boss && boss.defeated) {
                // Camera locks on sun during defeat sequence - no lerp to prevent following Carl
                let targetY = boss.y - height / 2;
                game.cameraY = targetY;
            } else {
                // During boss fight, offset camera to show both Carl and sun
                let cameraOffset = 300 * scaleY; // Offset camera above Carl
                game.cameraY = lerp(game.cameraY, carl.y - height / 2 - cameraOffset, 0.1);
            }
        } else {
            game.cameraY = lerp(game.cameraY, carl.y - height / 2, 0.1);
        }
        
        // Prevent Carl from going too far below the surface in boss mode
        if (game.bossMode) {
            let maxDepth = game.surfaceGoal + 500 * scaleY; // Increased from 300 to 500
            if (carl.y > maxDepth) {
                carl.y = maxDepth;
                carl.vy = min(carl.vy, 0); // Can't go down further
            }
            
            // Water healing system - heal 1 life every 5 seconds when underwater (reduced from 10)
            if (carl.y > game.surfaceGoal) {
                // Carl is underwater
                waterHealTimer++;
                // 5 seconds at 60fps = 300 frames (reduced from 600)
                if (waterHealTimer >= 300 && game.lives < GAME_CONFIG.STARTING_LIVES) {
                    game.lives++;
                    waterHealTimer = 0;
                    sounds.play('powerup');
                    // Green heal glow effect on Carl
                    carl.healEffectTimer = 80; // ~1.3 seconds
                    game.livesHueTimer = 80;
                    game.livesHueType = 'heal';
                }
            } else {
                // Reset timer when above water (re-entering water will start timer from 0)
                waterHealTimer = 0;
            }
            
            // Add buoyancy force when Carl goes deeper than a threshold below the surface
            let buoyancyThreshold = game.surfaceGoal + 350 * scaleY; // Increased from 150 to 350 - allow deeper diving
            if (carl.y > buoyancyThreshold) {
                // Calculate how far below the threshold Carl is
                let depthBelowThreshold = carl.y - buoyancyThreshold;
                // Apply upward buoyancy force that gets stronger the deeper Carl goes past the threshold
                let buoyancyForce = depthBelowThreshold * 0.03;
                carl.vy -= buoyancyForce;
                
                // Add visual feedback - bubbles rising from Carl when in buoyancy zone
                if (frameCount % 5 === 0) {
                    particles.push(new Particle(carl.x + random(-20, 20) * SCALE, carl.y, 'boost'));
                }
            }
            
            // Apply proper gravity and physics above water
            if (carl.y < game.surfaceGoal) {
                // Carl is above water - apply weak gravity that doesn't over-scale
                let airGravity = 0.25 * scaleY;
                carl.vy += airGravity;
                
                // Velocity cap that scales with screen
                let maxUpwardVelocity = -30 * scaleY;
                if (carl.vy < maxUpwardVelocity) {
                    carl.vy = maxUpwardVelocity;
                }
            }
        }
        
        carl.update();
        
        // Generate platforms differently in boss mode
        if (game.bossMode) {
            generateBossPlatforms();
        } else {
            generatePlatforms();
        }
        
        // Spawn side enemies in boss mode when Carl is underwater
        // But stop spawning if boss is defeated
        let boss = game.bossMode ? enemies.find(e => e.type === 'sunboss') : null;
        let bossDefeated = boss && boss.defeated;
        
        if (game.bossMode && !bossDefeated) {
            spawnSideEnemies(); // Allow sharks and bombs when underwater
        } else if (!game.bossMode) {
            // Regular mode - spawn all enemy types
            spawnFloatingEnemies();
            spawnSideEnemies();
            spawnSideEnemies();
        }
        
        for (let i = platforms.length - 1; i >= 0; i--) {
            platforms[i].update();
            if (platforms[i].toRemove) platforms.splice(i, 1);
        }
        
        for (let i = powerups.length - 1; i >= 0; i--) {
            if (!powerups[i]) continue; // Safety check
            powerups[i].update();
            if (powerups[i] && powerups[i].toRemove) powerups.splice(i, 1);
        }
        
        for (let i = enemies.length - 1; i >= 0; i--) {
            if (!enemies[i]) continue; // Safety check before update
            enemies[i].update();
            // Safety check - enemy might have been removed during update
            if (!enemies[i]) continue;
            
            // Check if boss is defeated - if so, don't damage Carl
            let boss = game.bossMode ? enemies.find(e => e.type === 'sunboss') : null;
            let bossDefeated = boss && boss.defeated;
            
            if (!bossDefeated && enemies[i].checkCollision(carl)) {
                carl.hit();
                // Don't remove the boss when hit - it has its own health system
                if (enemies[i].type !== 'sunboss') {
                    enemies.splice(i, 1);
                }
                continue;
            }
            if (enemies[i].toRemove) enemies.splice(i, 1);
        }
        
        for (let i = particles.length - 1; i >= 0; i--) {
            if (!particles[i]) continue; // Safety check before update
            particles[i].update();
            // Safety check - particle might have been removed during update
            if (!particles[i]) continue;
            if (particles[i].toRemove) particles.splice(i, 1);
        }
    }
    
    for (let platform of platforms) platform.draw();
    for (let powerup of powerups) powerup.draw();
    for (let enemy of enemies) enemy.draw();
    for (let particle of particles) particle.draw();
    carl.draw();
    drawWaterSurface();
    drawSurfaceIndicator();
    
    pop(); // End screen shake transform
    
    // Screen glow/darken effect during boss defeat
    if (game.bossMode) {
        let boss = enemies.find(e => e.type === 'sunboss');
        if (boss && boss.defeated) {
            push();
            noStroke();
            if (boss.defeatTimer <= 180) {
                // Growing phase - screen glows brighter
                let glowAlpha = map(boss.defeatTimer, 0, 180, 0, 120);
                fill(255, 255, 200, glowAlpha);
                rect(0, 0, width, height);
            } else if (boss.defeatTimer <= 190) {
                // Shrinking phase - screen darkens
                let darkenAlpha = map(boss.defeatTimer, 181, 190, 0, 80);
                fill(0, 0, 0, darkenAlpha);
                rect(0, 0, width, height);
            }
            pop();
        }
    }
    
    updateHUD();
}

// ========== BOSS WIN CUTSCENE ==========
function startWinSequence(boss) {
    if (game.winSequenceActive) return;

    game.winSequenceActive = true;
    game.winSequenceTimer = 0;
    game.winSequencePhase = 2; // Start directly at supernova expansion phase

    // Stop boss music immediately, but don't show popup yet
    if (window.bossMusic && window.bossMusicLoaded) {
        try { window.bossMusic.stop(); } catch (e) {}
    }

    // Freeze gameplay time
    game.state = 'cutscene';

    // Clear hostile projectiles quickly so visuals don't clutter
    enemies = enemies.filter(e => e && (e.type === 'sunboss'));

    // Snapshot boss visuals for the cutscene
    const sun = boss || game.boss;
    game.winSequenceData.startCameraY = game.cameraY;
    game.winSequenceData.sunX = sun ? sun.x : width / 2;
    game.winSequenceData.sunY = sun ? sun.y : (game.surfaceGoal - 400 * scaleY);
    game.winSequenceData.sunSize = sun ? sun.size : (150 * SCALE);
    game.winSequenceData.supernovaProgress = 0;
    game.winSequenceData.fadeAlpha = 0;

    // Start Carl falling back into the water
    carl.vx = 0;
    carl.vy = 0;
}

function updateWinSequence() {
    // Phases:
    // 0) Carl falls back into water (short)
    // 1) Camera focuses on sun
    // 2) Supernova expands + everything fades
    // 3) Finish: show win popup (calls existing winGame)

    const data = game.winSequenceData;
    const sunTargetY = data.sunY - height * 0.35; // place sun a bit above center

    if (game.winSequencePhase === 0) {
        // Make Carl drop into the water quickly
        const waterY = game.surfaceGoal + 220 * scaleY;
        const fallSpeed = 10 * scaleY;

        // Keep Carl roughly centered while falling
        carl.x = lerp(carl.x, width / 2, 0.08);
        carl.y += fallSpeed;

        // Clamp so he "splashes" just below the surface
        if (carl.y >= waterY) {
            carl.y = waterY;
            // Some splash particles
            for (let i = 0; i < 25; i++) {
                particles.push(new Particle(carl.x + random(-30, 30) * SCALE, carl.y + random(-10, 10) * scaleY, 'boost'));
            }
            game.winSequencePhase = 1;
            game.winSequenceTimer = 0;
        }

        // Camera still loosely follows Carl during the fall
        game.cameraY = lerp(game.cameraY, carl.y - height / 2, 0.12);
        return;
    }

    if (game.winSequencePhase === 1) {
        // Smooth camera transition to focus on the sun
        const targetCameraY = sunTargetY;
        game.cameraY = lerp(game.cameraY, targetCameraY, 0.06);

        // Keep Carl inert in the water
        carl.vx = 0;
        carl.vy = 0;

        // After ~2 seconds, start supernova
        if (game.winSequenceTimer > 120) {
            game.winSequencePhase = 2;
            game.winSequenceTimer = 0;
        }
        return;
    }

    if (game.winSequencePhase === 2) {
        // Hold camera on sun
        const targetCameraY = sunTargetY;
        game.cameraY = lerp(game.cameraY, targetCameraY, 0.08);

        // Expand supernova over ~3 seconds
        const duration = 180;
        const t = constrain(game.winSequenceTimer / duration, 0, 1);
        data.supernovaProgress = t;

        // Fade world out as supernova grows
        data.fadeAlpha = constrain(map(t, 0.15, 0.9, 0, 255), 0, 255);

        // Update particles gently for ambiance
        for (let i = particles.length - 1; i >= 0; i--) {
            particles[i].update();
            if (particles[i].toRemove) particles.splice(i, 1);
        }

        if (t >= 1) {
            game.winSequencePhase = 3;
            game.winSequenceTimer = 0;
        }
        return;
    }

    if (game.winSequencePhase === 3) {
        // Hold white screen for 2 seconds (120 frames)
        if (game.winSequenceTimer >= 120) {
            game.winSequencePhase = 4;
            game.winSequenceTimer = 0;
        }
        return;
    }
    
    if (game.winSequencePhase === 4) {
        // Flash to black briefly (10 frames)
        if (game.winSequenceTimer >= 10) {
            game.winSequencePhase = 5;
            game.winSequenceTimer = 0;
            // Initialize new credits system
            CreditsSystem.init();
        }
        return;
    }
    
    if (game.winSequencePhase === 5) {
        // Credits handled by CreditsSystem
        CreditsSystem.update();
        return;
    }
}

function drawWinSequenceOverlay() {
    const data = game.winSequenceData;

    // Draw supernova centered on the sun position in screen space
    const sunScreenX = data.sunX;
    const sunScreenY = data.sunY - game.cameraY;

    // Supernova glow (only during phase 2)
    if (game.winSequencePhase === 2) {
        push();
        blendMode(ADD);

        const t = data.supernovaProgress;
        const base = data.sunSize;
        const r1 = base * (1.2 + t * 10.0);
        const r2 = base * (0.8 + t * 6.0);

        noStroke();
        fill(255, 240, 200, 80);
        circle(sunScreenX, sunScreenY, r1);
        fill(255, 180, 80, 90);
        circle(sunScreenX, sunScreenY, r2);
        fill(255, 255, 255, 120);
        circle(sunScreenX, sunScreenY, base * (0.6 + t * 2.5));

        // Shockwave ring
        noFill();
        stroke(255, 255, 255, 140);
        strokeWeight(6 * SCALE);
        circle(sunScreenX, sunScreenY, base * (1.0 + t * 12.0));

        blendMode(BLEND);
        pop();
    }

    // Fade-to-white overlay so "everything disappears"
    if (data.fadeAlpha > 0 && game.winSequencePhase === 2) {
        push();
        noStroke();
        fill(255, 255, 255, data.fadeAlpha);
        rect(0, 0, width, height);
        pop();
    }
    
    // Phase 3: White screen hold
    if (game.winSequencePhase === 3) {
        push();
        noStroke();
        fill(255);
        rect(0, 0, width, height);
        pop();
    }
    
    // Phase 4 & 5: Black background with credits
    if (game.winSequencePhase === 4 || game.winSequencePhase === 5) {
        push();
        noStroke();
        fill(0);
        rect(0, 0, width, height);
        pop();
    }
    
    // Phase 5: Credits content (handled by CreditsSystem)
    if (game.winSequencePhase === 5) {
        CreditsSystem.draw();
    }
}

// ========== GAME STATE FUNCTIONS ==========
function initGame() {
    game.state = 'waiting'; game.altitude = 0; game.highestAltitude = 0;
    // Position sea floor near bottom (90% down) so most of screen shows playable area
    game.lives = GAME_CONFIG.STARTING_LIVES; game.cameraY = 0; game.seaLevel = height * 0.9;
    game.surfaceGoal = game.seaLevel + GAME_CONFIG.SURFACE_GOAL; game.frameCount = 0;
    game.flyingUp = false; game.flyTimer = 0;
    game.startTime = Date.now();
    game.currentTime = 0;
    
    // Reset all boss-related state
    game.bossMode = false;
    game.bossSpawned = false;
    game.boss = null;
    game.bossIntroActive = false;
    game.bossIntroTimer = 0;
    game.musicFading = false;
    game.musicFadeAmount = 1.0;
    
    // Reset hard mode tracking
    game.sideCampingTimer = 0;
    game.hardModeActive = false;
    
    // Reset lives hue effect
    game.livesHueTimer = 0;
    game.livesHueType = 'none';
    
    let saved = localStorage.getItem('carlBestTime');
    if (saved) game.bestTime = parseFloat(saved);
    
    carl = new Carl(width / 2, game.seaLevel);
    enemies = []; platforms = []; powerups = []; particles = []; lastPlatformY = game.seaLevel;
    for (let i = 0; i < 10; i++) generatePlatforms();
    background.layers = [
        new BackgroundLayer(0.2, color(60, 40, 80), color(40, 60, 80)),
        new BackgroundLayer(0.5, color(100, 50, 120), color(60, 80, 100)),
        new BackgroundLayer(0.8, color(150, 70, 160), color(80, 100, 120))
    ];
    background.bubbles = [];
    // Spawn bubbles across the full screen height around the starting position
    for (let i = 0; i < 50; i++) background.bubbles.push(new Bubble(random(width), random(game.cameraY, game.cameraY + height)));
    background.clouds = [];
    // Spawn clouds above the water surface
    for (let i = 0; i < 15; i++) background.clouds.push(new Cloud());
    document.getElementById('pause-menu').classList.add('hidden');
    document.getElementById('gameover-menu').classList.add('hidden');
    // Don't start background music here - will be started when game actually begins
}

// Function called from menu to start gameplay
window.startGamePlay = function() {
    game.state = 'playing';
    game.startTime = Date.now();
    loop();
};

function updateHUD() {
    // Hide HUD during credits
    const hudElement = document.getElementById('hud');
    if (game.winSequenceActive && game.winSequencePhase >= 4) {
        if (hudElement) hudElement.style.display = 'none';
        return;
    } else {
        if (hudElement) hudElement.style.display = 'flex';
    }
    
    // Hide pause button during cutscenes (boss intro and defeat)
    const pauseButton = document.getElementById('pause-button');
    if (pauseButton) {
        let bossDefeated = false;
        if (game.bossMode) {
            let boss = enemies.find(e => e.type === 'sunboss');
            if (boss && boss.defeated) {
                bossDefeated = true;
            }
        }
        if (game.bossIntroActive || game.winSequenceActive || bossDefeated) {
            pauseButton.style.visibility = 'hidden';
        } else {
            pauseButton.style.visibility = 'visible';
        }
    }
    
    // Format time as MM:SS.mmm
    let minutes = Math.floor(game.currentTime / 60);
    let seconds = Math.floor(game.currentTime % 60);
    let milliseconds = Math.floor((game.currentTime % 1) * 1000);
    let timeString = `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    
    document.getElementById('distance').textContent = timeString;
    document.getElementById('speed').textContent = carl.speedBoost.toFixed(1) + 'x';
    
    // Update lives with color animation
    const livesElement = document.getElementById('lives');
    livesElement.textContent = game.lives;
    
    // Apply color hue effect
    if (game.livesHueTimer > 0) {
        let hueAlpha;
        // Same timing as Carl's heal effect: fade in 20 frames, stay 30 frames, fade out 30 frames
        if (game.livesHueTimer > 60) {
            hueAlpha = map(game.livesHueTimer, 80, 60, 0, 1);
        } else if (game.livesHueTimer > 30) {
            hueAlpha = 1;
        } else {
            hueAlpha = map(game.livesHueTimer, 30, 0, 1, 0);
        }
        
        if (game.livesHueType === 'heal') {
            livesElement.style.color = `rgba(50, 255, 100, ${hueAlpha})`;
            livesElement.style.textShadow = `0 0 10px rgba(50, 255, 100, ${hueAlpha * 0.8}), 2px 2px 4px rgba(0, 0, 0, 0.8)`;
        } else if (game.livesHueType === 'damage') {
            livesElement.style.color = `rgba(255, 50, 50, ${hueAlpha})`;
            livesElement.style.textShadow = `0 0 10px rgba(255, 50, 50, ${hueAlpha * 0.8}), 2px 2px 4px rgba(0, 0, 0, 0.8)`;
        }
        
        game.livesHueTimer--;
        if (game.livesHueTimer <= 0) {
            game.livesHueType = 'none';
            livesElement.style.color = '';
            livesElement.style.textShadow = '';
        }
    }
    
    // Display best time
    if (game.bestTime !== null) {
        let bestMinutes = Math.floor(game.bestTime / 60);
        let bestSeconds = Math.floor(game.bestTime % 60);
        let bestMilliseconds = Math.floor((game.bestTime % 1) * 1000);
        let bestTimeString = `${bestMinutes}:${bestSeconds.toString().padStart(2, '0')}.${bestMilliseconds.toString().padStart(3, '0')}`;
        document.getElementById('highscore').textContent = bestTimeString;
    } else {
        document.getElementById('highscore').textContent = '--:--:---';
    }
}

function pauseGame() {
    if (game.state === 'playing') {
        game.state = 'paused';
        game.pauseStartTime = Date.now();
        document.getElementById('pause-menu').classList.remove('hidden');
        // Pause whichever music is currently playing
        if (game.bossMode && window.bossMusic && window.bossMusicLoaded) {
            window.bossMusic.pause();
        } else if (window.gameMusic && window.gameMusicLoaded) {
            window.gameMusic.pause();
        }
        noLoop();
    }
}

function resumeGame() {
    if (game.state === 'paused') {
        // Calculate how long we were paused and adjust startTime to exclude that duration
        let pauseDuration = Date.now() - game.pauseStartTime;
        game.startTime += pauseDuration;
        
        game.state = 'playing';
        document.getElementById('pause-menu').classList.add('hidden');
        // Resume whichever music should be playing
        if (game.bossMode && window.bossMusic && window.bossMusicLoaded) {
            window.bossMusic.play();
        } else if (window.gameMusic && window.gameMusicLoaded) {
            window.gameMusic.play();
        }
        loop();
    }
}

function gameOver() {
    game.state = 'gameover';
    // Stop whichever music is playing
    if (game.bossMode && window.bossMusic && window.bossMusicLoaded) {
        window.bossMusic.stop();
    } else if (window.gameMusic && window.gameMusicLoaded) {
        window.gameMusic.stop();
    }
    sounds.play('death');
    
    let minutes = Math.floor(game.currentTime / 60);
    let seconds = Math.floor(game.currentTime % 60);
    let milliseconds = Math.floor((game.currentTime % 1) * 1000);
    let timeString = `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    
    document.querySelector('#gameover-menu h2').textContent = 'GAME OVER';
    document.getElementById('final-distance').textContent = `Time: ${timeString}`;
    document.getElementById('gameover-message').textContent = 'Carl got caught!';
    let tryAgainBtn = document.getElementById('try-again-btn');
    tryAgainBtn.style.background = 'linear-gradient(135deg, #ff6b9d 0%, #c9184a 100%)';
    document.getElementById('gameover-menu').classList.remove('hidden');
    noLoop();
}

function winGame() {
    game.state = 'won';
    // Stop boss music when winning
    if (window.bossMusic && window.bossMusicLoaded) {
        window.bossMusic.stop();
    }
    sounds.play('win');
    
    // Check if this is a new best time
    if (game.bestTime === null || game.currentTime < game.bestTime) {
        game.bestTime = game.currentTime;
        localStorage.setItem('carlBestTime', game.bestTime.toString());
    }
    
    let minutes = Math.floor(game.currentTime / 60);
    let seconds = Math.floor(game.currentTime % 60);
    let milliseconds = Math.floor((game.currentTime % 1) * 1000);
    let timeString = `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    
    let isNewRecord = (game.bestTime === game.currentTime);
    
    document.querySelector('#gameover-menu h2').textContent = 'YOU WON!';
    document.getElementById('final-distance').textContent = `Time: ${timeString}${isNewRecord ? ' 🏆 NEW RECORD!' : ''}`;
    document.getElementById('gameover-message').textContent = `Carl escaped! (and suffocated...)`;
    let tryAgainBtn = document.getElementById('try-again-btn');
    tryAgainBtn.style.background = 'linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)';
    document.getElementById('gameover-menu').classList.remove('hidden');
    noLoop();
}

function restartGame() {
    document.getElementById('gameover-menu').classList.add('hidden');
    // Stop any music that might be playing
    if (window.bossMusic && window.bossMusicLoaded) {
        window.bossMusic.stop();
    }
    if (window.gameMusic && window.gameMusicLoaded) {
        window.gameMusic.stop();
    }
    initGame();
    game.state = 'playing';
    game.startTime = Date.now();
    // Start regular music from the beginning
    if (window.gameMusic && window.gameMusicLoaded) {
        window.gameMusic.setVolume(0.5);
        window.gameMusic.loop();
    }
    loop();
}

function returnToTitle() {
    // Show the main menu overlay again
    const menuOverlay = document.getElementById('main-menu-overlay');
    if (menuOverlay) {
        menuOverlay.classList.remove('hidden');
        
        // Stop all music when returning to main menu
        if (window.gameMusic && window.gameMusicLoaded) {
            window.gameMusic.stop();
        }
        if (window.bossMusic && window.bossMusicLoaded) {
            window.bossMusic.stop();
        }
        if (window.credits1Music && window.credits1Loaded) {
            window.credits1Music.stop();
        }
        if (window.credits2Music && window.credits2Loaded) {
            window.credits2Music.stop();
        }
        
        // Reset game state
        game.state = 'waiting';
        initGame();
        noLoop();
    }
}

// ========== INPUT HANDLERS ==========
function keyPressed() {
    keys[key] = true;
    
    // Credits controls - delegate to CreditsSystem
    if (game.winSequenceActive && game.winSequencePhase === 5) {
        if (CreditsSystem.handleKeyPress(key)) {
            return false;
        }
    }
    
    // Boss skip cheat code - press 'y' to skip to boss fight (DEBUG only)
    if (DEBUG && (key === 'y' || key === 'Y') && game.state === 'playing' && !game.bossMode) {
        // Teleport Carl to just above the surface (remember: surfaceGoal is negative, lower Y = higher up)
        carl.y = game.surfaceGoal - 100 * scaleY;
        carl.vy = 0;
        carl.vx = 0;
        // Move camera to Carl's position immediately
        game.cameraY = carl.y - height / 2;
        // Trigger boss mode immediately
        game.bossMode = true;
        if (DEBUG) console.log('Skipping to boss fight! Carl Y:', carl.y, 'Surface Y:', game.surfaceGoal, 'Camera Y:', game.cameraY);
        return false;
    }
    
    if (key === CONTROLS.PAUSE || key === 'Escape' || key === 'p' || key === 'P') {
        // Prevent pausing during any cutscene (boss intro, boss defeat, or win sequence)
        if (game.bossIntroActive || game.winSequenceActive) {
            return false;
        }
        // Also prevent pausing if boss is defeated (flashing/growing phase)
        if (game.bossMode) {
            let boss = enemies.find(e => e.type === 'sunboss');
            if (boss && boss.defeated) {
                return false;
            }
        }
        // Only allow pausing if actually playing (not waiting)
        if (game.state === 'playing') pauseGame();
        else if (game.state === 'paused') resumeGame();
    }
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return false;
}

function keyReleased() {
    keys[key] = false;
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    calculateScale(); // Recalculate scaling on window resize
}

// ========== SOUND LOADING ==========
function loadSounds() {
    soundFormats('mp3', 'ogg', 'wav');
    
    // Load intro sounds
    window.introSplatSound = loadSound('../../engine/v1/assets/carlStudios/splat.mp3',
        () => {
            if (DEBUG) console.log('Intro splat sound loaded successfully');
            window.introSplatLoaded = true;
        },
        (err) => {
            if (DEBUG) console.log('Failed to load intro splat sound:', err);
            window.introSplatLoaded = false;
        }
    );
    
    window.introSloppySound = loadSound('../../engine/v1/assets/carlStudios/sloppyCarl.mp3',
        () => {
            if (DEBUG) console.log('Intro sloppy Carl sound loaded successfully');
            window.introSloppyLoaded = true;
        },
        (err) => {
            if (DEBUG) console.log('Failed to load intro sloppy Carl sound:', err);
            window.introSloppyLoaded = false;
        }
    );
    
    // Load game music (carlMainTheme.mp3) - don't auto-play
    window.gameMusic = loadSound('sounds/carlMainTheme.mp3', 
        () => { 
            if (DEBUG) console.log('Game music (carlMainTheme) loaded successfully');
            window.gameMusicLoaded = true;
        },
        (err) => { 
            if (DEBUG) console.log('Failed to load game music:', err);
            window.gameMusicLoaded = false;
        }
    );
    
    // Load boss battle music
    window.bossMusic = loadSound('sounds/carlSunBattle.mp3',
        () => {
            if (DEBUG) console.log('Boss battle music loaded successfully');
            window.bossMusicLoaded = true;
        },
        (err) => {
            if (DEBUG) console.log('Failed to load boss music:', err);
            window.bossMusicLoaded = false;
        }
    );
    
    // Load boss defeat sounds
    window.rumbleSound = loadSound('sounds/rumble.mp3',
        () => {
            if (DEBUG) console.log('Rumble sound loaded successfully');
            window.rumbleSoundLoaded = true;
        },
        (err) => {
            if (DEBUG) console.log('Failed to load rumble sound:', err);
            window.rumbleSoundLoaded = false;
        }
    );
    
    window.explodeSound = loadSound('sounds/explode.mp3',
        () => {
            if (DEBUG) console.log('Explode sound loaded successfully');
            window.explodeSoundLoaded = true;
        },
        (err) => {
            if (DEBUG) console.log('Failed to load explode sound:', err);
            window.explodeSoundLoaded = false;
        }
    );
    
    // Load credits music
    window.credits1Music = loadSound('sounds/credits1.mp3',
        () => {
            if (DEBUG) console.log('Credits music 1 loaded successfully');
            window.credits1Loaded = true;
        },
        (err) => {
            if (DEBUG) console.log('Failed to load credits1 music:', err);
            window.credits1Loaded = false;
        }
    );
    
    window.credits2Music = loadSound('sounds/credits2.mp3',
        () => {
            if (DEBUG) console.log('Credits music 2 loaded successfully');
            window.credits2Loaded = true;
        },
        (err) => {
            if (DEBUG) console.log('Failed to load credits2 music:', err);
            window.credits2Loaded = false;
        }
    );
    
    sounds.backgroundMusic = window.gameMusic;
    sounds.loaded = true;
    if (DEBUG) console.log('Sound system initialized. Music files ready.');
}

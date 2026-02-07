/* ============================================
   CREDITS.JS - CLEAN CREDITS SYSTEM
   ============================================ */

"use strict";

// ========== CREDITS SYSTEM ==========
const CreditsSystem = {
    active: false,
    scrollY: 0,
    scrolling: false,
    timer: 0,
    currentTrack: 1,
    track1EndTime: 0,
    finished: false,
    finalFadeAlpha: 0,
    
    // Groups with precise tracking
    groups: {
        title: {
            y: 0,
            height: 0,
            elements: [] // Will store image and text info
        },
        credits: {
            y: 0,
            height: 0,
            items: [
                { title: 'Carl Design', credit: 'Gemini Nano Banana Pro' },
                { title: 'Carl Sprite', credit: 'Claude Sonnet 4.5' },
                { title: 'Carl Main Theme', credit: 'NoteGPT' },
                { title: 'Sun Battle Theme', credit: 'Suno' },
                { title: 'Credits Themes', credit: 'Suno & NoteGPT' },
                { title: 'SFX', credit: 'ElevenLabs' },
                { title: 'Gameplay', credit: 'Claude Sonnet 4.5' },
                { title: 'Level Design', credit: 'Claude Sonnet 4.5' }
            ]
        },
        thankYou: {
            y: 0,
            height: 0
        }
    },
    
    carlImage: null,
    
    init() {
        this.active = true;
        this.scrollY = 0;
        this.scrolling = false;
        this.timer = 0;
        this.currentTrack = 1;
        this.track1EndTime = 0;
        this.finished = false;
        this.finalFadeAlpha = 0;
        
        // Load Carl image if not loaded
        if (!this.carlImage) {
            this.carlImage = loadImage('carl.png');
        }
        
        // Calculate initial positions
        this.calculatePositions();
    },
    
    calculatePositions() {
        // Group 1: Title group (centered on screen)
        let imgSize = 350 * SCALE;
        let titleSpacing = 50 * SCALE;
        let titleText1Size = 80 * SCALE;
        let titleText2Size = 44 * SCALE;
        let titleText3Size = 60 * SCALE;
        let titleTextSpacing = 60 * SCALE; // Space between text lines
        
        this.groups.title.height = imgSize + titleSpacing + titleText1Size + titleTextSpacing + titleText2Size + titleTextSpacing + titleText3Size;
        this.groups.title.y = height / 2 - this.groups.title.height / 2;
        
        // Group 2: Credits list (starts just below screen)
        let creditTitleSize = 36 * SCALE;
        let creditGap1 = 50 * SCALE;
        let creditTextSize = 30 * SCALE;
        let creditGap2 = 90 * SCALE;
        let creditItemHeight = creditTitleSize + creditGap1 + creditTextSize + creditGap2;
        
        this.groups.credits.height = this.groups.credits.items.length * creditItemHeight;
        this.groups.credits.y = height + 100 * SCALE; // Start below screen with padding
        
        // Group 3: Thank you (below credits)
        let thankYouSize = 40 * SCALE;
        let thankYouPadding = 150 * SCALE;
        
        this.groups.thankYou.height = thankYouSize + thankYouPadding;
        this.groups.thankYou.y = this.groups.credits.y + this.groups.credits.height + 100 * SCALE;
        
        // Set initial scroll position
        this.scrollY = 0;
    },
    
    update() {
        if (!this.active) return;
        
        this.timer++;
        
        // Start scrolling after 2 seconds (120 frames)
        if (this.timer >= 120 && !this.scrolling && !this.finished) {
            this.scrolling = true;
            // Start credits music
            if (window.credits1Music && window.credits1Loaded) {
                window.credits1Music.setVolume(0.6);
                window.credits1Music.play();
            }
        }
        
        // Scroll credits
        if (this.scrolling && !this.finished) {
            this.scrollY -= 0.5;
            
            // Check if "Thank you for playing" is off screen
            let thankYouScreenY = this.groups.thankYou.y + this.scrollY;
            let thankYouBottom = thankYouScreenY + this.groups.thankYou.height;
            
            if (thankYouBottom < 0) {
                this.finished = true;
                this.finalFadeAlpha = 0;
            }
        }
        
        // Fade in final screen
        if (this.finished && this.finalFadeAlpha < 255) {
            this.finalFadeAlpha += 2;
        }
        
        // Handle music transitions
        if (this.scrolling && this.currentTrack === 1 && window.credits1Music && window.credits1Loaded) {
            if (!window.credits1Music.isPlaying()) {
                // Mark when track 1 ended
                if (this.track1EndTime === 0) {
                    this.track1EndTime = this.timer;
                }
                // Wait 2 seconds (120 frames) before starting track 2
                if (this.timer - this.track1EndTime >= 120) {
                    this.currentTrack = 2;
                    if (window.credits2Music && window.credits2Loaded) {
                        window.credits2Music.setVolume(0.6);
                        window.credits2Music.play();
                    }
                }
            }
        }
        
        // Auto-return to menu when credits2 finishes
        if (this.finished && this.currentTrack === 2 && window.credits2Music && window.credits2Loaded) {
            if (!window.credits2Music.isPlaying()) {
                this.returnToMenu();
            }
        }
    },
    
    draw() {
        if (!this.active) return;
        
        push();
        
        // Black background
        fill(0);
        rect(0, 0, width, height);
        
        // If showing final screen
        if (this.finished) {
            this.drawFinalScreen();
            pop();
            return;
        }
        
        // Draw all groups
        this.drawTitleGroup();
        this.drawCreditsGroup();
        this.drawThankYouGroup();
        
        // Controls hint
        fill(150);
        textSize(20 * SCALE);
        textStyle(NORMAL);
        textAlign(CENTER, CENTER);
        text('Press ENTER to return to menu', width / 2, height - 40 * SCALE);
        
        pop();
    },
    
    drawTitleGroup() {
        if (!this.carlImage || this.carlImage.width === 0) return;
        
        let screenY = this.groups.title.y + this.scrollY;
        let imgSize = 350 * SCALE;
        let titleSpacing = 50 * SCALE;
        
        // Image
        image(this.carlImage, width / 2 - imgSize / 2, screenY, imgSize, imgSize);
        
        let textY = screenY + imgSize + titleSpacing;
        
        // Title texts
        fill(255);
        textAlign(CENTER, CENTER);
        
        textSize(80 * SCALE);
        textStyle(BOLD);
        text('CARL', width / 2, textY);
        textY += 60 * SCALE;
        
        textSize(44 * SCALE);
        textStyle(NORMAL);
        text('The Urgent Slug Urchin', width / 2, textY);
        textY += 60 * SCALE;
        
        textSize(60 * SCALE);
        textStyle(BOLD);
        text('2D', width / 2, textY);
    },
    
    drawCreditsGroup() {
        let screenY = this.groups.credits.y + this.scrollY;
        let y = screenY;
        
        fill(255);
        textAlign(CENTER, CENTER);
        
        for (let item of this.groups.credits.items) {
            // Title
            textSize(36 * SCALE);
            textStyle(BOLD);
            fill(100, 200, 255);
            text(item.title, width / 2, y);
            y += 50 * SCALE;
            
            // Credit
            textSize(30 * SCALE);
            textStyle(NORMAL);
            fill(255);
            text(item.credit, width / 2, y);
            y += 90 * SCALE;
        }
    },
    
    drawThankYouGroup() {
        let screenY = this.groups.thankYou.y + this.scrollY;
        
        fill(255, 215, 0);
        textSize(40 * SCALE);
        textStyle(BOLD);
        textAlign(CENTER, CENTER);
        text('Thank You For Playing!', width / 2, screenY);
    },
    
    drawFinalScreen() {
        if (!this.carlImage || this.carlImage.width === 0) return;
        
        let imgSize = 350 * SCALE;
        let centerY = height / 2 - imgSize / 2 - 60 * SCALE;
        
        // Image with fade
        tint(255, this.finalFadeAlpha);
        image(this.carlImage, width / 2 - imgSize / 2, centerY, imgSize, imgSize);
        noTint();
        
        // Texts with fade
        fill(255, 255, 255, this.finalFadeAlpha);
        textAlign(CENTER, CENTER);
        
        textSize(80 * SCALE);
        textStyle(BOLD);
        text('CARL', width / 2, centerY + imgSize + 50 * SCALE);
        
        textSize(44 * SCALE);
        textStyle(NORMAL);
        text('The Urgent Slug Urchin', width / 2, centerY + imgSize + 110 * SCALE);
        
        textSize(60 * SCALE);
        textStyle(BOLD);
        text('2D', width / 2, centerY + imgSize + 170 * SCALE);
        
        // Controls hint
        fill(150, 150, 150, this.finalFadeAlpha);
        textSize(20 * SCALE);
        textStyle(NORMAL);
        text('Press ENTER to return to menu', width / 2, height - 40 * SCALE);
    },
    
    skipTrack() {
        if (this.currentTrack === 1 && this.scrolling) {
            // Stop track 1 and immediately start track 2
            if (window.credits1Music && window.credits1Loaded) {
                window.credits1Music.stop();
            }
            this.currentTrack = 2;
            if (window.credits2Music && window.credits2Loaded) {
                window.credits2Music.setVolume(0.6);
                window.credits2Music.play();
            }
        }
    },
    
    returnToMenu() {
        // Stop all music
        if (window.credits1Music && window.credits1Loaded) {
            window.credits1Music.stop();
        }
        if (window.credits2Music && window.credits2Loaded) {
            window.credits2Music.stop();
        }
        
        // Return to title
        if (typeof returnToTitle === 'function') {
            this.active = false;
            returnToTitle();
        }
    },
    
    handleKeyPress(key) {
        if (!this.active) return false;
        
        // Skip track
        if ((key === 'n' || key === 'N' || key === 'ArrowRight') && !this.finished) {
            this.skipTrack();
            return true;
        }
        
        // Return to menu
        if (key === 'Enter') {
            this.returnToMenu();
            return true;
        }
        
        return false;
    }
};

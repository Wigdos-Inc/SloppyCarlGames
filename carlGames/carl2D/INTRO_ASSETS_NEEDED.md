# Required Intro Assets

The intro sequence has been implemented but requires the following assets to be added:

## Image Assets
- **sloppyCarl.png** - Place in the `carl2D` directory (same level as index.html)
  - This should be the Sloppy Carl Studios logo
  - Recommended size: 800x600 or similar aspect ratio

## Audio Assets
Place these in the `sounds/` directory:

- **splat.mp3** - Sound effect that plays when logo appears
  - Will be played at 1.5x speed
  - Should be a short sound effect (< 1 second)

- **sloppyCarl.mp3** - Voice/sound that plays 1 second after logo appears
  - Plays at normal speed
  - Duration determines how long before logo fades out

## How the Intro Works

1. Black screen for 1 second
2. Logo fades in with 0.3s animation, splat.mp3 plays at 1.5x speed
3. After 1 second, sloppyCarl.mp3 plays
4. When sloppyCarl.mp3 finishes, logo fades out over 1 second
5. Black overlay fades out over 1 second, then is removed
6. Only plays on first visit (uses Session Storage)

## Testing
- To see the intro again, clear session storage or close/reopen the browser
- The intro is skipped on subsequent page loads in the same browser session

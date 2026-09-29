# Mochi Farm

A cozy focus timer for iPhone. While you focus, your little buddy Mochi works the farm: planting carrots, picking apples, looking after the hens. Finish a session and he comes home with the harvest and coins, which you spend decorating his cottage and dressing him up.

Built with Expo and React Native. Mochi Farm itself is a single self-contained web page (all art is drawn in SVG) that the app shows full screen, with native keep-awake and haptics.

## How it works

- **Focus sessions** of 15, 25, 45 or 60 minutes. Longer sessions earn more coins.
- **Stay in the app.** The screen stays on during a session, but leaving the app or locking your phone for more than 5 seconds ends it, and Mochi drops the harvest. This keeps things fair when you compete with friends.
- **Mochi's home.** Spend coins on paint, floors, beds, lamps, rugs, plants, windows and clothes. Mochi tells you what he's dreaming of, matched to your budget and to the style of what he already owns; tap his thought bubble to buy it.
- **3-day harvest challenge.** Focus 90 minutes a day for three days to win the golden record player.
- **Journal.** Streaks, the last 7 days, and everything you've harvested.

Friends and the leaderboard currently use sample data, and progress is saved on the device only.

## Run it

Requires Node.js and the [Expo Go](https://expo.dev/go) app on your phone.

```bash
npm install
npx expo start --tunnel
```

Scan the QR code with your phone's camera to open the app in Expo Go.

For testing without waiting for real timers, open the **Journal** tab and tap **Developer**: it has a fast timer (one minute passes in one second), a "Finish now" button, and coin shortcuts.

## Project layout

| Path | What it is |
| --- | --- |
| `assets/mochi/mochi-farm.html` | The Mochi Farm page: all game logic, art and styles |
| `src/mochi/mochi-html.ts` | Generated copy of the page for the app. Run `node scripts/sync-mochi.js` after editing the HTML |
| `src/app/index.tsx` | The app's first screen: shows the page in a WebView, keeps the screen awake, plays haptics, reports when the app goes to the background |
| `src/app/pomodoro.tsx` | An earlier plain Pomodoro timer, kept for reference |

Check types with `npx tsc --noEmit`.

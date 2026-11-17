# Roadmap: Motion Games on Google Play (subscription model)

_Last updated: 14 Nov 2026. Play Store rules change every year, so re-check the linked official pages before each phase._

## Where we are
**Phase 0 (prototype) is done.** Motion Bowling works end to end:
- A phone on a stand tracks the player's body (MediaPipe, on-device), and the 3D game runs on the TV.
- Step to aim, swing your arm up to throw, lean to hook. Full 10-frame scoring.
- A sideloadable Android app (`bowling/android`) bundles the server, the tracking and the game.

**What the prototype is not yet:** store-ready. The TV still needs a third-party browser and a typed IP address,
the app is debug-signed, it targets API 34, and there is only one game.

---

## Decisions needed from you (before Phase 2)

| # | Decision | Why it matters | Suggestion |
|---|---|---|---|
| 1 | **Brand name** | Store listing, icon, domain. Check that it's free to use (trademark search, Play Store search). | Something broader than "bowling", e.g. "MoveArcade" or "Living Room Motion". Your call. |
| 2 | **Package ID** (e.g. `com.yourbrand.motion`) | **Permanent.** It can never change after the first upload. | Decide together with the name. Replace `com.motionbowling`. |
| 3 | **Developer account type** | A *personal* account must pass a 12-tester / 14-day closed test before production. An *organization* account skips that but needs a D-U-N-S number (up to ~30 days) and a registered business. | Personal account now ($25, one time). Recruit 15+ testers early. |
| 4 | **Billing approach** | Building your own receipt-verification backend vs. using a service. | RevenueCat (or similar) for v1: no backend to build. Re-check their current pricing. |
| 5 | **Audience age** | Targeting under-13s brings in Google's Families policy (stricter ads, data and billing rules). | Rate for 13+ at launch. Revisit later. |

---

## Target product architecture

Store users can't be asked to install a browser and type IP addresses. The production setup should be:

```
┌────────────────────────┐   local Wi-Fi, auto-discovered    ┌──────────────────────────┐
│ PHONE app              │  (NSD/mDNS + 4-digit pair code)    │ ANDROID TV app           │
│ • camera + MediaPipe   │ ─────── pose / gestures ─────────▶ │ • runs the game (WebView │
│ • sends gestures only  │ ◀────── game state ─────────────── │   with the same web code)│
│ • subscription purchase│                                    │ • WebSocket host         │
└────────────────────────┘                                    └──────────────────────────┘
```

- **One app, both form factors.** The same package installs on phones (camera mode) and on Android TV / Google TV (game mode),
  with a Leanback launcher entry for TV. One listing, one subscription that works on both.
- **The TV hosts the game and the server.** It's always plugged in and stable. The phone only tracks and sends gestures,
  which keeps it cooler and saves its battery.
- **No IP typing.** The TV advertises itself on the network and the phone finds it automatically. A 4-digit code on the TV confirms the pairing.
- **Reuse the web game code** (`public/`) inside WebViews. It's already proven and it keeps adding new games fast.
- **Later:** a "phone + Chromecast" mode for TVs without Android, and an Amazon Fire TV build.

---

## Phases

### Phase 1: Validate the fun (2–3 weeks)
Goal: prove that people enjoy it and that tracking is reliable *before* investing in store work.
- [ ] Play on your own OnePlus 6 + OnePlus TV. Tune `GESTURE` (gestures.js) and the lane physics until throws feel right.
- [ ] Test with 5–10 friends and family: different heights, rooms, lighting, phones.
- [ ] Record tracking fps on 3–4 phones (low-end, mid-range, flagship). Set a minimum supported phone.
- [ ] Write down what confused people and what made them want "one more game".
- [ ] **Go / no-go:** do testers ask to play again without being prompted?

### Phase 2: Production app foundation (3–5 weeks)
- [ ] Move `bowling/android` to a **Gradle + Kotlin** project (needed for Play Billing, AAB and dependencies).
- [ ] **Target API 36 (Android 16)**. This is required for all new apps and updates since 31 Aug 2026. minSdk 26.
- [ ] Build an **Android App Bundle (.aab)**. Enrol in **Play App Signing**. Create an **upload key** and back it up in two safe places.
- [ ] Add an **Android TV mode**: Leanback launcher, a 320×180 banner, and full D-pad/remote navigation (no touch needed on TV).
- [ ] Network discovery (NSD) + pairing code, replacing the typed IP address.
- [ ] Restrict cleartext traffic to the local network only (network security config).
- [ ] Add a crash reporter (e.g. Firebase Crashlytics). Note: this changes what you declare in the Data safety form.
- [ ] An "About / Licences" screen showing [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md).
- [ ] A first-run tutorial: phone placement, distance, lighting check, a practice throw.

### Phase 3: Enough content to justify a subscription (6–10 weeks, ongoing)
A subscription needs ongoing value, not a single game. Candidate games that suit body tracking:
- [ ] 🎳 Bowling: polish, themes, spin tutorial
- [ ] 🥊 Boxing: punch targets, dodge
- [ ] ⚽ Goalkeeper: dive and block
- [ ] 💃 Rhythm / dance: match poses to music (needs licensed or original music)
- [ ] 🏃 Daily workout: 10-minute motion fitness, streaks
- [ ] **2-player mode** with one camera (MediaPipe supports multiple poses)
- [ ] Profiles, high scores, history, weekly challenges

### Phase 4: Subscription (2–3 weeks)
- [ ] Integrate **Play Billing Library 9.x**. Version 8 is the minimum Play currently accepts; v7 and older are blocked for new apps.
- [ ] In Play Console: one subscription product, **"Premium"**, with two base plans (monthly, yearly) and a **7-day free trial** offer.
- [ ] Unlock features from the verified entitlement. Handle grace periods, account hold, cancellation, and restore on a new device.
- [ ] Use RevenueCat (decision #4) **or** build a small backend: Play Developer API verification + Real-time Developer Notifications.
- [ ] Set up a **payments profile / merchant account** (bank details, tax info such as PAN/GST for India).
- [ ] **License testers** in Play Console, so you and the reviewers can buy without being charged.

### Phase 5: Store compliance and listing (1–2 weeks, in parallel with Phase 4)
- [ ] **Privacy policy** at a public URL, for example free on GitHub Pages. It must state that camera frames are processed on the device and never uploaded.
- [ ] **Data safety form**: camera used on-device only, plus whatever the crash/analytics tools collect.
- [ ] **Prominent disclosure** before the camera permission prompt, explaining why the camera is needed.
- [ ] Content rating questionnaire (IARC). Target audience: 13+.
- [ ] Review instructions: how to reach the premium features (license testers / test account).
- [ ] Listing assets: icon 512×512, feature graphic 1024×500, phone screenshots, **TV screenshots and TV banner**, and a short video
      (strongly recommended, because motion games are hard to understand from screenshots).
- [ ] Android TV quality review. Google reviews TV apps separately, so allow extra time.

### Phase 6: Testing tracks → production (3+ weeks)
- [ ] Internal testing: you plus a few people, using fast-uploaded builds.
- [ ] **Closed testing: at least 12 testers opted in for 14 continuous days** (a personal-account rule). Recruit 15–20 testers
      so that one dropping out doesn't reset the clock. Keep them engaged with a new build every few days.
- [ ] Apply for production access. Answer Google's questions about the testing.
- [ ] Production with a **staged rollout** (10% → 50% → 100%), watching crashes and reviews.

### Phase 7: Launch and grow
- [ ] Watch: trial→paid conversion, day-7 retention, cancellations, crash-free rate.
- [ ] Ship a new game or mode every 4–6 weeks. This is what keeps subscribers paying.
- [ ] Regional pricing, an offer to bring cancelled subscribers back, referral rewards.

**Rough total to launch: 4–6 months** part-time-to-full-time, with most of the time in Phases 2–3.

---

## Subscription model (draft)

| | **Free** | **Premium** |
|---|---|---|
| Bowling (solo) | ✅ Unlimited | ✅ |
| All other games | 1 free play per day each | ✅ Unlimited |
| 2-player mode | — | ✅ |
| Daily workouts and streaks | First week | ✅ |
| Themes, lanes, balls | Basic | ✅ All |
| Stats and history | Last 5 games | ✅ Full |

**Starting prices (to test, not final):**
- India: ₹149 / month, or ₹999 / year (save about 45%)
- Global: $2.99 / month, or $19.99 / year
- 7-day free trial on both plans

**Economics:** Google keeps **15% of subscription revenue**. Google also collects and pays tax (such as GST) in many countries;
check the tax settings in your payments profile.

**Why freemium and not paid-only:** people need to *feel* camera tracking working in their own room before paying.
A strong free game (Bowling) is the best ad for Premium.

---

## Running costs

| Item | Cost |
|---|---|
| Google Play developer account | $25, one time |
| Privacy policy hosting | Free (GitHub Pages) |
| Billing service (RevenueCat or similar) | Free at low revenue (check current plan) |
| Crash reporting (Firebase Crashlytics) | Free |
| Domain name (optional) | ~₹800 / year |
| Testing phones (optional) | One low-end Android phone, to set the minimum spec |

---

## Risks and how to handle them

| Risk | How to handle it |
|---|---|
| Tracking is poor in dim rooms or on cheap phones | Lighting check in onboarding, a published minimum phone spec, a lower-resolution mode |
| TV app rejected in TV quality review | Build for D-pad from day one; follow the Android TV app quality checklist |
| Camera permission raises privacy concerns | On-device processing explained clearly in the app, the privacy policy and the listing |
| The 12-tester rule delays launch | Recruit testers during Phase 3, not at the end |
| One game isn't enough to keep subscribers | Don't launch Premium until there are at least 3 games plus workouts |
| Phone heats up during long sessions | The TV hosts the game (phone only tracks), lower camera fps, a "rest" reminder |
| Name or trademark conflict | Search before Phase 2 (decision #1) |

## Prototype technical debt to fix in Phase 2
- Debug signing key → Play App Signing plus an upload key
- `targetSdk 34` → 36
- Hand-written build script → Gradle (AAB, dependency management, Play Billing)
- Thread-per-connection Java server → a small async server (or TV-hosted, per the target architecture)
- TV needs a third-party browser and a typed IP address → TV app plus auto-discovery
- No automated tests → unit tests for scoring and gestures (the logic is already pure and testable)

## References
- Target API requirement (API 36 from 31 Aug 2026): https://developer.android.com/google/play/requirements/target-sdk
- Testing requirements for new personal accounts (12 testers / 14 days): https://support.google.com/googleplay/android-developer/answer/14151465
- Play Billing Library deprecation schedule: https://developer.android.com/google/play/billing/deprecation-faq
- Android TV app quality guidelines: https://developer.android.com/docs/quality-guidelines/tv-app-quality

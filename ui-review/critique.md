# Zoen UI review: honest critique and the redesign

Reviewed on a local build (Next 16 + eve, Postgres 17, moto S3) at 1440×900 and 390×844 @2x.
Every surface below has a before/after pair in this folder: `<surface>-<desktop|mobile>-<before|after>.png`.

## Critique (before)

### 1. There are three products, not one
- The landing page renders in the system font, while auth and onboarding use the Vault brand face (Mona Sans), and the product uses its own iOS-style system stack. Nothing ties them together.
- Landing headlines put "italic" words in a synthesized oblique of a sans face. That's the cheapest-looking element on the page, and it carries the brand line.
- Color comes from three places that disagree:
  - shadcn's untinted neutral grays
  - an iOS blue `#007aff` override in `globals.css`
  - an olive/khaki accent hardcoded in the welcome suggestions

### 2. Hierarchy problems in the product
- Desktop showed the section name twice: once in a top bar ("Activity") and again as the page's large title ("Feed"), sometimes with different words.
- The composer was a plain hairline box. Its placeholder never rendered because Tiptap's empty state has no `<p>` and the CSS only targeted `p.is-empty`, so the main input of an AI companion read as an empty rectangle.
- Suggestions under the composer ("Somewhere to start") were tiny 13px rows with olive icon chips and a lone dot affordance. They looked like an afterthought rather than an invitation.

### 3. Empty states were bare text
- Feed, Ideas, Library, Search and Conversations each had their own ad hoc "title + paragraph", with different sizes and alignments and no visual anchor.
- Library interpolated a category into a sentence and produced "No all creations yet."
- Most first-run users see empty states first, so this was the product's real first impression.

### 4. Settings was a flat list of 10 items
- Wallet sat between Connectors and Credential vault, and Sign out had the same weight as Help.
- There was no grouping, no iconography rhythm and no destructive styling.

### 5. Contrast and state bugs
- "Continue with Telegram" (the primary sign-in CTA) was navy text on a blue fill, well below AA. The global `[data-variant=default] { --primary:#0071eb }` override fought the auth surface's own foreground token.
- The onboarding "Continue" button inherited the choice-list ghost style, so the primary action looked like a secondary row.
- No consistent hover, press or focus feedback in the React Native web layer. Rows and icon buttons gave zero response to the pointer, and there was no shared focus ring for keyboard users.

### 6. Spacing and type were magic numbers
- `companion-ui` had about 50 hardcoded hex colors and ad hoc font sizes (13, 14, 15, 16, 17, 20, 24, 26, 30, 34…) with no scale.
- Radii ranged from 6 to 24 with no logic.
- Shadows were either absent or bespoke per component.

### 7. Mobile
- The landing eyebrow pill wrapped onto two lines at 390px.
- Long page titles ("All creations") wrapped beside the toolbar.
- The 404 page was an unstyled stack of a 32px logo, a heading and a small button.

### 8. What was already good (kept)
- The landing's sky narrative, with crossfading skies, the mascot and the channel demos, is distinctive and emotional.
- The auth and onboarding glass cards are a strong idea that wasn't fully executed.
- The product's native iOS sensibility is right for a companion: calm, roomy, no chrome noise.

## Direction: "Zoen Night"

One family from the first scroll to the settings sheet:

1. **Tinted neutrals.** Every gray is tinted toward the night sky (hue 262) in both the web tokens (`foundation.css`) and the RN palette (`theme.ts`). Pure gray is gone.
2. **One brand voice.**
   - Vault (Mona Sans) for display and text everywhere.
   - A real Instrument Serif italic as the signature accent inside headlines, self-hosted as a 22 KB Latin subset under the OFL license, added to THIRD_PARTY_NOTICES.
3. **Cream on night for brand surfaces, blue for the app.**
   - The landing, sign-in and onboarding share the cream pill CTA.
   - Inside the app, one tested blue (`#0a5fd6`) with white text clears AA in both appearances.
4. **A real token system.**
   - Web: radius 0.75rem; four elevation levels built from `--shadow-color`; motion tokens (`--ease-out-soft`, `--animate-enter`, reduced-motion aware); a global `:focus-visible` ring.
   - RN: `space`, `radius`, `typeScale` (largeTitle → eyebrow) and `elevation` exports, used by shared components instead of literals.
5. **Shared components carry the polish.**
   - `EmptyState`: tinted symbol, title, body and up to two actions, with a compact variant for sidebars.
   - `ActionButton` and `IconButton` get hover, press scale, transitions and 44px targets.
   - The navigation rail gets hover states and accent-soft selection.
   - Sheets get a blurred scrim and floating elevation.

## What changed per surface
| Surface | Change |
|---|---|
| Landing | Real serif italic, display weight 420 at -0.04em with balanced wrapping, a glass eyebrow pill with a live dot, staggered entrance, refined CTA shadows and arrow nudge, a mobile eyebrow on one line, consistent footer link sizing |
| Sign-in | Cream primary CTA (fixes the low-contrast navy-on-blue bug), glass card with an inset highlight and entrance motion |
| Onboarding | 52px pill buttons, 50px glass inputs with a focus ring, "Continue" is a real primary again, destructive-colored inline errors |
| Companion home | 88px avatar with a ring, 34px heading, composer with a visible placeholder and inline formatting toggle, suggestion *cards* on desktop (3-up with hover lift) and rows with hover on mobile |
| Shell | Duplicate desktop section bar removed (the rail plus the large title carry it), elevated main frame, 64px rail with hover and selection states, tokenized menu |
| Feed / Ideas / Search / Conversations / Library | One `EmptyState` everywhere, clear copy ("Nothing here yet"), library sidebar on a sidebar tint with eyebrow headings and accent selection; layout and sort toggles hidden until they apply |
| Settings | Grouped inset list (General · Account & data · Help), icon tiles, hairline separators, hover, Sign out isolated in danger color |
| Pages | Centered 880px content column, tokenized padding, 28px compact titles so long names fit next to actions |
| 404 + errors | New shared `StatusPage` (logo with ring, code eyebrow, balanced title, primary CTA, soft primary glow). It also powers a new root `app/error.tsx` so uncaught page errors get a designed, translated recovery screen instead of the framework default |

## Accessibility notes
- Primary fill `#0a5fd6` on white text measures 5.8:1 (6.6:1 on the 8% darker hover) (enforced by `tests/primary-button-contrast.test.tsx`).
- Cream CTAs: `#1b3040` on `#f6f5ef` is 12.5:1.
- Mobile tab labels keep 10px with at least 4.5:1 on the selected fill (existing test).
- Increased-contrast, forced-colors and reduced-transparency paths are untouched; the existing tests were updated only for the new palette values.
- Reduced motion zeroes the entrance distance and disables the staggered landing animations.

## Not reachable locally (no screenshots)
- **A real conversation thread with messages:** no model provider is configured on the box.
- **Google sign-in:** no OAuth credentials locally.
- **Telegram and WhatsApp linking flows:** synthetic channels only.
- **A populated conversations sidebar, feed and library:** a fresh workspace has no history.

## Prioritized follow-ups
1. **Thread view polish:** bubbles, reactions, tool-call cards and streaming states with real data. This is the most-used surface and couldn't be exercised here.
2. **Naming alignment between nav and titles:** "Activity" vs "Feed", "Search" vs "Conversations", "Agents" vs "Discover". Pick one word per destination in all three locales.
3. **Mobile large-title collapse:** the compact header and the large title both show the page name; collapse the large title on scroll, iOS style.
4. **Remaining hardcoded colors in `companion-ui`:** about 40 literals in goals, discover, the wallet and the markdown renderer. Migrate them to `useColors()` and the tokens.
5. **Dark mode audit with real content:** the base surfaces are done and verified, but cards, markdown, code blocks and charts need a pass.
6. **Library on mobile:** move the category picker into a tappable title so the grid/list toggle can come back on phones.
7. **Landing:** soften the section seams in the reduced-motion and no-JS fallback, where each section paints its own sky, and add a light skeleton for the channel demo before it hydrates.
8. **Composer:** restore a subtle lift shadow through a wrapper. It was dropped because the material tests count blurred and shadowed views.

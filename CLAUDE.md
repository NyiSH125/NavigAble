## NavigAble project rules

### Product
Accessibility obstacle map. Users photograph obstacles, a vision model classifies them per disability profile, and routing avoids them. Map-first UI, no marketing pages.

### UI rules (hard constraints)
- Map-first. The map is the homepage. No hero section, no feature grid, no pricing.
- Dark map style with a warm off-white text layer. Never pure white background, never purple-on-black.
- No gradients, no drop shadows, no glass effects, no radial orbs, no dot grids.
- No Lucide icons, no emoji in rendered UI, no sparkle icons, no animated arrows.
- No rows of three feature cards. No bento grids. No checkmark bullet lists.
- Sharp or near-sharp corners. Border radius max 4px.
- No hover-only animations. Focus states are required and must be visible.
- Every async surface gets a real skeleton loader, never a spinner-only state.
- Copy contains no em dashes and no "it's not X, it's Y" constructions.
- Severity colors must be distinguishable without color alone. Pair every color with a shape or label.

### Accessibility rules (non-negotiable, this is an accessibility product)
- Every feature must be fully operable by keyboard alone.
- The MapLibre canvas is decorative. A parallel semantic list of pins and route steps is the canonical interaction surface for keyboard and screen reader users. Build both, always.
- All interactive elements need accessible names. All state changes announce via aria-live.
- Contrast minimum 4.5:1 for text, 3:1 for UI boundaries.

### Code rules
- Server-side secrets never imported into client components.
- All model calls go through app/api routes, never from the browser.
- Vision model: claude-sonnet-5, forced tool call for structured output. Never parse JSON out of prose.

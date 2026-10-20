# Runway Style Editorial Redesign Plan

## Design read

Runway Style is an AI fashion studio for people who want to build a private digital avatar, explore wardrobe combinations, and experience a virtual runway. The reference direction is luxury editorial fashion crossed with a quiet fashion-tech product: cinematic imagery, indigo framing, vanilla cream surfaces, serif display headlines, and restrained interaction.

## Approved design system

- **Primary:** Midpoint Indigo `#252844`
- **Canvas:** Vanilla Cream `#EEEBD0`
- **Surface:** `#F7F4E9`
- **Ink:** `#171A2C`
- **Warm accent:** `#CBB99B`
- **Display:** Playfair Display
- **UI/body:** Inter
- **Grid:** 8px base; 24/32/48/72px editorial spacing
- **Radius:** 16–22px cards, pill controls, soft framed media
- **Elevation:** warm, low-contrast shadows; no heavy glassmorphism
- **Motion:** 350–700ms cinematic reveals, subtle hover lift/scale, reduced-motion fallback
- **Signature motifs:** cream fabric curves, indigo panels, editorial numbering such as `01 / 04`

## Product scope

1. Build a responsive web experience in `apps/web` using the approved visual system.
2. Create the landing page with editorial navigation, hero composition, avatar creation entry point, wardrobe/try-on preview, and virtual runway preview.
3. Add responsive mobile composition matching the supplied phone references.
4. Keep copy and UI states honest: current avatar generation remains unavailable until the backend generation pipeline exists.
5. Preserve the existing mobile upload/auth contracts; this branch focuses on the web visual experience and shared design tokens.
6. Include accessible landmarks, keyboard navigation, visible focus states, descriptive image alternatives, responsive behavior, and reduced-motion support.
7. Keep all work on `design/runway-editorial`; do not commit, push, deploy, or modify `main` without explicit approval.

## Implementation structure

- `apps/web/index.html`: browser entry and metadata
- `apps/web/src/main.tsx`: React entry
- `apps/web/src/App.tsx`: page composition and lightweight interaction state
- `apps/web/src/styles.css`: design tokens, layout, responsive rules, motion and accessibility states
- `apps/web/public/manus-routes.json`: route manifest for the preview
- `apps/web/public/assets/`: local visual assets used by the prototype
- `apps/web/package.json`: web scripts and dependencies

## Visual strategy

Use the supplied reference as the source of visual direction. Where production photography is not available in the repository, use locally generated visual placeholders with explicit editorial treatment rather than claiming they are generated avatar outputs. The first implementation prioritizes layout, hierarchy, responsive composition, and honest product states; production imagery and live data can be swapped into stable media slots later.

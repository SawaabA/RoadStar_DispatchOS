# RoadStar DispatchOS pitch deck

## Deliverables

- `product_pitch_deck.pptx` — editable 16:9 PowerPoint with speaker notes.
- `product_pitch_deck.pdf` — PowerPoint-rendered presentation PDF.
- `index.html` — lightweight browser presentation.
- `assets/` — authenticated 1920×1080 product captures with account identity masked.

## Eight-slide narrative

1. RoadStar DispatchOS: one operating system for every move.
2. Five disconnected tools turn dispatch into manual orchestration.
3. One shared workspace closes the load-to-revenue loop.
4. Mixed freight becomes a safe, explainable 3D plan.
5. Historical replay ranks empty-kilometre opportunities.
6. Southern Ontario operations share one live map.
7. The deployable custom TMS core owns its data model and uses replaceable adapters.
8. A controlled 30-day RoadStar pilot proves value.

## Integration framing

RoadStar owns its dispatch workflow, constraints, organization-scoped data model, audit history and user experience. It therefore has no dependency on a third-party TMS product. The current managed database, hosted routing and demo ELD/TMS sources are adapters—not claims that every provider has already been replaced. A real ELD or TMS connection still requires vendor selection, API documentation and sandbox credentials.

## Capture regeneration

With `.env` and `.env.qa.local` configured, run:

```bash
node scripts/capture-pitch-assets.mjs
```

The script signs in with the provisioned dispatcher QA account, masks the visible account identity and refreshes the screenshots in `assets/`.

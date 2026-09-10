# Loading solver service

This service is the RoadStar adapter around the MIT-licensed `xflp` dependency. It accepts RoadStar loading
requests over HTTP and returns normalized pallet placements for the web viewer.

Run from the repository root:

```powershell
npm run solver
```

Generated dependencies and compiled classes are stored in `.deps` and `out`; both are excluded from Git.

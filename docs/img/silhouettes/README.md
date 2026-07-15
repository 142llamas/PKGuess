# Pokémon silhouettes

Drop one image per Pokémon here, named by its **National Pokédex number** as a
plain integer with a `.png` extension — no zero-padding:

```
1.png     ← Bulbasaur
2.png     ← Ivysaur
...
25.png    ← Pikachu
...
151.png   ← Mew
152.png   ← Chikorita   (Gen 2 starts here)
...
251.png   ← Celebi
```

The number matches the `num` field in `docs/data/gen2.json`.

## Where they show up

The silhouette appears on the two screens that display a single Pokémon's full
information:

1. **Single Player** — the end-of-game reveal card.
2. **Pokédex** — the per-Pokémon detail view.

Both render through one shared builder (`docs/js/lib/pokeinfo.js`), so the image
is wired in exactly one place.

## Notes

- These files are shown **as-is** — the code applies no filter, because the
  images are expected to already be silhouettes (solid dark shapes).
- The app works fine with this folder empty or partially filled: any missing
  file is hidden automatically (no broken-image icon, no layout gap), so you can
  add sprites one at a time.
- PNG with transparency works best (the card background shows through). Square
  images look best since the slot is 96×96 and uses `object-fit: contain`.
- `image-rendering: pixelated` is set, so small pixel-art sprites scale up
  crisply rather than blurring.

# JalurNusa Offline V4.1 Topographic

Versi ini melanjutkan V4 Final dan menambahkan renderer MapLibre untuk PMTiles vector serta PMTiles terrain Terrarium.

## Yang baru

- PMTiles raster tetap didukung.
- PMTiles vector MVT (termasuk Protomaps basemap) dapat diimpor dan disimpan di IndexedDB.
- PMTiles terrain Terrarium dapat diaktifkan sebagai hillshade topografi.
- Basemap vector + terrain dapat ditampilkan bersamaan.
- Rute, waypoint, GPS, breadcrumb, tracking, off-route alert, briefing, checklist, ekspor GPX/JalurNusa, dan backup V4 tetap tersedia.
- File GPX iPhone tetap menggunakan deteksi isi dari V3.0.4/V4.

## Penting untuk penggunaan offline pertama kali

MapLibre GL JS dan library PMTiles dimuat dari UNPKG dan kemudian ditangani cache runtime PWA. Buka aplikasi setidaknya satu kali saat online sebelum mengandalkan renderer vector di lokasi tanpa sinyal. Rute dan PMTiles yang sudah diimpor tetap berada di perangkat.

## Paket Ciremai yang direkomendasikan

Bounding box kerja: `108.37,-6.97,108.46,-6.87`.

### Basemap vector Protomaps

Dengan CLI `pmtiles`:

```bash
pmtiles extract https://build.protomaps.com/20260826.pmtiles \
  Ciremai_Basemap.pmtiles \
  --bbox=108.37,-6.97,108.46,-6.87 \
  --maxzoom=15
```

Impor `Ciremai_Basemap.pmtiles` melalui menu Offline > Paket PMTiles. V4.1 mendeteksi MVT sebagai `Vector MVT`.

### Terrain Mapterhorn

Membuat regional extract dilakukan dengan `pmtiles extract` dari arsip Mapterhorn yang mencakup bbox Ciremai. Untuk zoom rendah gunakan `planet.pmtiles`; untuk zoom 13-17 pilih regional archive dari daftar coverage/download Mapterhorn lalu merge bila perlu.

Contoh bagian zoom rendah:

```bash
pmtiles extract \
  --bbox=108.37,-6.97,108.46,-6.87 \
  https://download.mapterhorn.com/planet.pmtiles \
  Ciremai_Terrain_low.pmtiles
```

Nama file terrain sebaiknya mengandung `Terrain`, `Mapterhorn`, `DEM`, atau `Terrarium` agar V4.1 otomatis mengklasifikasikannya sebagai terrain.

## Catatan lisensi

Basemap Protomaps berasal dari data OpenStreetMap dan harus mempertahankan atribusi yang sesuai. Jangan melakukan bulk-download dari `tile.openstreetmap.org`. Mapterhorn menyediakan data terrain untuk area extracts melalui arsip PMTiles mereka.

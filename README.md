# JalurNusa Offline — MVP PWA

Aplikasi mobile-first khusus penyimpanan dan navigasi rute pendakian gunung di Indonesia.

## Fitur pada versi ini
- PWA dapat dipasang ke Home Screen.
- Katalog 20 gunung/pegunungan populer di Indonesia.
- Cari dan filter wilayah.
- Impor file **GPX** dan **GeoJSON**: `LineString`, `MultiLineString`, `GeometryCollection`, serta kumpulan `Point` berurutan (minimal 2 titik).
- Rute disimpan di **IndexedDB**, jadi tetap tersedia saat tidak ada internet.
- Mesin peta ringan buatan sendiri: pan, zoom, fit route, start/end marker.
- GPS real-time dan lokasi pengguna pada peta.
- Kompas perangkat bila browser mendukung.
- Hitung jarak rute dan elevation gain bila file memiliki data elevasi.
- Catatan lapangan disimpan offline.
- Peta dasar OpenStreetMap dapat dinyalakan saat online untuk tampilan interaktif saja.
- Service worker menyimpan app shell. Service worker sengaja **tidak** melakukan bulk-download/prefetch tile pihak ketiga.

## Cara menjalankan
PWA/service worker membutuhkan HTTP atau HTTPS. Dari folder aplikasi:

```bash
python3 -m http.server 8080
```

Buka `http://localhost:8080`.

Untuk penggunaan di HP, deploy folder ini ke hosting HTTPS. Di iPhone gunakan Safari > Share > Add to Home Screen.

## Arsitektur peta offline penuh berikutnya
Versi ini sudah offline untuk app shell, GPX/GeoJSON, GPS, kompas dan catatan. Untuk **basemap topografi offline penuh**, gunakan dataset yang memang mengizinkan offline lalu kemas sebagai **PMTiles/MBTiles** dan render dengan MapLibre / MapLibre Native. Jangan membuat tombol prefetch dari `tile.openstreetmap.org` karena server tile standar OSM melarang bulk download/offline prefetch.

## Keselamatan
Aplikasi bukan pengganti peta resmi, petugas basecamp, informasi pengelola kawasan, atau perangkat navigasi cadangan. Pembukaan jalur, perizinan, cuaca, aktivitas vulkanik, dan kondisi jalur dapat berubah.


## Perbaikan v1.0.1
- Parser GeoJSON kini membaca struktur bersarang pada `FeatureCollection` dan `GeometryCollection`.
- Mendukung file rute yang diekspor sebagai kumpulan `Point` berurutan.
- Jika ada beberapa segmen garis terpisah, aplikasi memilih segmen terpanjang untuk menghindari garis sambungan palsu.
- Pesan error impor GeoJSON dibuat lebih jelas.

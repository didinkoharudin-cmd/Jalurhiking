# JalurNusa Offline V4.2 Professional

V4.2 berfokus pada pengalaman peta hiking yang lebih profesional dan memperbaiki perilaku progress ketika pengguna masih jauh dari jalur.

## Perubahan utama

- Map menjadi full-screen saat tab **Peta** dibuka; header besar disembunyikan agar area peta lebih luas.
- Panel rute menjadi **bottom sheet ringkas**. Tekan `Detail` atau handle untuk membuka profil elevasi/progress.
- Progress tidak lagi menampilkan persentase palsu jika GPS berada lebih dari **1 km** dari jalur. Status menjadi **BELUM DI JALUR**.
- Alarm off-route baru dipersenjatai setelah GPS pernah masuk ke ambang off-route yang dipilih; aplikasi tidak akan bergetar hanya karena rute dibuka dari rumah yang jauh dari gunung.
- Zoom peta diperluas hingga **Z22**. Vector PMTiles dengan source max zoom lebih rendah akan di-overzoom, sehingga jalan/path tetap tampil lebih dekat dan tajam.
- Gesture peta: drag, pinch zoom, double-tap zoom, wheel/trackpad zoom, tombol +/-, fit route, dan center GPS.
- Center GPS langsung memakai zoom dekat minimal Z18.
- Vector style ditingkatkan untuk jalan, trail/path, bangunan, air, hutan/landuse, dan boundary.
- Terrain PMTiles Terrarium mendapat hillshade lebih kuat dan diletakkan di bawah layer jalan/trail.
- GPS marker memiliki lingkaran akurasi dan heading bila perangkat menyediakan heading.
- Rendering MapLibre tidak dibuat ulang setiap kali peta digeser/di-zoom jika paket PMTiles yang aktif tidak berubah, sehingga interaksi lebih responsif.

## Tentang zoom dekat

JalurNusa sekarang dapat diperbesar sampai Z22. Jika `Ciremai_Basemap.pmtiles` hanya memiliki data sumber sampai Z15, Z16–Z22 adalah **overzoom vector**: geometri yang sudah ada dibesarkan dengan tajam, tetapi tidak menciptakan objek baru yang tidak ada di source Z15.

Untuk detail medan tambahan gunakan juga PMTiles terrain/hillshade. Kontur garis nyata memerlukan dataset contour terpisah dan belum dibundel otomatis di V4.2.

## Kompatibilitas

Database tetap menggunakan `JalurNusaDB` versi sebelumnya, sehingga rute, PMTiles, tracking, dan rencana yang tersimpan di V4.1.1 tidak sengaja dihapus oleh upgrade ini.

## Catatan keselamatan

JalurNusa adalah alat bantu navigasi. Verifikasi jalur resmi, status pembukaan, izin, kondisi cuaca, serta informasi pengelola sebelum pendakian. GPS dan data peta dapat memiliki kesalahan.
